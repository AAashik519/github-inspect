import { afterEach, describe, expect, it } from "vitest";
import { layoutGraph } from "@/lib/graph/layout";
import { compareBranches, compareRevisions, countAheadBehind, findMergeBase } from "./compare";
import { getCommitDetails } from "./commits";
import { readCommits, searchCommits } from "./history";
import { inferMergeNames } from "@/lib/merge-message";
import { mergeAnatomy, mergeHistory } from "./merge";
import { listRefs } from "./refs";
import { listBranches, uniqueCommits } from "./branches";
import { cleanupTempDirs, createRepo } from "./test-helpers";

afterEach(cleanupTempDirs);

/** main: A - B - M ; feature: A - F1 - F2 (merged into main by M) */
function createMergedHistory() {
  const repo = createRepo();
  repo.git("switch", "-q", "-c", "feature");
  repo.commit("feature one", { "f.txt": "1" });
  repo.commit("feature two", { "f.txt": "2" });
  repo.git("switch", "-q", "main");
  repo.commit("main work", { "m.txt": "m" });
  repo.git("merge", "-q", "--no-ff", "-m", "Merge branch 'feature' into main", "feature");
  return repo;
}

describe("commit history and ancestry", () => {
  it("returns an empty list for a repository without commits", async () => {
    const repo = createRepo({ initialCommit: false });
    expect(await readCommits(repo.ctx, { limit: 10, skip: 0 })).toEqual({ commits: [], hasMore: false });
    expect((await searchCommits(repo.ctx, "anything")).commits).toEqual([]);
  });

  it("lists commits in topological order with real parents", async () => {
    const repo = createMergedHistory();
    const { commits } = await readCommits(repo.ctx, { limit: 50, skip: 0 });
    expect(commits.map((commit) => commit.subject)).toEqual([
      "Merge branch 'feature' into main",
      "main work",
      "feature two",
      "feature one",
      "initial commit",
    ].sort((a, b) => commits.findIndex((c) => c.subject === a) - commits.findIndex((c) => c.subject === b)));

    const merge = commits[0];
    expect(merge.parents).toHaveLength(2);
    const positions = new Map(commits.map((commit, index) => [commit.hash, index]));
    for (const commit of commits) for (const parent of commit.parents) expect(positions.get(parent)!).toBeGreaterThan(positions.get(commit.hash)!);
  });

  it("feeds the graph layout: merge commit gets two outgoing edges and the fork is detected", async () => {
    const repo = createMergedHistory();
    const { commits } = await readCommits(repo.ctx, { limit: 50, skip: 0 });
    const layout = layoutGraph(commits);
    const merge = layout.rows[0];
    expect(merge.isMerge).toBe(true);
    expect(merge.segments.filter((segment) => segment.kind === "out")).toHaveLength(2);
    const root = layout.rows.find((row) => row.parents.length === 0)!;
    expect(root.isFork).toBe(true);
    expect(layout.laneCount).toBe(2);
  });

  it("supports pagination without gaps or duplicates", async () => {
    const repo = createRepo();
    for (let index = 0; index < 12; index++) repo.commit(`commit ${index}`, { "n.txt": String(index) });
    const first = await readCommits(repo.ctx, { limit: 5, skip: 0 });
    const second = await readCommits(repo.ctx, { limit: 5, skip: 5 });
    const third = await readCommits(repo.ctx, { limit: 5, skip: 10 });
    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false]);
    const all = [...first.commits, ...second.commits, ...third.commits];
    expect(new Set(all.map((commit) => commit.hash)).size).toBe(13);
  });

  it("restricts the walk to selected refs and ignores unknown ones", async () => {
    const repo = createMergedHistory();
    repo.git("switch", "-q", "-c", "side", "main~1");
    repo.commit("side only", { "s.txt": "s" });
    const refs = await listRefs(repo.ctx);
    const side = refs.find((ref) => ref.name === "side")!;
    const { commits } = await readCommits(repo.ctx, { limit: 50, skip: 0, refs: [side.fullName, "refs/heads/does-not-exist; rm -rf /"] });
    expect(commits.some((commit) => commit.subject === "side only")).toBe(true);
    expect(commits.some((commit) => commit.subject === "Merge branch 'feature' into main")).toBe(false);
    expect(await readCommits(repo.ctx, { limit: 5, skip: 0, refs: [] })).toEqual({ commits: [], hasMore: false });
  });

  it("handles a repository without any merge commits", async () => {
    const repo = createRepo();
    repo.commit("linear", { "a.txt": "a" });
    expect((await mergeHistory(repo.ctx, {})).events).toEqual([]);
    const layout = layoutGraph((await readCommits(repo.ctx, { limit: 10, skip: 0 })).commits);
    expect(layout.laneCount).toBe(1);
  });

  it("copes with many commits and branches", async () => {
    const repo = createRepo();
    for (let index = 0; index < 60; index++) {
      repo.git("branch", `topic/${index}`);
      if (index % 10 === 0) repo.commit(`work ${index}`, { "w.txt": String(index) });
    }
    const branches = await listBranches(repo.ctx, "main");
    expect(branches).toHaveLength(61);
    const { commits } = await readCommits(repo.ctx, { limit: 100, skip: 0 });
    expect(commits.length).toBe(7);
  });

  it("finds commits by hash prefix, message, author and branch name", async () => {
    const repo = createMergedHistory();
    const hash = repo.git("rev-parse", "HEAD");
    expect((await searchCommits(repo.ctx, hash.slice(0, 8))).commits[0].hash).toBe(hash);
    expect((await searchCommits(repo.ctx, "FEATURE two")).commits.map((commit) => commit.subject)).toContain("feature two");
    expect((await searchCommits(repo.ctx, "Test Author")).commits.length).toBeGreaterThan(3);
    expect((await searchCommits(repo.ctx, "feat")).refs.map((ref) => ref.name)).toContain("feature");
  });
});

describe("merge commit detection", () => {
  it("lists real merge events with parents and refs", async () => {
    const repo = createMergedHistory();
    const { events } = await mergeHistory(repo.ctx, {});
    expect(events).toHaveLength(1);
    expect(events[0].parents).toHaveLength(2);
    expect(events[0].inferredSource).toBe("feature");
    expect(events[0].inferredTarget).toBe("main");
    expect(events[0].parentRefs[1]).toContain("feature");
  });

  it("describes the anatomy of a merge: base, unique commits per parent, containing branches", async () => {
    const repo = createMergedHistory();
    const anatomy = await mergeAnatomy(repo.ctx, "HEAD");
    expect(anatomy.parents.map((parent) => parent.uniqueCommits)).toEqual([1, 2]);
    expect(anatomy.mergeBase).toBe(repo.git("rev-list", "--max-parents=0", "HEAD"));
    expect(anatomy.branchesContaining).toContain("main");
    expect(anatomy.files.map((file) => file.path).sort()).toEqual(["f.txt"]);
  });

  it("handles octopus merges (more than two parents)", async () => {
    const repo = createRepo();
    for (const name of ["a", "b", "c"]) {
      repo.git("switch", "-q", "-c", name, "main");
      repo.commit(`${name} work`, { [`${name}.txt`]: name });
    }
    repo.git("switch", "-q", "main");
    repo.git("merge", "-q", "--no-ff", "a", "b", "c", "-m", "octopus");
    const anatomy = await mergeAnatomy(repo.ctx, "HEAD");
    expect(anatomy.parents).toHaveLength(4);
    expect(layoutGraph((await readCommits(repo.ctx, { limit: 20, skip: 0 })).commits).laneCount).toBeGreaterThanOrEqual(4);
  });

  it("refuses to describe a non-merge commit", async () => {
    const repo = createRepo();
    await expect(mergeAnatomy(repo.ctx, "HEAD")).rejects.toMatchObject({ kind: "precondition" });
  });

  it("infers source and target only from recognised messages", () => {
    expect(inferMergeNames("Merge branch 'dev' into release")).toEqual({ source: "dev", target: "release" });
    expect(inferMergeNames("Merge remote-tracking branch 'origin/dev'")).toEqual({ source: "origin/dev", target: null });
    expect(inferMergeNames("Merge pull request #12 from acme/fix-login")).toEqual({ source: "acme/fix-login", target: null });
    expect(inferMergeNames("combine stuff")).toEqual({ source: null, target: null });
  });
});

describe("ahead/behind and comparison", () => {
  it("counts ahead/behind from ancestry, not timestamps", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "feature");
    repo.commit("f1", { "f.txt": "1" });
    repo.commit("f2", { "f.txt": "2" });
    repo.git("switch", "-q", "main");
    repo.commit("m1", { "m.txt": "1" });
    expect(await countAheadBehind(repo.ctx, "main", "feature")).toEqual({ ahead: 2, behind: 1 });
  });

  it("explains a diverged comparison with unique commits and changed files", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "feature");
    repo.commit("f1", { "f.txt": "1", "app.txt": "changed\n" });
    repo.commit("f2", { "f.txt": "2" });
    repo.git("switch", "-q", "main");
    repo.commit("m1", { "m.txt": "1" });

    const comparison = await compareBranches(repo.ctx, "feature", "main");
    expect(comparison).toMatchObject({ ahead: 2, behind: 1, relation: "diverged" });
    expect(comparison.sourceOnly.map((commit) => commit.subject)).toEqual(["f2", "f1"]);
    expect(comparison.targetOnly.map((commit) => commit.subject)).toEqual(["m1"]);
    expect(comparison.mergeBase).toBe(await findMergeBase(repo.ctx, "main", "feature"));
    // Three-dot diff: only what the feature branch introduced, not main's m.txt.
    expect(comparison.files.map((file) => `${file.status}:${file.path}`).sort()).toEqual(["A:f.txt", "M:app.txt"]);
  });

  it("classifies identical, ahead, behind and unrelated histories", async () => {
    const repo = createRepo();
    repo.git("branch", "same");
    repo.git("switch", "-q", "-c", "ahead");
    repo.commit("a1", { "a.txt": "1" });
    expect((await compareBranches(repo.ctx, "same", "main")).relation).toBe("identical");
    expect((await compareBranches(repo.ctx, "ahead", "main")).relation).toBe("ahead");
    expect((await compareBranches(repo.ctx, "main", "ahead")).relation).toBe("behind");

    repo.git("switch", "-q", "--orphan", "island");
    repo.commit("island root", { "i.txt": "i" });
    const unrelated = await compareBranches(repo.ctx, "island", "main");
    expect(unrelated.relation).toBe("unrelated");
    expect(unrelated.mergeBase).toBeNull();
  });

  it("compares two arbitrary commits", async () => {
    const repo = createRepo();
    const first = repo.git("rev-parse", "HEAD");
    const second = repo.commit("second", { "new.txt": "n" });
    const comparison = await compareRevisions(repo.ctx, first, second);
    expect(comparison.files).toEqual([{ path: "new.txt", status: "A", additions: 1, deletions: 0, binary: false }]);
  });

  it("lists commits unique to a branch", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "topic");
    repo.commit("t1", { "t.txt": "1" });
    expect((await uniqueCommits(repo.ctx, "topic", "main")).map((commit) => commit.subject)).toEqual(["t1"]);
  });
});

describe("commit details", () => {
  it("returns parents, containing branches, tags and file stats", async () => {
    const repo = createMergedHistory();
    repo.git("tag", "release-1");
    const details = await getCommitDetails(repo.ctx, "HEAD");
    expect(details.isMerge).toBe(true);
    expect(details.diffBase).toBe("first-parent");
    expect(details.tags).toEqual(["release-1"]);
    expect(details.branches).toContain("main");
    expect(details.parentSummaries.map((parent) => parent.subject)).toEqual(["main work", "feature two"]);
    expect(details.files).toEqual([{ path: "f.txt", status: "A", additions: 1, deletions: 0, binary: false }]);
  });

  it("handles root commits and rejects unknown revisions", async () => {
    const repo = createRepo();
    const root = await getCommitDetails(repo.ctx, "HEAD");
    expect(root.diffBase).toBe("root");
    expect(root.files.map((file) => file.path).sort()).toEqual(["README.md", "app.txt"]);
    await expect(getCommitDetails(repo.ctx, "nope")).rejects.toMatchObject({ kind: "ref-not-found" });
    await expect(getCommitDetails(repo.ctx, "--output=/tmp/x")).rejects.toMatchObject({ kind: "validation" });
  });
});
