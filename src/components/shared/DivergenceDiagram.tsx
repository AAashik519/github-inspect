interface DiagramLine {
  label: string;
  /** Commits on this line since the shared ancestor. */
  count: number;
  colorIndex: number;
}

interface DivergenceDiagramProps {
  /** Common ancestor; null when the histories are unrelated. */
  base: string | null;
  lines: DiagramLine[];
  /** When set, the lines converge into a merge commit with this label. */
  mergeLabel?: string;
}

const SIMPLE_ROW_HEIGHT = 44;
const MERGE_ROW_HEIGHT = 66;
const BASE_X = 56;
const LINE_START_X = 140;
const LINE_END_X = 380;
const MAX_DOTS = 6;

/** A schematic of how two or more lines of history leave a common ancestor, and optionally join in a merge. */
export function DivergenceDiagram({ base, lines, mergeLabel }: DivergenceDiagramProps) {
  const rowHeight = mergeLabel ? MERGE_ROW_HEIGHT : SIMPLE_ROW_HEIGHT;
  const height = Math.max(lines.length, 1) * rowHeight + 24;
  const centerY = height / 2;
  const mergeX = LINE_END_X + 70;
  const width = mergeLabel ? mergeX + 150 : LINE_END_X + 270;
  const rowY = (index: number) => 12 + rowHeight * index + rowHeight / 2;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Diagram of diverging and merging history" style={{ maxWidth: width }}>
      {base && <title>Common ancestor {base}</title>}
      {lines.map((line, index) => {
        const color = `var(--graph-${line.colorIndex % 10})`;
        const y = rowY(index);
        const dots = Math.min(line.count, MAX_DOTS);
        return (
          <g key={line.label + index}>
            {base && <path d={`M ${BASE_X} ${centerY} C ${BASE_X + 40} ${centerY}, ${LINE_START_X - 40} ${y}, ${LINE_START_X} ${y}`} stroke={color} strokeWidth="2.5" fill="none" />}
            <line x1={base ? LINE_START_X : 20} y1={y} x2={LINE_END_X} y2={y} stroke={color} strokeWidth="2.5" />
            {mergeLabel && <path d={`M ${LINE_END_X} ${y} C ${LINE_END_X + 35} ${y}, ${mergeX - 35} ${centerY}, ${mergeX} ${centerY}`} stroke={color} strokeWidth="2.5" fill="none" />}
            {Array.from({ length: dots }, (_, dotIndex) => (
              <circle key={dotIndex} cx={LINE_START_X + 24 + dotIndex * ((LINE_END_X - LINE_START_X - 48) / Math.max(dots - 1, 1))} cy={y} r="5" fill={color} stroke="var(--bg-elevated)" strokeWidth="2" />
            ))}
            <text x={mergeLabel ? LINE_START_X : LINE_END_X + 12} y={mergeLabel ? y - 14 : y - 2} fill="var(--text)" fontSize="12" fontWeight="600">
              {line.label}
            </text>
            <text x={mergeLabel ? LINE_START_X : LINE_END_X + 12} y={mergeLabel ? y + 24 : y + 14} fill="var(--text-muted)" fontSize="11">
              {line.count === 0 ? "no unique commits" : `${line.count} commit${line.count === 1 ? "" : "s"}${mergeLabel ? " (not on the other parent)" : " since the common ancestor"}`}
            </text>
          </g>
        );
      })}
      {base && (
        <g>
          <circle cx={BASE_X} cy={centerY} r="7" fill="var(--bg-elevated)" stroke="var(--text-muted)" strokeWidth="2.5" />
          <text x={BASE_X} y={centerY + 26} textAnchor="middle" fill="var(--text-muted)" fontSize="11">
            common ancestor
          </text>
        </g>
      )}
      {mergeLabel && (
        <g>
          <circle cx={mergeX} cy={centerY} r="9" fill="var(--bg-elevated)" stroke="var(--merge)" strokeWidth="3" />
          <circle cx={mergeX} cy={centerY} r="3.5" fill="var(--merge)" />
          <text x={mergeX + 16} y={centerY + 4} fill="var(--text)" fontSize="12" fontWeight="600">
            {mergeLabel}
          </text>
        </g>
      )}
    </svg>
  );
}
