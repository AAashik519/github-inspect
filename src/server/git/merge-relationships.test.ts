import { afterEach, describe, expect, it } from "vitest";
import { layoutGraph } from "@/lib/graph/layout";
import { readCommits } from "./history";
import { mergeAnatomy, mergeHistory } from "./merge";
import { cleanupTempDirs, createRepo, type TempRepo } from "./test-helpers";

afterEach(() => {
  delete process.env.GIT_AUTHOR_DATE;
  delete process.env.GIT_COMMITTER_DATE;
  cleanupTempDirs();
});

/** Runs git with both author and committer date pinned, so date filters and ordering are deterministic. */
function at<T>(date: string, run: () => T): T {
  process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE = date;
  try {
    return run();
  } finally {
    delete process.env.GIT_AUTHOR_DATE;
    delete process.env.GIT_COMMITTER_DATE;
  }
}

/**
 * The history from the feature brief:
 *
 *   main ── A ── B ───────── M2 ── N
 *            \              /
 *   dev       C ── D ──── M1
 *              \          /
 *   feature     F ── G ──
 *
 * M1 = "Merge branch 'feature' into dev", M2 = "Merge branch 'dev'" (Git omits "into main" by default).
 */
function createBriefHistory(): { repo: TempRepo; m1: string; m2: string } {
  const repo = createRepo();
  at("2024-01-02T10:00:00Z", () => {
    repo.git("switch", "-q", "-c", "dev");
    repo.commit("C", { "c.txt": "c" });
  });
  at("2024-01-03T10:00:00Z", () => {
    repo.git("switch", "-q", "-c", "feature");
    repo.commit("F", { "f.txt": "f" });
    repo.commit("G", { "g.txt": "g" });
  });
  const m1 = at("2024-01-05T10:00:00Z", () => {
    repo.git("switch", "-q", "dev");
    repo.commit("D", { "d.txt": "d" });
    repo.git("merge", "-q", "--no-ff", "-m", "Merge branch 'feature' into dev", "feature");
    return repo.git("rev-parse", "HEAD");
  });
  const m2 = at("2024-02-10T10:00:00Z", () => {
    repo.git("switch", "-q", "main");
    repo.commit("B", { "b.txt": "b" });
    repo.git("merge", "-q", "--no-ff", "-m", "Merge branch 'dev'", "dev");
    return repo.git("rev-parse", "HEAD");
  });
  at("2024-02-11T10:00:00Z", () => repo.commit("N", { "n.txt": "n" }));
  return { repo, m1, m2 };
}

describe("merge source and target", () => {
  it("confirms names from the message against current branch ancestry", async () => {
    const { repo, m1 } = createBriefHistory();
    const { relationship } = await mergeAnatomy(repo.ctx, m1);
    expect(relationship.source).toEqual({ name: "feature", evidence: "message-and-refs", candidates: [] });
    expect(relationship.target).toEqual({ name: "dev", evidence: "message-and-refs", candidates: [] });
  });

  it("finds the receiving branch from first-parent ancestry when the message does not name it", async () => {
    const { repo, m2 } = createBriefHistory();
    const { relationship } = await mergeAnatomy(repo.ctx, m2);
    expect(relationship.source).toMatchObject({ name: "dev", evidence: "message-and-refs" });
    expect(relationship.target).toEqual({ name: "main", evidence: "ancestry", candidates: [] });
  });

  it("marks a source named only by the message as unverified once the branch is gone", async () => {
    const { repo, m1 } = createBriefHistory();
    repo.git("branch", "-q", "-D", "feature");
    const { relationship } = await mergeAnatomy(repo.ctx, m1);
    expect(relationship.source).toMatchObject({ name: "feature", evidence: "message" });
    expect(relationship.target.evidence).toBe("message-and-refs");
  });

  it("does not trust a message name that current refs contradict", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "topic");
    repo.commit("t", { "t.txt": "t" });
    repo.git("switch", "-q", "main");
    repo.commit("m", { "m.txt": "m" });
    // The message claims a target that does not contain the merge.
    repo.git("branch", "release", "main~1");
    repo.git("merge", "-q", "--no-ff", "-m", "Merge branch 'topic' into release", "topic");
    const { relationship } = await mergeAnatomy(repo.ctx, "HEAD");
    expect(relationship.target).toMatchObject({ name: "release", evidence: "message" });
  });

  it("reports 'none' with candidates when several branches share the first-parent line", async () => {
    const { repo, m2 } = createBriefHistory();
    repo.git("branch", "release", "main");
    const { relationship } = await mergeAnatomy(repo.ctx, m2);
    expect(relationship.target).toEqual({ name: null, evidence: "none", candidates: ["main", "release"] });
  });

  it("cannot name a source for a custom merge message", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "topic");
    repo.commit("t", { "t.txt": "t" });
    repo.git("switch", "-q", "main");
    repo.commit("m", { "m.txt": "m" });
    repo.git("merge", "-q", "--no-ff", "-m", "combine work", "topic");
    const { relationship } = await mergeAnatomy(repo.ctx, "HEAD");
    expect(relationship.source).toEqual({ name: null, evidence: "none", candidates: [] });
    expect(relationship.target).toMatchObject({ name: "main", evidence: "ancestry" });
  });
});

describe("merge history filters", () => {
  it("lists merges with files changed relative to the first parent", async () => {
    const { repo, m1, m2 } = createBriefHistory();
    const page = await mergeHistory(repo.ctx, {});
    expect(page.events.map((event) => event.hash)).toEqual([m2, m1]);
    expect(page.total).toBe(2);
    expect(page.events.find((event) => event.hash === m1)?.filesChanged).toBe(2); // f.txt, g.txt
    expect(page.events.find((event) => event.hash === m2)?.filesChanged).toBe(4); // c, d, f, g
  });

  it("orders chronologically on request", async () => {
    const { repo, m1, m2 } = createBriefHistory();
    expect((await mergeHistory(repo.ctx, { order: "oldest" })).events.map((event) => event.hash)).toEqual([m1, m2]);
  });

  it("filters by branch using ancestry: merges it contains and merges that brought it in", async () => {
    const { repo, m1, m2 } = createBriefHistory();
    const feature = await mergeHistory(repo.ctx, { ref: "refs/heads/feature" });
    expect(feature.events.map((event) => [event.hash, event.involvement])).toEqual([[m1, "merged-from"]]);

    const dev = await mergeHistory(repo.ctx, { ref: "refs/heads/dev" });
    expect(dev.events.map((event) => [event.hash, event.involvement])).toEqual([
      [m2, "merged-from"],
      [m1, "in-history"],
    ]);

    const main = await mergeHistory(repo.ctx, { ref: "refs/heads/main" });
    expect(main.events.every((event) => event.involvement === "in-history")).toBe(true);
    expect(main.total).toBe(2);
  });

  it("rejects an unknown branch filter", async () => {
    const { repo } = createBriefHistory();
    await expect(mergeHistory(repo.ctx, { ref: "refs/heads/missing" })).rejects.toMatchObject({ kind: "ref-not-found" });
  });

  it("filters by date range and search text", async () => {
    const { repo, m1, m2 } = createBriefHistory();
    expect((await mergeHistory(repo.ctx, { since: "2024-02-01" })).events.map((event) => event.hash)).toEqual([m2]);
    expect((await mergeHistory(repo.ctx, { until: "2024-01-31" })).events.map((event) => event.hash)).toEqual([m1]);
    expect((await mergeHistory(repo.ctx, { query: "FEATURE" })).events.map((event) => event.hash)).toEqual([m1]);
    expect((await mergeHistory(repo.ctx, { query: m2.slice(0, 7) })).events.map((event) => event.hash)).toEqual([m2]);
    await expect(mergeHistory(repo.ctx, { since: "last week" })).rejects.toMatchObject({ kind: "validation" });
  });

  it("pages through filtered results", async () => {
    const { repo, m1, m2 } = createBriefHistory();
    const first = await mergeHistory(repo.ctx, { limit: 1 });
    expect(first).toMatchObject({ total: 2, hasMore: true });
    expect(first.events[0].hash).toBe(m2);
    const second = await mergeHistory(repo.ctx, { limit: 1, skip: 1 });
    expect(second.events[0].hash).toBe(m1);
    expect(second.hasMore).toBe(false);
  });
});

describe("fast-forward histories", () => {
  it("leaves no merge commit, so no merge event, and keeps the graph in one lane", async () => {
    const repo = createRepo();
    repo.git("switch", "-q", "-c", "feature");
    repo.commit("f1", { "f.txt": "1" });
    repo.commit("f2", { "f.txt": "2" });
    repo.git("switch", "-q", "main");
    repo.git("merge", "-q", "--ff-only", "feature");

    expect(repo.git("rev-parse", "main")).toBe(repo.git("rev-parse", "feature"));
    expect((await mergeHistory(repo.ctx, {})).events).toEqual([]);
    expect((await mergeHistory(repo.ctx, { ref: "refs/heads/feature" })).events).toEqual([]);
    const layout = layoutGraph((await readCommits(repo.ctx, { limit: 20, skip: 0 })).commits);
    expect(layout.laneCount).toBe(1);
    expect(layout.rows.some((row) => row.isMerge || row.isFork)).toBe(false);
  });
});
