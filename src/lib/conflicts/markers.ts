// Parses Git conflict markers so the UI can offer current / incoming / both choices per block.

export type ConflictChoice = "ours" | "theirs" | "both" | "base";

export interface TextSegment {
  kind: "text";
  text: string;
}

export interface ConflictSegment {
  kind: "conflict";
  id: number;
  ours: string;
  /** Present only with `merge.conflictStyle=diff3|zdiff3`. */
  base: string | null;
  theirs: string;
  oursLabel: string;
  theirsLabel: string;
}

export type Segment = TextSegment | ConflictSegment;

export interface ParsedConflicts {
  segments: Segment[];
  conflictCount: number;
  /** True when a `<<<<<<<` block is never closed — the file must not be marked resolved. */
  isMalformed: boolean;
}

const START = /^<{7}(?: (.*))?$/;
const BASE = /^\|{7}(?: .*)?$/;
const MIDDLE = /^={7}$/;
const END = /^>{7}(?: (.*))?$/;

function stripEol(line: string) {
  return line.replace(/\r?\n$/, "");
}

export function parseConflictMarkers(content: string): ParsedConflicts {
  const lines = content.split(/(?<=\n)/);
  const segments: Segment[] = [];
  let text = "";
  let conflictCount = 0;
  let isMalformed = false;

  for (let index = 0; index < lines.length; index++) {
    const startMatch = START.exec(stripEol(lines[index]));
    if (!startMatch) {
      text += lines[index];
      continue;
    }

    let ours = "";
    let base: string | null = null;
    let theirs = "";
    let theirsLabel = "";
    let section: "ours" | "base" | "theirs" = "ours";
    let isClosed = false;
    let cursor = index + 1;
    for (; cursor < lines.length; cursor++) {
      const bare = stripEol(lines[cursor]);
      const endMatch = END.exec(bare);
      if (section !== "ours" && endMatch) {
        theirsLabel = endMatch[1] ?? "";
        isClosed = true;
        break;
      }
      if (section === "ours" && BASE.test(bare)) {
        section = "base";
        base = "";
      } else if (section !== "theirs" && MIDDLE.test(bare)) {
        section = "theirs";
      } else if (section === "ours") ours += lines[cursor];
      else if (section === "base") base += lines[cursor];
      else theirs += lines[cursor];
    }

    if (!isClosed) {
      isMalformed = true;
      text += lines[index];
      continue;
    }
    if (text) segments.push({ kind: "text", text });
    text = "";
    segments.push({
      kind: "conflict",
      id: conflictCount++,
      ours,
      base,
      theirs,
      oursLabel: startMatch[1] ?? "",
      theirsLabel,
    });
    index = cursor;
  }
  if (text) segments.push({ kind: "text", text });
  return { segments, conflictCount, isMalformed };
}

export function hasConflictMarkers(content: string): boolean {
  const { conflictCount, isMalformed } = parseConflictMarkers(content);
  return conflictCount > 0 || isMalformed;
}

/** Joins segments using the chosen side for every conflict; unresolved blocks keep their markers. */
export function composeResolution(segments: Segment[], choices: Record<number, ConflictChoice | undefined>): string {
  return segments
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      const choice = choices[segment.id];
      if (choice === "ours") return segment.ours;
      if (choice === "theirs") return segment.theirs;
      if (choice === "both") return segment.ours + segment.theirs;
      if (choice === "base") return segment.base ?? "";
      const baseBlock = segment.base === null ? "" : `||||||| base\n${segment.base}`;
      return `<<<<<<< ${segment.oursLabel}\n${segment.ours}${baseBlock}=======\n${segment.theirs}>>>>>>> ${segment.theirsLabel}\n`;
    })
    .join("");
}
