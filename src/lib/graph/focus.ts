// Which loaded commits relate to the branches the user focused on. Everything is derived from parent links.

import { reachableFrom, type LayoutCommit } from "./layout";

export type ComparisonSide = "a" | "b" | "both";

export interface BranchComparisonView {
  a: string;
  b: string;
  onlyA: number;
  onlyB: number;
  shared: number;
  /** Newest commit both branches share in the loaded history: where they diverged. Null for unrelated histories. */
  divergedAt: string | null;
  sideByHash: Map<string, ComparisonSide>;
}

export interface BranchFocus {
  /** Commits in the history of at least one focused branch. */
  inHistory: Set<string>;
  /** Merge commits outside that history that have a parent inside it: they brought a focused branch's work elsewhere. */
  relatedMerges: Set<string>;
  /** Present when exactly two branches are focused. */
  comparison: BranchComparisonView | null;
}

/** `commits` must be in topological order (children first), as loaded for the graph. */
export function computeBranchFocus(tips: { name: string; hash: string }[], commits: LayoutCommit[]): BranchFocus | null {
  if (tips.length === 0) return null;
  const parentsByHash = new Map(commits.map((commit) => [commit.hash, commit.parents]));
  const histories = tips.map((tip) => reachableFrom(tip.hash, parentsByHash));

  const inHistory = new Set<string>();
  for (const history of histories) for (const hash of history) inHistory.add(hash);

  const relatedMerges = new Set<string>();
  for (const commit of commits) {
    if (commit.parents.length > 1 && !inHistory.has(commit.hash) && commit.parents.some((parent) => inHistory.has(parent))) relatedMerges.add(commit.hash);
  }

  let comparison: BranchComparisonView | null = null;
  if (tips.length === 2) {
    const [historyA, historyB] = histories;
    const sideByHash = new Map<string, ComparisonSide>();
    let onlyA = 0;
    let onlyB = 0;
    let shared = 0;
    let divergedAt: string | null = null;
    for (const commit of commits) {
      const inA = historyA.has(commit.hash);
      const inB = historyB.has(commit.hash);
      if (inA && inB) {
        sideByHash.set(commit.hash, "both");
        shared++;
        // In topological order the first shared commit has no shared descendant, so it is a best common ancestor.
        divergedAt ??= commit.hash;
      } else if (inA) {
        sideByHash.set(commit.hash, "a");
        onlyA++;
      } else if (inB) {
        sideByHash.set(commit.hash, "b");
        onlyB++;
      }
    }
    comparison = { a: tips[0].name, b: tips[1].name, onlyA, onlyB, shared, divergedAt, sideByHash };
  }

  return { inHistory, relatedMerges, comparison };
}
