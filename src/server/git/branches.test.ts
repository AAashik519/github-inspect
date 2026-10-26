import { afterEach, describe, expect, it } from "vitest";
import { checkoutRevision, createBranch, deleteBranch, deleteRemoteBranch, listBranches, renameBranch, setUpstream } from "./branches";
import { currentBranch } from "./context";
import { cleanupTempDirs, createRepo, createRepoWithRemote } from "./test-helpers";

afterEach(cleanupTempDirs);

describe("branch operations", () => {
  it("creates a branch and optionally switches to it", async () => {
    const repo = createRepo();
    const result = await createBranch(repo.ctx, { name: "feature/login", checkout: true });
    expect(result.summary).toContain("switched");
    expect(await currentBranch(repo.ctx)).toBe("feature/login");

    await createBranch(repo.ctx, { name: "other" });
    expect(await currentBranch(repo.ctx)).toBe("feature/login");
  });

  it("creates a branch from a selected commit", async () => {
    const repo = createRepo();
    const first = repo.git("rev-parse", "HEAD");
    repo.commit("second", { "a.txt": "a" });
    await createBranch(repo.ctx, { name: "from-first", startPoint: first });
    expect(repo.git("rev-parse", "from-first")).toBe(first);
  });

  it("rejects invalid, duplicate and option-like names", async () => {
    const repo = createRepo();
    await expect(createBranch(repo.ctx, { name: "bad name" })).rejects.toMatchObject({ kind: "validation" });
    await expect(createBranch(repo.ctx, { name: "-D" })).rejects.toMatchObject({ kind: "validation" });
    await expect(createBranch(repo.ctx, { name: "a..b" })).rejects.toMatchObject({ kind: "validation" });
    await expect(createBranch(repo.ctx, { name: "main" })).rejects.toMatchObject({ kind: "ref-exists" });
    await expect(createBranch(repo.ctx, { name: "x", startPoint: "missing" })).rejects.toMatchObject({ kind: "ref-not-found" });
  });

  it("switches between local branches and refuses unknown ones", async () => {
    const repo = createRepo();
    repo.git("branch", "dev");
    await checkoutRevision(repo.ctx, { name: "dev" });
    expect(await currentBranch(repo.ctx)).toBe("dev");
    await expect(checkoutRevision(repo.ctx, { name: "ghost" })).rejects.toMatchObject({ kind: "ref-not-found" });
  });

  it("detaches HEAD at a commit and reports it", async () => {
    const repo = createRepo();
    const hash = repo.git("rev-parse", "HEAD");
    repo.commit("second", { "a.txt": "a" });
    await checkoutRevision(repo.ctx, { name: hash, detached: true });
    expect(await currentBranch(repo.ctx)).toBeNull();
    expect(repo.git("rev-parse", "HEAD")).toBe(hash);
  });

  it("renames a branch", async () => {
    const repo = createRepo();
    repo.git("branch", "old-name");
    await renameBranch(repo.ctx, { from: "old-name", to: "new-name" });
    expect(repo.git("branch", "--list", "new-name")).toContain("new-name");
    expect(repo.git("branch", "--list", "old-name")).toBe("");
    await expect(renameBranch(repo.ctx, { from: "new-name", to: "main" })).rejects.toMatchObject({ kind: "ref-exists" });
  });

  it("protects the current branch and explains Git's restriction", async () => {
    const repo = createRepo();
    await expect(deleteBranch(repo.ctx, { name: "main" })).rejects.toMatchObject({ kind: "precondition" });
    expect(repo.git("branch", "--list", "main")).toContain("main");
  });

  it("refuses to delete an unmerged branch unless forced, and reports the recovery hash", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "wip");
    const tip = repo.commit("unmerged work", { "w.txt": "w" });
    repo.git("switch", "-q", "main");

    await expect(deleteBranch(repo.ctx, { name: "wip" })).rejects.toMatchObject({ kind: "not-fully-merged" });
    const result = await deleteBranch(repo.ctx, { name: "wip", force: true });
    expect(result.summary).toContain(tip);
    expect(repo.git("branch", "--list", "wip")).toBe("");
  });

  it("deletes a merged branch without force", async () => {
    const repo = createRepo();
    repo.git("branch", "merged");
    await deleteBranch(repo.ctx, { name: "merged" });
    expect(repo.git("branch", "--list", "merged")).toBe("");
  });
});

describe("branch list", () => {
  it("shows tracking counts, upstream and merge status relative to a target", async () => {
    const { local } = createRepoWithRemote();
    local.git("switch", "-q", "-c", "feature");
    local.commit("f1", { "f.txt": "1" });
    local.git("push", "-q", "-u", "origin", "feature");
    local.commit("f2", { "f.txt": "2" });
    local.git("branch", "no-upstream", "main");
    local.git("switch", "-q", "main");
    local.commit("m1", { "m.txt": "1" });

    const branches = await listBranches(local.ctx, "main");
    const byName = Object.fromEntries(branches.map((branch) => [branch.name, branch]));
    expect(byName.main).toMatchObject({ isCurrent: true, upstream: "origin/main", trackingAhead: 1, trackingBehind: 0 });
    expect(byName.feature).toMatchObject({ upstream: "origin/feature", trackingAhead: 1, trackingBehind: 0 });
    expect(byName.feature.relative).toEqual({ ahead: 2, behind: 1, merged: false });
    expect(byName["no-upstream"]).toMatchObject({ upstream: null, trackingAhead: null });
    expect(byName["no-upstream"].relative).toEqual({ ahead: 0, behind: 1, merged: true });
    expect(byName["origin/main"].kind).toBe("remote");
    expect(branches.some((branch) => branch.name.endsWith("/HEAD"))).toBe(false);
  });

  it("flags an upstream whose remote branch was deleted", async () => {
    const { local, remoteDir } = createRepoWithRemote();
    local.git("push", "-q", "origin", "main:gone-soon");
    local.git("branch", "--set-upstream-to=origin/gone-soon", "main");
    local.git("--git-dir", remoteDir, "branch", "-q", "-D", "gone-soon");
    local.git("fetch", "-q", "--prune");
    const [current] = await listBranches(local.ctx);
    expect(current.upstreamGone).toBe(true);
  });
});

describe("upstream management", () => {
  it("sets and unsets the upstream, rejecting unknown remote branches", async () => {
    const { local } = createRepoWithRemote();
    local.git("branch", "topic");
    await expect(setUpstream(local.ctx, { name: "topic", upstream: "origin/topic" })).rejects.toMatchObject({ kind: "ref-not-found" });
    await setUpstream(local.ctx, { name: "topic", upstream: "origin/main" });
    expect(local.git("rev-parse", "--abbrev-ref", "topic@{upstream}")).toBe("origin/main");
    await setUpstream(local.ctx, { name: "topic", upstream: null });
    expect(local.git("for-each-ref", "--format=%(upstream)", "refs/heads/topic")).toBe("");
  });

  it("creates a tracking branch from a remote branch", async () => {
    const { local } = createRepoWithRemote();
    local.git("push", "-q", "origin", "main:release");
    local.git("fetch", "-q");
    await checkoutRevision(local.ctx, { name: "origin/release" });
    expect(await currentBranch(local.ctx)).toBe("release");
    expect(local.git("rev-parse", "--abbrev-ref", "release@{upstream}")).toBe("origin/release");
  });

  it("requires typing the branch name to delete a remote branch", async () => {
    const { local, remoteDir } = createRepoWithRemote();
    local.git("push", "-q", "origin", "main:old");
    await expect(deleteRemoteBranch(local.ctx, { remote: "origin", name: "old", confirmName: "nope" })).rejects.toMatchObject({ kind: "validation" });
    expect(local.git("--git-dir", remoteDir, "branch", "--list", "old")).toContain("old");
    await deleteRemoteBranch(local.ctx, { remote: "origin", name: "old", confirmName: "old" });
    expect(local.git("--git-dir", remoteDir, "branch", "--list", "old")).toBe("");
  });
});
