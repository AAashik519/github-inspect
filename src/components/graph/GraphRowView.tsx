import { memo } from "react";
import type { ComparisonSide } from "@/lib/graph/focus";
import type { GraphRow } from "@/lib/graph/layout";
import type { CommitSummary, RefInfo } from "@/lib/types";
import { formatShortDate, plural, shortHash } from "@/lib/format";
import { BASE_LANE_WIDTH, BASE_ROW_HEIGHT, describeRelationships, laneX, NODE_RADIUS, WORKTREE_HASH } from "./graph-model";
import styles from "./graph.module.css";

const MAX_VISIBLE_REFS = 3;
const SIDE_CLASS: Record<ComparisonSide, string> = { a: styles.sideA, b: styles.sideB, both: styles.sideBoth };
const SIDE_LABEL: Record<ComparisonSide, string> = { a: "Only in branch A", b: "Only in branch B", both: "In both branches" };

interface GraphRowViewProps {
  row: GraphRow;
  /** Null for the synthetic "uncommitted changes" row. */
  commit: CommitSummary | null;
  refs: RefInfo[];
  top: number;
  zoom: number;
  laneCount: number;
  gridTemplate: string;
  showText: boolean;
  isSelected: boolean;
  isParentOfSelected: boolean;
  isCompareBase: boolean;
  isDimmed: boolean;
  /** Set while two branches are compared: which branch's history the commit belongs to. */
  comparisonSide: ComparisonSide | null;
  /** A merge outside the highlighted history that brought a highlighted branch's work in. */
  isRelatedMerge: boolean;
  isHead: boolean;
  uncommittedCount: number;
  onSelect: (hash: string, isCompareClick: boolean) => void;
}

function RefBadges({ refs, isHead, color }: { refs: RefInfo[]; isHead: boolean; color: number }) {
  const visible = refs.slice(0, MAX_VISIBLE_REFS);
  const hidden = refs.slice(MAX_VISIBLE_REFS);
  const palette = `var(--graph-${color % 10})`;
  return (
    <>
      {isHead && <span className={styles.refHead}>HEAD</span>}
      {visible.map((ref) => (
        <span
          key={ref.fullName}
          className={`${styles.refBadge} ${ref.kind === "local" ? styles.refLocal : ref.kind === "remote" ? styles.refRemote : styles.refTag}`}
          style={ref.kind === "local" ? { background: palette } : { color: palette, borderColor: palette }}
          title={`${ref.kind === "local" ? "Local branch" : ref.kind === "remote" ? "Remote-tracking branch" : "Tag"} ${ref.name}`}
        >
          {ref.kind === "tag" ? "🏷 " : ""}
          {ref.name}
        </span>
      ))}
      {hidden.length > 0 && (
        <span className={styles.moreRefs} title={hidden.map((ref) => ref.name).join(", ")}>
          +{hidden.length}
        </span>
      )}
    </>
  );
}

function segmentPath(kind: "pass" | "in" | "out", from: number, to: number): string {
  const height = BASE_ROW_HEIGHT;
  const middle = height / 2;
  const x1 = laneX(from);
  const x2 = laneX(to);
  if (kind === "pass") return `M ${x1} 0 L ${x1} ${height}`;
  if (kind === "in") return x1 === x2 ? `M ${x1} 0 L ${x2} ${middle}` : `M ${x1} 0 C ${x1} ${middle * 0.6}, ${x2} ${middle * 0.4}, ${x2} ${middle}`;
  return x1 === x2 ? `M ${x1} ${middle} L ${x2} ${height}` : `M ${x1} ${middle} C ${x1} ${middle + middle * 0.6}, ${x2} ${middle + middle * 0.4}, ${x2} ${height}`;
}

/** One graph row: lane lines + commit node (SVG) and the commit's text columns. Rendered only while visible. */
function GraphRowViewComponent(props: GraphRowViewProps) {
  const { row, commit, refs, top, zoom, laneCount, gridTemplate, showText, isSelected, isParentOfSelected, isCompareBase, isDimmed, comparisonSide, isRelatedMerge, isHead, uncommittedCount, onSelect } = props;
  const isWorktree = row.hash === WORKTREE_HASH;
  const rowHeight = BASE_ROW_HEIGHT * zoom;
  const baseWidth = laneCount * BASE_LANE_WIDTH + 2 * 10;
  const color = `var(--graph-${row.color % 10})`;
  const tooltip = [describeRelationships(row, commit, uncommittedCount), comparisonSide && `${SIDE_LABEL[comparisonSide]}.`, isRelatedMerge && "Merged a highlighted branch's commits into another line of history."].filter(Boolean).join("\n");

  const className = [styles.row, isSelected && styles.rowSelected, isParentOfSelected && styles.rowParent, isCompareBase && styles.rowCompareBase, isDimmed && styles.rowDimmed, comparisonSide && SIDE_CLASS[comparisonSide]].filter(Boolean).join(" ");

  return (
    <div
      id={`graph-row-${row.hash}`}
      role="option"
      aria-selected={isSelected}
      className={className}
      style={{ top, height: rowHeight, gridTemplateColumns: gridTemplate, fontSize: 13 * Math.max(zoom, 0.8) }}
      title={tooltip}
      onClick={(event) => onSelect(row.hash, event.ctrlKey || event.metaKey || event.shiftKey)}
    >
      <svg width={baseWidth * zoom} height={rowHeight} viewBox={`0 0 ${baseWidth} ${BASE_ROW_HEIGHT}`} aria-hidden>
        {row.segments.map((segment, index) => (
          <path
            key={index}
            d={segmentPath(segment.kind, segment.from, segment.to)}
            fill="none"
            stroke={`var(--graph-${segment.color % 10})`}
            strokeWidth={isSelected && segment.kind === "out" ? 4 : 2.2}
            strokeDasharray={isWorktree && segment.kind !== "pass" ? "3 3" : undefined}
            strokeLinecap="round"
          />
        ))}
        <g transform={`translate(${laneX(row.lane)} ${BASE_ROW_HEIGHT / 2})`}>
          <title>{tooltip}</title>
          {isHead && <circle r={NODE_RADIUS + 5.5} fill="none" stroke="var(--text)" strokeWidth="2" />}
          {isRelatedMerge && <circle r={NODE_RADIUS + 7} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="3 2" />}
          {row.isFork && <circle r={NODE_RADIUS + 3.5} fill="none" stroke={color} strokeWidth="1.3" strokeDasharray="2 2" />}
          {isWorktree ? (
            <circle r={NODE_RADIUS} fill="var(--bg)" stroke={color} strokeWidth="2" strokeDasharray="3 2" />
          ) : row.isMerge ? (
            <>
              <circle r={NODE_RADIUS + 1.8} fill="var(--bg)" stroke={color} strokeWidth="2.6" />
              <circle r="2.4" fill={color} />
            </>
          ) : (
            <circle r={NODE_RADIUS} fill={color} stroke="var(--bg)" strokeWidth="1.5" />
          )}
        </g>
      </svg>
      {showText && (
        <>
          <div className={styles.message}>
            {commit ? <RefBadges refs={refs} isHead={isHead} color={row.color} /> : null}
            <span className={styles.subject} style={isWorktree ? { fontStyle: "italic", color: "var(--text-muted)" } : undefined}>
              {commit ? commit.subject : `Uncommitted changes (${plural(uncommittedCount, "file")})`}
            </span>
          </div>
          <div className={styles.cell}>{commit?.authorName ?? ""}</div>
          <div className={styles.cell}>{commit ? formatShortDate(commit.authorDate) : ""}</div>
          <div className={styles.hash}>{commit ? shortHash(commit.hash) : ""}</div>
        </>
      )}
    </div>
  );
}

export const GraphRowView = memo(GraphRowViewComponent);
