import { plural, shortHash } from "@/lib/format";
import type { GraphRow } from "@/lib/graph/layout";
import type { CommitSummary } from "@/lib/types";

// Geometry in "base units"; the SVG is scaled with a viewBox so zoom only changes the rendered size.
export const BASE_ROW_HEIGHT = 30;
export const BASE_LANE_WIDTH = 18;
export const NODE_RADIUS = 5;
export const GRAPH_PADDING = 10;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;
/** Below this zoom level text is unreadable, so only the graph itself is drawn. */
export const MIN_TEXT_ZOOM = 0.55;
export const WORKTREE_HASH = "__working-tree__";

export type CommitTypeFilter = "all" | "merge" | "regular";

export interface GraphFilters {
  author: string;
  since: string;
  until: string;
  type: CommitTypeFilter;
}

export const NO_FILTERS: GraphFilters = { author: "", since: "", until: "", type: "all" };

export const hasActiveFilters = (filters: GraphFilters) => filters.author !== "" || filters.since !== "" || filters.until !== "" || filters.type !== "all";

export function matchesFilters(commit: CommitSummary, filters: GraphFilters): boolean {
  if (filters.author && commit.authorName !== filters.author) return false;
  if (filters.type === "merge" && commit.parents.length < 2) return false;
  if (filters.type === "regular" && commit.parents.length > 1) return false;
  const time = new Date(commit.committerDate).getTime();
  if (filters.since && time < new Date(`${filters.since}T00:00:00`).getTime()) return false;
  if (filters.until && time > new Date(`${filters.until}T23:59:59.999`).getTime()) return false;
  return true;
}

export const laneX = (lane: number) => GRAPH_PADDING + lane * BASE_LANE_WIDTH;

/** Plain-language explanation of a commit's place in the graph (tooltip and selection summary). */
export function describeRelationships(row: GraphRow, commit: CommitSummary | null, uncommittedCount: number): string {
  if (!commit) return `${plural(uncommittedCount, "file")} with uncommitted changes. They are not part of any commit yet.`;
  const lines: string[] = [];
  if (row.parents.length === 0) lines.push("Root commit: it has no parent.");
  else if (row.isMerge) {
    lines.push(`Merge commit: joins ${row.parents.length} lines of history.`);
    lines.push(`First parent ${shortHash(row.parents[0])} is the line that received the merge.`);
    lines.push(`Merged in: ${row.parents.slice(1).map(shortHash).join(", ")}.`);
  } else lines.push(`Parent: ${shortHash(row.parents[0])}.`);
  if (row.isFork) lines.push("Divergence point: several lines of history start from this commit.");
  if (row.isTip) lines.push("Newest commit on its line of history in the loaded graph.");
  return lines.join("\n");
}
