import { describe, expect, it } from "vitest";
import { isReliableEvidence, resolveEndpoint } from "@/lib/merge-message";
import { computeBranchFocus } from "./focus";

// Topological order (children first) of the brief's example:
// main A-B-M2-N, dev C-D-M1 (M1 merges feature F-G), M2 merges dev.
const HISTORY = [
  { hash: "N", parents: ["M2"] },
  { hash: "M2", parents: ["B", "M1"] },
  { hash: "B", parents: ["A"] },
  { hash: "M1", parents: ["D", "G"] },
  { hash: "D", parents: ["C"] },
  { hash: "G", parents: ["F"] },
  { hash: "F", parents: ["C"] },
  { hash: "C", parents: ["A"] },
  { hash: "A", parents: [] },
];

describe("computeBranchFocus", () => {
  it("returns null when nothing is focused", () => {
    expect(computeBranchFocus([], HISTORY)).toBeNull();
  });

  it("collects a branch's history and the merges that brought it elsewhere", () => {
    const focus = computeBranchFocus([{ name: "feature", hash: "G" }], HISTORY)!;
    expect([...focus.inHistory].sort()).toEqual(["A", "C", "F", "G"]);
    // M1 merged feature into dev; M2 only has M1 as parent, which is not feature's own history.
    expect([...focus.relatedMerges]).toEqual(["M1"]);
    expect(focus.comparison).toBeNull();
  });

  it("unites several branches", () => {
    const focus = computeBranchFocus(
      [
        { name: "feature", hash: "G" },
        { name: "main-before-merge", hash: "B" },
        { name: "other", hash: "D" },
      ],
      HISTORY,
    )!;
    expect([...focus.inHistory].sort()).toEqual(["A", "B", "C", "D", "F", "G"]);
    expect([...focus.relatedMerges].sort()).toEqual(["M1", "M2"]);
    expect(focus.comparison).toBeNull();
  });

  it("compares two branches: unique commits per side and the divergence point", () => {
    const comparison = computeBranchFocus(
      [
        { name: "dev", hash: "M1" },
        { name: "main", hash: "B" },
      ],
      HISTORY,
    )!.comparison!;
    expect(comparison).toMatchObject({ a: "dev", b: "main", onlyA: 5, onlyB: 1, shared: 1, divergedAt: "A" });
    expect(comparison.sideByHash.get("G")).toBe("a");
    expect(comparison.sideByHash.get("B")).toBe("b");
    expect(comparison.sideByHash.get("A")).toBe("both");
    expect(comparison.sideByHash.has("N")).toBe(false);
  });

  it("finds the newest shared commit after a branch was merged and continued", () => {
    const comparison = computeBranchFocus(
      [
        { name: "main", hash: "N" },
        { name: "feature", hash: "G" },
      ],
      HISTORY,
    )!.comparison!;
    expect(comparison.onlyB).toBe(0);
    expect(comparison.divergedAt).toBe("G");
  });

  it("reports no divergence point for unrelated histories", () => {
    const comparison = computeBranchFocus(
      [
        { name: "a", hash: "x" },
        { name: "b", hash: "y" },
      ],
      [
        { hash: "x", parents: [] },
        { hash: "y", parents: [] },
      ],
    )!.comparison!;
    expect(comparison).toMatchObject({ onlyA: 1, onlyB: 1, shared: 0, divergedAt: null });
  });
});

describe("resolveEndpoint", () => {
  it("prefers the message name and records whether refs confirm it", () => {
    expect(resolveEndpoint("feature", true)).toEqual({ name: "feature", evidence: "message-and-refs", candidates: [] });
    expect(resolveEndpoint("feature", false, ["main"])).toEqual({ name: "feature", evidence: "message", candidates: [] });
  });

  it("uses ancestry only when it is unambiguous", () => {
    expect(resolveEndpoint(null, false, ["main"])).toEqual({ name: "main", evidence: "ancestry", candidates: [] });
    expect(resolveEndpoint(null, false, ["main", "release"])).toEqual({ name: null, evidence: "none", candidates: ["main", "release"] });
    expect(resolveEndpoint(null, false)).toEqual({ name: null, evidence: "none", candidates: [] });
  });

  it("treats message-only names as unreliable", () => {
    expect(isReliableEvidence("message-and-refs")).toBe(true);
    expect(isReliableEvidence("ancestry")).toBe(true);
    expect(isReliableEvidence("message")).toBe(false);
    expect(isReliableEvidence("none")).toBe(false);
  });
});
