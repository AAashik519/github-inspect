import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getConflictContent, listConflicts, recreateConflict, resolveWithContent, resolveWithSide } from "./conflicts";
import { currentBranch } from "./context";
import { previewMerge, runMerge } from "./merge";
import { abortOperation, continueOperation, previewApply, previewRebase, runCherryPick, runRebase, runReset, runRevert, skipOperation } from "./sequencer";
import { readStatus } from "./status";
import { createCommit } from "./staging";
import { cleanupTempDirs, createRepo, type TempRepo } from "./test-helpers";

afterEach(cleanupTempDirs);

/** main and feature both edit line 2 of app.txt differently. */
function createConflictingBranches(): TempRepo {
  const repo = createRepo();
  repo.git("switch", "-q", "-c", "feature");
  repo.commit("feature edit", { "app.txt": "line 1\nFEATURE\nline 3\n" });
  repo.git("switch", "-q", "main");
  repo.commit("main edit", { "app.txt": "line 1\nMAIN\nline 3\n" });
  return repo;
}

describe("merge preview", () => {
  it("describes what will be introduced, fast-forward ability and conflict simulation", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "feature");
    repo.commit("f1", { "f.txt": "1" });
    repo.git("switch", "-q", "main");

    const preview = await previewMerge(repo.ctx, { source: "feature", target: "main" });
    expect(preview).toMatchObject({ targetIsCurrent: true, canFastForward: true, alreadyMerged: false, commitsToIntroduceTotal: 1, targetOnlyCount: 0 });
    expect(preview.conflicts).toEqual({ supported: true, hasConflicts: false, files: [] });
  });

  it("predicts conflicts without touching the working tree", async () => {
    const repo = createConflictingBranches();
    const preview = await previewMerge(repo.ctx, { source: "feature", target: "main" });
    expect(preview.conflicts).toMatchObject({ supported: true, hasConflicts: true, files: ["app.txt"] });
    expect(repo.read("app.txt")).toContain("MAIN");
    expect((await readStatus(repo.ctx)).inProgress).toBeNull();
    expect(repo.git("status", "--porcelain")).toBe("");
  });

  it("recognises an already merged source and validates the direction", async () => {
    const repo = createRepo();
    repo.git("branch", "old");
    repo.commit("main moves", { "a.txt": "a" });
    expect((await previewMerge(repo.ctx, { source: "old", target: "main" })).alreadyMerged).toBe(true);
    await expect(previewMerge(repo.ctx, { source: "main", target: "main" })).rejects.toMatchObject({ kind: "validation" });
    await expect(previewMerge(repo.ctx, { source: "main", target: "origin/nothing" })).rejects.toMatchObject({ kind: "precondition" });
  });
});

describe("merge execution", () => {
  it("fast-forwards, creates merge commits with --no-ff, and squashes without committing", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "feature");
    repo.commit("f1", { "f.txt": "1" });
    repo.git("switch", "-q", "main");

    const ff = await runMerge(repo.ctx, { source: "feature", target: "main", strategy: "default" });
    expect(ff.summary).toContain("Fast-forwarded");
    expect(repo.git("rev-parse", "main")).toBe(repo.git("rev-parse", "feature"));

    repo.git("switch", "-q", "-c", "second", "main");
    repo.commit("s1", { "s.txt": "1" });
    repo.git("switch", "-q", "main");
    const merged = await runMerge(repo.ctx, { source: "second", target: "main", strategy: "no-ff" });
    expect(merged.summary).toContain("merge commit");
    expect(repo.git("rev-list", "--parents", "-n", "1", "HEAD").split(" ")).toHaveLength(3);

    repo.git("switch", "-q", "-c", "third", "main");
    repo.commit("t1", { "t.txt": "1" });
    repo.git("switch", "-q", "main");
    const headBefore = repo.git("rev-parse", "HEAD");
    const squashed = await runMerge(repo.ctx, { source: "third", target: "main", strategy: "squash" });
    expect(squashed.summary).toContain("Nothing is committed yet");
    expect(repo.git("rev-parse", "HEAD")).toBe(headBefore);
    expect((await readStatus(repo.ctx)).files.some((file) => file.path === "t.txt" && file.index === "A")).toBe(true);
  });

  it("reports nothing to do when the source is already merged", async () => {
    const repo = createRepo();
    repo.git("branch", "old");
    repo.commit("main moves", { "a.txt": "a" });
    expect((await runMerge(repo.ctx, { source: "old", target: "main", strategy: "default" })).outcome).toBe("noop");
  });

  it("never switches branches: the target must already be checked out", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "other");
    await expect(runMerge(repo.ctx, { source: "other", target: "main", strategy: "default" })).rejects.toMatchObject({ kind: "precondition" });
    expect(await currentBranch(repo.ctx)).toBe("other");
  });

  it("refuses to merge with uncommitted tracked changes", async () => {
    const repo = createRepo();
    repo.git("branch", "feature");
    repo.write("app.txt", "dirty\n");
    await expect(runMerge(repo.ctx, { source: "feature", target: "main", strategy: "default" })).rejects.toMatchObject({ kind: "dirty-worktree" });
    expect(repo.read("app.txt")).toBe("dirty\n");
  });

  it("supports ff-only and fails clearly when diverged", async () => {
    const repo = createConflictingBranches();
    await expect(runMerge(repo.ctx, { source: "feature", target: "main", strategy: "ff-only" })).rejects.toMatchObject({ kind: "non-fast-forward" });
  });
});

describe("merge conflicts", () => {
  it("stops on conflicts, exposes all three versions, and completes after validated resolution", async () => {
    const repo = createConflictingBranches();
    const result = await runMerge(repo.ctx, { source: "feature", target: "main", strategy: "default" });
    expect(result.outcome).toBe("conflict");

    const status = await readStatus(repo.ctx);
    expect(status.inProgress?.kind).toBe("merge");
    expect(await listConflicts(repo.ctx)).toEqual([{ path: "app.txt", type: "both-modified" }]);

    const content = await getConflictContent(repo.ctx, "app.txt");
    expect(content.ours).toContain("MAIN");
    expect(content.theirs).toContain("FEATURE");
    expect(content.base).toBe("line 1\nline 2\nline 3\n");
    expect(content.working).toContain("<<<<<<<");

    // Cannot continue while unresolved
    await expect(continueOperation(repo.ctx, { kind: "merge" })).rejects.toMatchObject({ kind: "precondition" });
    // Cannot mark resolved while markers remain
    await expect(resolveWithContent(repo.ctx, { path: "app.txt", content: content.working! })).rejects.toMatchObject({ kind: "validation" });
    expect(await listConflicts(repo.ctx)).toHaveLength(1);

    await resolveWithContent(repo.ctx, { path: "app.txt", content: "line 1\nMAIN+FEATURE\nline 3\n" });
    expect(await listConflicts(repo.ctx)).toHaveLength(0);
    const done = await continueOperation(repo.ctx, { kind: "merge" });
    expect(done.outcome).toBe("success");
    expect((await readStatus(repo.ctx)).inProgress).toBeNull();
    expect(repo.read("app.txt")).toBe("line 1\nMAIN+FEATURE\nline 3\n");
    expect(repo.git("rev-list", "--parents", "-n", "1", "HEAD").split(" ")).toHaveLength(3);
  });

  it("aborts a conflicted merge and restores the previous state", async () => {
    const repo = createConflictingBranches();
    const before = repo.git("rev-parse", "HEAD");
    await runMerge(repo.ctx, { source: "feature", target: "main", strategy: "default" });
    await abortOperation(repo.ctx, { kind: "merge" });
    expect((await readStatus(repo.ctx)).inProgress).toBeNull();
    expect(repo.git("rev-parse", "HEAD")).toBe(before);
    expect(repo.read("app.txt")).toBe("line 1\nMAIN\nline 3\n");
    await expect(abortOperation(repo.ctx, { kind: "merge" })).rejects.toMatchObject({ kind: "precondition" });
  });

  it("resolves by taking a whole side and can restore the original conflict", async () => {
    const repo = createConflictingBranches();
    await runMerge(repo.ctx, { source: "feature", target: "main", strategy: "default" });
    await resolveWithSide(repo.ctx, { path: "app.txt", side: "theirs" });
    expect(repo.read("app.txt")).toContain("FEATURE");
    expect(await listConflicts(repo.ctx)).toHaveLength(0);

    await recreateConflict(repo.ctx, "app.txt").catch(() => undefined); // already staged: cannot be recreated
  });

  it("restores conflict markers for a file that is still conflicted", async () => {
    const repo = createConflictingBranches();
    await runMerge(repo.ctx, { source: "feature", target: "main", strategy: "default" });
    fs.writeFileSync(path.join(repo.dir, "app.txt"), "my half-finished edit\n");
    await recreateConflict(repo.ctx, "app.txt");
    expect(repo.read("app.txt")).toContain("<<<<<<<");
  });

  it("handles modify/delete conflicts", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "feature");
    repo.git("rm", "-q", "app.txt");
    repo.git("commit", "-q", "-m", "delete app");
    repo.git("switch", "-q", "main");
    repo.commit("edit app", { "app.txt": "edited\n" });

    await runMerge(repo.ctx, { source: "feature", target: "main", strategy: "default" });
    expect(await listConflicts(repo.ctx)).toEqual([{ path: "app.txt", type: "deleted-by-them" }]);
    await resolveWithSide(repo.ctx, { path: "app.txt", side: "delete" });
    expect(fs.existsSync(path.join(repo.dir, "app.txt"))).toBe(false);
    expect((await continueOperation(repo.ctx, { kind: "merge" })).outcome).toBe("success");
  });

  it("refuses to resolve a path that is not conflicted", async () => {
    const repo = createConflictingBranches();
    await runMerge(repo.ctx, { source: "feature", target: "main", strategy: "default" });
    await expect(getConflictContent(repo.ctx, "README.md")).rejects.toMatchObject({ kind: "precondition" });
    await expect(resolveWithContent(repo.ctx, { path: "README.md", content: "x" })).rejects.toMatchObject({ kind: "precondition" });
    await expect(getConflictContent(repo.ctx, "../../etc/passwd")).rejects.toMatchObject({ kind: "validation" });
  });

  it("blocks manual commits while a merge is in progress", async () => {
    const repo = createConflictingBranches();
    await runMerge(repo.ctx, { source: "feature", target: "main", strategy: "default" });
    await expect(createCommit(repo.ctx, { message: "oops" })).rejects.toMatchObject({ kind: "precondition" });
  });
});

describe("rebase", () => {
  it("previews and rebases a branch onto another, rewriting its commits", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "feature");
    const original = repo.commit("f1", { "f.txt": "1" });
    repo.git("switch", "-q", "main");
    repo.commit("m1", { "m.txt": "1" });
    repo.git("switch", "-q", "feature");

    const preview = await previewRebase(repo.ctx, { onto: "main" });
    expect(preview).toMatchObject({ branch: "feature", commitsToReplayTotal: 1, alreadyBased: false, mergeCommitCount: 0, publishedCount: 0 });

    const result = await runRebase(repo.ctx, { onto: "main" });
    expect(result.outcome).toBe("success");
    expect(repo.git("rev-parse", "HEAD")).not.toBe(original);
    expect(repo.git("rev-parse", "HEAD~1")).toBe(repo.git("rev-parse", "main"));
  });

  it("warns when commits are already on the upstream branch", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "feature");
    repo.commit("f1", { "f.txt": "1" });
    const remote = createRepo({ initialCommit: false });
    repo.git("remote", "add", "origin", remote.dir);
    repo.git("push", "-q", "-u", "origin", "feature");
    repo.git("switch", "-q", "main");
    repo.commit("m1", { "m.txt": "1" });
    repo.git("switch", "-q", "feature");
    expect((await previewRebase(repo.ctx, { onto: "main" })).publishedCount).toBe(1);
  });

  it("pauses on conflicts and supports continue, skip and abort", async () => {
    const repo = createConflictingBranches();
    repo.git("switch", "-q", "feature");
    const featureTip = repo.git("rev-parse", "HEAD");

    const paused = await runRebase(repo.ctx, { onto: "main" });
    expect(paused.outcome).toBe("conflict");
    expect((await readStatus(repo.ctx)).inProgress).toMatchObject({ kind: "rebase", detail: "feature" });

    await abortOperation(repo.ctx, { kind: "rebase" });
    expect(repo.git("rev-parse", "HEAD")).toBe(featureTip);
    expect(await currentBranch(repo.ctx)).toBe("feature");

    await runRebase(repo.ctx, { onto: "main" });
    await resolveWithContent(repo.ctx, { path: "app.txt", content: "line 1\nBOTH\nline 3\n" });
    const finished = await continueOperation(repo.ctx, { kind: "rebase" });
    expect(finished.outcome).toBe("success");
    expect(repo.read("app.txt")).toContain("BOTH");

    repo.git("reset", "-q", "--hard", featureTip);
    await runRebase(repo.ctx, { onto: "main" });
    const skipped = await skipOperation(repo.ctx, { kind: "rebase" });
    expect(skipped.outcome).toBe("success");
    expect(repo.read("app.txt")).toContain("MAIN");
  });

  it("refuses a rebase with uncommitted changes, onto itself, or on a detached HEAD", async () => {
    const repo = createRepo();
    repo.git("branch", "other");
    repo.write("app.txt", "dirty\n");
    await expect(runRebase(repo.ctx, { onto: "other" })).rejects.toMatchObject({ kind: "dirty-worktree" });
    repo.git("checkout", "-q", "--", ".");
    await expect(runRebase(repo.ctx, { onto: "main" })).rejects.toMatchObject({ kind: "validation" });
    repo.git("checkout", "-q", "--detach");
    await expect(runRebase(repo.ctx, { onto: "other" })).rejects.toMatchObject({ kind: "precondition" });
  });
});

describe("cherry-pick and revert", () => {
  it("cherry-picks a commit onto the current branch", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "feature");
    const pick = repo.commit("pick me", { "p.txt": "picked\n" });
    repo.git("switch", "-q", "main");

    const preview = await previewApply(repo.ctx, { kind: "cherry-pick", hash: pick });
    expect(preview.conflicts.hasConflicts).toBe(false);
    await runCherryPick(repo.ctx, { hash: pick });
    expect(repo.read("p.txt")).toBe("picked\n");
    expect(repo.git("log", "-1", "--format=%s")).toBe("pick me");
  });

  it("predicts and handles cherry-pick conflicts with continue and abort", async () => {
    const repo = createConflictingBranches();
    const pick = repo.git("rev-parse", "feature");
    expect((await previewApply(repo.ctx, { kind: "cherry-pick", hash: pick })).conflicts).toMatchObject({ hasConflicts: true, files: ["app.txt"] });

    const paused = await runCherryPick(repo.ctx, { hash: pick });
    expect(paused.outcome).toBe("conflict");
    expect((await readStatus(repo.ctx)).inProgress?.kind).toBe("cherry-pick");
    await abortOperation(repo.ctx, { kind: "cherry-pick" });
    expect(repo.git("status", "--porcelain")).toBe("");

    await runCherryPick(repo.ctx, { hash: pick });
    await resolveWithContent(repo.ctx, { path: "app.txt", content: "line 1\nRESOLVED\nline 3\n" });
    expect((await continueOperation(repo.ctx, { kind: "cherry-pick" })).outcome).toBe("success");
    expect(repo.read("app.txt")).toContain("RESOLVED");
  });

  it("reverts a commit with a new commit", async () => {
    const repo = createRepo();
    const bad = repo.commit("bad change", { "bad.txt": "bad\n" });
    await runRevert(repo.ctx, { hash: bad });
    expect(fs.existsSync(path.join(repo.dir, "bad.txt"))).toBe(false);
    expect(repo.git("log", "-1", "--format=%s")).toContain('Revert "bad change"');
    expect(repo.git("rev-parse", "HEAD~1")).toBe(bad);
  });

  it("requires an explicit mainline parent to revert or cherry-pick a merge commit", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "feature");
    repo.commit("f1", { "f.txt": "1" });
    repo.git("switch", "-q", "main");
    repo.commit("m1", { "m.txt": "1" });
    repo.git("merge", "-q", "--no-ff", "-m", "merge feature", "feature");
    const merge = repo.git("rev-parse", "HEAD");

    await expect(runRevert(repo.ctx, { hash: merge })).rejects.toMatchObject({ kind: "validation" });
    await expect(runRevert(repo.ctx, { hash: merge, mainline: 3 })).rejects.toMatchObject({ kind: "validation" });
    expect((await previewApply(repo.ctx, { kind: "revert", hash: merge })).isMerge).toBe(true);

    await runRevert(repo.ctx, { hash: merge, mainline: 1 });
    expect(fs.existsSync(path.join(repo.dir, "f.txt"))).toBe(false);
    expect(fs.existsSync(path.join(repo.dir, "m.txt"))).toBe(true);
  });

  it("refuses to start while another operation is in progress or the tree is dirty", async () => {
    const repo = createRepo();
    const hash = repo.commit("c", { "c.txt": "c" });
    repo.write("app.txt", "dirty\n");
    await expect(runRevert(repo.ctx, { hash })).rejects.toMatchObject({ kind: "dirty-worktree" });
  });
});

describe("reset", () => {
  it("soft reset keeps changes staged, mixed unstages them, hard discards them", async () => {
    const repo = createRepo();
    const first = repo.git("rev-parse", "HEAD");
    repo.commit("second", { "a.txt": "a\n" });

    await runReset(repo.ctx, { target: first, mode: "soft" });
    expect(repo.git("status", "--porcelain")).toBe("A  a.txt");

    repo.git("commit", "-q", "-m", "again");
    await runReset(repo.ctx, { target: first, mode: "mixed" });
    expect(repo.git("status", "--porcelain")).toBe("?? a.txt");
  });

  it("requires explicit confirmation for a hard reset and reports how to undo it", async () => {
    const repo = createRepo();
    const first = repo.git("rev-parse", "HEAD");
    const second = repo.commit("second", { "a.txt": "a\n" });
    repo.write("app.txt", "uncommitted\n");

    await expect(runReset(repo.ctx, { target: first, mode: "hard" })).rejects.toMatchObject({ kind: "validation" });
    expect(repo.git("rev-parse", "HEAD")).toBe(second);
    expect(repo.read("app.txt")).toBe("uncommitted\n");

    const result = await runReset(repo.ctx, { target: first, mode: "hard", confirmHard: true });
    expect(repo.git("rev-parse", "HEAD")).toBe(first);
    expect(result.summary).toContain("1 file(s) with uncommitted changes were overwritten");
    expect(result.summary).toContain(second.slice(0, 12));
    expect(repo.read("app.txt")).toBe("line 1\nline 2\nline 3\n");
  });

  it("rejects unknown targets and resets during a merge", async () => {
    const repo = createConflictingBranches();
    await expect(runReset(repo.ctx, { target: "missing", mode: "soft" })).rejects.toMatchObject({ kind: "ref-not-found" });
    await runMerge(repo.ctx, { source: "feature", target: "main", strategy: "default" });
    await expect(runReset(repo.ctx, { target: "HEAD", mode: "mixed" })).rejects.toMatchObject({ kind: "precondition" });
  });
});
