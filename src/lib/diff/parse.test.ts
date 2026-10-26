import { describe, expect, it } from "vitest";
import { buildHunkPatch, parseUnifiedDiff } from "./parse";

const MODIFIED = `diff --git a/src/a.txt b/src/a.txt
index 1111111..2222222 100644
--- a/src/a.txt
+++ b/src/a.txt
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -10,2 +10,3 @@ fn
 ten
+eleven
 twelve
\\ No newline at end of file
`;

describe("parseUnifiedDiff", () => {
  it("parses hunks, line numbers and counts", () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file.kind).toBe("modified");
    expect(file.newPath).toBe("src/a.txt");
    expect(file.hunks).toHaveLength(2);
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(1);
    const del = file.hunks[0].lines[1];
    expect(del).toMatchObject({ type: "del", text: "two", oldNumber: 2, newNumber: null });
    expect(file.hunks[1].lines.at(-1)?.type).toBe("meta");
  });

  it("detects added, deleted, renamed and binary files", () => {
    const text = [
      "diff --git a/n.txt b/n.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/n.txt",
      "@@ -0,0 +1 @@",
      "+hi",
      "diff --git a/d.txt b/d.txt",
      "deleted file mode 100644",
      "--- a/d.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "diff --git a/old.txt b/new.txt",
      "similarity index 100%",
      "rename from old.txt",
      "rename to new.txt",
      "diff --git a/i.png b/i.png",
      "Binary files a/i.png and b/i.png differ",
    ].join("\n");
    const kinds = parseUnifiedDiff(text).map((file) => file.kind);
    expect(kinds).toEqual(["added", "deleted", "renamed", "binary"]);
  });

  it("builds a single-hunk patch that keeps the file header", () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    const patch = buildHunkPatch(file, 1)!;
    expect(patch.startsWith("diff --git a/src/a.txt")).toBe(true);
    expect(patch).toContain("@@ -10,2 +10,3 @@ fn");
    expect(patch).not.toContain("@@ -1,3");
    expect(patch.endsWith("\n")).toBe(true);
  });

  it("returns null for binary files and unknown hunks", () => {
    const [binary] = parseUnifiedDiff("diff --git a/i b/i\nBinary files a/i and b/i differ\n");
    expect(buildHunkPatch(binary, 0)).toBeNull();
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(buildHunkPatch(file, 9)).toBeNull();
  });
});
