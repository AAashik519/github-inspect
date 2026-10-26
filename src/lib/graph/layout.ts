// Lane assignment for the commit graph. Input must be in topological order
// (children before parents), which is what `git log --topo-order` produces.

export const GRAPH_COLOR_COUNT = 10;

export interface LayoutCommit {
  hash: string;
  parents: string[];
}

/**
 * pass: a lane running straight through the row.
 * in:   a line arriving from above (a child) into this row's commit.
 * out:  a line leaving this row's commit toward a parent below.
 */
export interface GraphSegment {
  kind: "pass" | "in" | "out";
  /** Lane at the top edge (pass/in) or the commit lane (out). */
  from: number;
  /** Lane at the bottom edge (pass/out) or the commit lane (in). */
  to: number;
  color: number;
}

export interface GraphRow {
  hash: string;
  lane: number;
  color: number;
  segments: GraphSegment[];
  isMerge: boolean;
  /** Commit with several children in the loaded history: a divergence point. */
  isFork: boolean;
  /** Commit without loaded children: the end of a line of history. */
  isTip: boolean;
  parents: string[];
}

export interface GraphLayout {
  rows: GraphRow[];
  laneCount: number;
  indexByHash: Map<string, number>;
}

interface Lane {
  hash: string;
  color: number;
}

function firstFreeLane(lanes: (Lane | null)[], from = 0): number {
  for (let index = from; index < lanes.length; index++) if (!lanes[index]) return index;
  return Math.max(lanes.length, from);
}

export function layoutGraph(commits: LayoutCommit[]): GraphLayout {
  const childCount = new Map<string, number>();
  for (const commit of commits) {
    for (const parent of commit.parents) childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
  }

  const rows: GraphRow[] = [];
  const indexByHash = new Map<string, number>();
  let lanes: (Lane | null)[] = [];
  let nextColor = 0;
  let laneCount = 1;

  for (const commit of commits) {
    const before = lanes;
    const incoming: number[] = [];
    before.forEach((lane, index) => {
      if (lane?.hash === commit.hash) incoming.push(index);
    });

    let lane: number;
    let color: number;
    if (incoming.length > 0) {
      lane = incoming[0];
      color = before[lane]!.color;
    } else {
      lane = firstFreeLane(before);
      color = nextColor++ % GRAPH_COLOR_COUNT;
    }

    const segments: GraphSegment[] = [];
    before.forEach((entry, index) => {
      if (!entry) return;
      if (entry.hash === commit.hash) segments.push({ kind: "in", from: index, to: lane, color: entry.color });
      else segments.push({ kind: "pass", from: index, to: index, color: entry.color });
    });

    const after = before.slice();
    for (const index of incoming) after[index] = null;

    commit.parents.forEach((parent, parentIndex) => {
      const existing = after.findIndex((entry) => entry?.hash === parent);
      if (existing >= 0) {
        segments.push({ kind: "out", from: lane, to: existing, color: parentIndex === 0 ? color : after[existing]!.color });
        return;
      }
      if (parentIndex === 0) {
        after[lane] = { hash: parent, color };
        segments.push({ kind: "out", from: lane, to: lane, color });
        return;
      }
      const slot = firstFreeLane(after, lane + 1);
      const parentColor = nextColor++ % GRAPH_COLOR_COUNT;
      after[slot] = { hash: parent, color: parentColor };
      segments.push({ kind: "out", from: lane, to: slot, color: parentColor });
    });

    while (after.length > 0 && after[after.length - 1] === null) after.pop();
    lanes = after;
    laneCount = Math.max(laneCount, before.length, after.length, lane + 1);

    indexByHash.set(commit.hash, rows.length);
    rows.push({
      hash: commit.hash,
      lane,
      color,
      segments,
      isMerge: commit.parents.length > 1,
      isFork: (childCount.get(commit.hash) ?? 0) > 1,
      isTip: !childCount.has(commit.hash),
      parents: commit.parents,
    });
  }

  return { rows, laneCount, indexByHash };
}

/** Every loaded commit reachable from `startHash` (inclusive) following parent links. */
export function reachableFrom(startHash: string, parentsByHash: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [startHash];
  while (stack.length > 0) {
    const hash = stack.pop()!;
    if (seen.has(hash)) continue;
    seen.add(hash);
    for (const parent of parentsByHash.get(hash) ?? []) stack.push(parent);
  }
  return seen;
}
