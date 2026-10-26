import { describe, expect, it } from "vitest";
import { layoutGraph, reachableFrom } from "./layout";

// Topological order: children first.
const MERGE_HISTORY = [
  { hash: "M", parents: ["B", "F2"] }, // merge of feature into main
  { hash: "F2", parents: ["F1"] },
  { hash: "B", parents: ["A"] },
  { hash: "F1", parents: ["A"] },
  { hash: "A", parents: [] },
];

describe("layoutGraph", () => {
  it("keeps a linear history in a single lane", () => {
    const layout = layoutGraph([
      { hash: "c", parents: ["b"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);
    expect(layout.rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(layout.laneCount).toBe(1);
    expect(layout.rows.some((row) => row.isMerge || row.isFork)).toBe(false);
  });

  it("branches a merge commit's second parent into its own lane", () => {
    const layout = layoutGraph(MERGE_HISTORY);
    const [merge, f2, b, f1, a] = layout.rows;
    expect(merge.isMerge).toBe(true);
    expect(merge.lane).toBe(0);
    expect(f2.lane).toBe(1);
    expect(b.lane).toBe(0);
    expect(f1.lane).toBe(1);
    expect(a.lane).toBe(0);
    expect(layout.laneCount).toBe(2);
    expect(merge.segments.filter((segment) => segment.kind === "out").map((segment) => segment.to)).toEqual([0, 1]);
  });

  it("marks divergence points and tips from real parent links", () => {
    const layout = layoutGraph(MERGE_HISTORY);
    const byHash = new Map(layout.rows.map((row) => [row.hash, row]));
    expect(byHash.get("A")!.isFork).toBe(true);
    expect(byHash.get("B")!.isFork).toBe(false);
    expect(byHash.get("M")!.isTip).toBe(true);
    expect(byHash.get("F1")!.isTip).toBe(false);
  });

  it("routes the side branch back into the shared ancestor's lane", () => {
    const layout = layoutGraph(MERGE_HISTORY);
    const sideBranchFirstCommit = layout.rows[3];
    expect(sideBranchFirstCommit.lane).toBe(1);
    expect(sideBranchFirstCommit.segments.filter((segment) => segment.kind === "out").map((segment) => segment.to)).toEqual([0]);
  });

  it("starts a new lane for an unrelated branch tip", () => {
    const layout = layoutGraph([
      { hash: "x", parents: ["a"] },
      { hash: "y", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);
    expect(layout.rows[0].lane).toBe(0);
    expect(layout.rows[1].lane).toBe(1);
  });

  it("handles octopus merges and missing (not yet loaded) parents", () => {
    const layout = layoutGraph([
      { hash: "o", parents: ["p1", "p2", "p3"] },
      { hash: "p1", parents: ["unloaded"] },
    ]);
    expect(layout.rows[0].segments.filter((segment) => segment.kind === "out")).toHaveLength(3);
    expect(layout.laneCount).toBe(3);
  });

  it("scales to large histories", () => {
    const commits = Array.from({ length: 20_000 }, (_, index) => ({
      hash: `c${index}`,
      parents: index === 19_999 ? [] : [`c${index + 1}`],
    }));
    const started = Date.now();
    expect(layoutGraph(commits).rows).toHaveLength(20_000);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("reachableFrom", () => {
  it("collects the ancestry of a branch tip", () => {
    const parents = new Map(MERGE_HISTORY.map((commit) => [commit.hash, commit.parents]));
    expect([...reachableFrom("F2", parents)].sort()).toEqual(["A", "F1", "F2"]);
    expect(reachableFrom("M", parents).size).toBe(5);
  });
});
