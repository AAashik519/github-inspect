// Parser for `git diff` unified output. Pure so it runs on the server (hunk staging) and in the UI.

export type DiffLineType = "context" | "add" | "del" | "meta";

export interface DiffLine {
  type: DiffLineType;
  /** Line content without the leading +/-/space marker. */
  text: string;
  /** Original line including the marker, used to rebuild patches. */
  raw: string;
  oldNumber: number | null;
  newNumber: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  kind: "modified" | "added" | "deleted" | "renamed" | "copied" | "mode-change" | "binary";
  isBinary: boolean;
  additions: number;
  deletions: number;
  /** Lines before the first hunk (diff --git, index, ---, +++ ...). */
  headerLines: string[];
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      file = {
        oldPath: null,
        newPath: null,
        kind: "modified",
        isBinary: false,
        additions: 0,
        deletions: 0,
        headerLines: [line],
        hunks: [],
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      hunk = { header: line, oldStart: Number(hunkMatch[1]), newStart: Number(hunkMatch[2]), lines: [] };
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      file.hunks.push(hunk);
      continue;
    }

    if (!hunk) {
      file.headerLines.push(line);
      readHeaderLine(file, line);
      continue;
    }

    const marker = line[0];
    if (marker === "+") {
      hunk.lines.push({ type: "add", text: line.slice(1), raw: line, oldNumber: null, newNumber: newNo++ });
      file.additions++;
    } else if (marker === "-") {
      hunk.lines.push({ type: "del", text: line.slice(1), raw: line, oldNumber: oldNo++, newNumber: null });
      file.deletions++;
    } else if (marker === "\\") {
      hunk.lines.push({ type: "meta", text: line, raw: line, oldNumber: null, newNumber: null });
    } else {
      hunk.lines.push({ type: "context", text: line.slice(1), raw: line, oldNumber: oldNo++, newNumber: newNo++ });
    }
  }
  return files;
}

function readHeaderLine(file: DiffFile, line: string) {
  if (line.startsWith("new file mode")) file.kind = "added";
  else if (line.startsWith("deleted file mode")) file.kind = "deleted";
  else if (line.startsWith("rename from ")) {
    file.kind = "renamed";
    file.oldPath = line.slice("rename from ".length);
  } else if (line.startsWith("rename to ")) file.newPath = line.slice("rename to ".length);
  else if (line.startsWith("copy from ")) {
    file.kind = "copied";
    file.oldPath = line.slice("copy from ".length);
  } else if (line.startsWith("copy to ")) file.newPath = line.slice("copy to ".length);
  else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
    file.isBinary = true;
    file.kind = "binary";
  } else if (line.startsWith("--- ") && line !== "--- /dev/null") file.oldPath ??= stripPrefix(line.slice(4));
  else if (line.startsWith("+++ ") && line !== "+++ /dev/null") file.newPath ??= stripPrefix(line.slice(4));
  else if (line.startsWith("old mode") && file.kind === "modified" && file.hunks.length === 0) file.kind = "mode-change";
}

function stripPrefix(path: string): string {
  return path.replace(/^[ab]\//, "");
}

/** Builds a patch containing a single hunk, suitable for `git apply`. */
export function buildHunkPatch(file: DiffFile, hunkIndex: number): string | null {
  const hunk = file.hunks[hunkIndex];
  if (!hunk || file.isBinary) return null;
  const body = [...file.headerLines, hunk.header, ...hunk.lines.map((line) => line.raw)];
  return `${body.join("\n")}\n`;
}
