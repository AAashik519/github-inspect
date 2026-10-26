import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFileDiff } from "./diff";
import { applyHunk, createCommit, discardPaths, stageAll, stagePaths, unstageAll, unstagePaths } from "./staging";
import { readStatus } from "./status";
import { cleanupTempDirs, createRepo } from "./test-helpers";

afterEach(cleanupTempDirs);

const statusOf = async (repo: ReturnType<typeof createRepo>, file: string) => (await readStatus(repo.ctx)).files.find((entry) => entry.path === file);

describe("staging", () => {
  it("stages and unstages individual files", async () => {
    const repo = createRepo();
    repo.write("app.txt", "changed\n");
    repo.write("new.txt", "new\n");

    expect(await statusOf(repo, "app.txt")).toMatchObject({ index: " ", worktree: "M" });
    expect(await statusOf(repo, "new.txt")).toMatchObject({ isUntracked: true });

    await stagePaths(repo.ctx, { paths: ["app.txt", "new.txt"] });
    expect(await statusOf(repo, "app.txt")).toMatchObject({ index: "M", worktree: " " });
    expect(await statusOf(repo, "new.txt")).toMatchObject({ index: "A" });

    await unstagePaths(repo.ctx, { paths: ["app.txt", "new.txt"] });
    expect(await statusOf(repo, "app.txt")).toMatchObject({ index: " ", worktree: "M" });
    expect(await statusOf(repo, "new.txt")).toMatchObject({ isUntracked: true });
  });

  it("stages and unstages everything", async () => {
    const repo = createRepo();
    repo.write("app.txt", "changed\n");
    repo.write("new.txt", "new\n");
    await stageAll(repo.ctx);
    expect((await readStatus(repo.ctx)).files.every((file) => file.index !== " ")).toBe(true);
    await unstageAll(repo.ctx);
    expect((await readStatus(repo.ctx)).files.every((file) => file.index === " ")).toBe(true);
  });

  it("can unstage in a repository without commits", async () => {
    const repo = createRepo({ initialCommit: false });
    repo.write("first.txt", "1");
    await stagePaths(repo.ctx, { paths: ["first.txt"] });
    await unstagePaths(repo.ctx, { paths: ["first.txt"] });
    expect(await statusOf(repo, "first.txt")).toMatchObject({ isUntracked: true });
  });

  it("treats file names literally (no globbing or pathspec magic)", async () => {
    const repo = createRepo();
    repo.write("a.txt", "a");
    repo.write("star*.txt", "star");
    await stagePaths(repo.ctx, { paths: ["star*.txt"] });
    expect(await statusOf(repo, "star*.txt")).toMatchObject({ index: "A" });
    expect(await statusOf(repo, "a.txt")).toMatchObject({ isUntracked: true });
  });

  it("reports renames and deleted files", async () => {
    const repo = createRepo();
    repo.git("mv", "app.txt", "renamed.txt");
    fs.rmSync(path.join(repo.dir, "README.md"));
    const files = (await readStatus(repo.ctx)).files;
    expect(files.find((file) => file.path === "renamed.txt")).toMatchObject({ index: "R", originalPath: "app.txt" });
    expect(files.find((file) => file.path === "README.md")).toMatchObject({ worktree: "D" });
  });

  it("rejects paths that escape the repository or look like options", async () => {
    const repo = createRepo();
    for (const bad of ["../outside", "/etc/passwd", "-A", "a/../../b"]) {
      await expect(stagePaths(repo.ctx, { paths: [bad] })).rejects.toMatchObject({ kind: "validation" });
    }
    await expect(stagePaths(repo.ctx, { paths: [] })).rejects.toMatchObject({ kind: "validation" });
  });
});

describe("discarding changes", () => {
  it("requires explicit confirmation and leaves files untouched otherwise", async () => {
    const repo = createRepo();
    repo.write("app.txt", "precious edit\n");
    await expect(discardPaths(repo.ctx, { paths: ["app.txt"] })).rejects.toMatchObject({ kind: "validation" });
    expect(repo.read("app.txt")).toBe("precious edit\n");
  });

  it("discards tracked edits and deletes untracked files only when confirmed", async () => {
    const repo = createRepo();
    repo.write("app.txt", "edit\n");
    repo.write("junk.txt", "junk\n");
    await discardPaths(repo.ctx, { paths: ["app.txt", "junk.txt"], confirmed: true });
    expect(repo.read("app.txt")).toBe("line 1\nline 2\nline 3\n");
    expect(fs.existsSync(path.join(repo.dir, "junk.txt"))).toBe(false);
  });

  it("keeps staged changes when discarding only the unstaged part", async () => {
    const repo = createRepo();
    repo.write("app.txt", "staged\n");
    repo.git("add", "app.txt");
    repo.write("app.txt", "staged\nunstaged\n");
    await discardPaths(repo.ctx, { paths: ["app.txt"], confirmed: true });
    expect(repo.read("app.txt")).toBe("staged\n");
    expect(await statusOf(repo, "app.txt")).toMatchObject({ index: "M", worktree: " " });
  });

  it("refuses to discard files that have no changes", async () => {
    const repo = createRepo();
    await expect(discardPaths(repo.ctx, { paths: ["app.txt"], confirmed: true })).rejects.toMatchObject({ kind: "precondition" });
  });
});

describe("diffs", () => {
  it("shows staged and unstaged diffs separately", async () => {
    const repo = createRepo();
    repo.write("app.txt", "line 1\nSTAGED\nline 3\n");
    repo.git("add", "app.txt");
    repo.write("app.txt", "line 1\nSTAGED\nline 3\nextra\n");

    const staged = (await getFileDiff(repo.ctx, { kind: "staged", path: "app.txt" })).files[0];
    const unstaged = (await getFileDiff(repo.ctx, { kind: "unstaged", path: "app.txt" })).files[0];
    expect([staged.additions, staged.deletions]).toEqual([1, 1]);
    expect([unstaged.additions, unstaged.deletions]).toEqual([1, 0]);
  });

  it("renders untracked, binary and deleted files", async () => {
    const repo = createRepo();
    repo.write("fresh.txt", "hello\nworld\n");
    fs.writeFileSync(path.join(repo.dir, "image.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    fs.rmSync(path.join(repo.dir, "README.md"));

    const untracked = (await getFileDiff(repo.ctx, { kind: "untracked", path: "fresh.txt" })).files[0];
    expect(untracked).toMatchObject({ kind: "added", additions: 2 });
    const binary = (await getFileDiff(repo.ctx, { kind: "untracked", path: "image.bin" })).files[0];
    expect(binary.isBinary).toBe(true);
    const deleted = (await getFileDiff(repo.ctx, { kind: "unstaged", path: "README.md" })).files[0];
    expect(deleted).toMatchObject({ kind: "deleted", deletions: 1 });
  });

  it("truncates huge diffs instead of loading them completely", async () => {
    const repo = createRepo();
    repo.write("big.txt", Array.from({ length: 200_000 }, (_, index) => `line number ${index}`).join("\n"));
    const result = await getFileDiff(repo.ctx, { kind: "untracked", path: "big.txt" });
    expect(result.truncated).toBe(true);
  });
});

describe("hunk staging", () => {
  const original = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";

  function twoHunkRepo() {
    const repo = createRepo();
    repo.commit("long file", { "long.txt": original });
    repo.write("long.txt", original.replace("line 2\n", "LINE TWO\n").replace("line 29\n", "LINE 29\n"));
    return repo;
  }

  it("stages exactly one hunk", async () => {
    const repo = twoHunkRepo();
    const { files } = await getFileDiff(repo.ctx, { kind: "unstaged", path: "long.txt" });
    expect(files[0].hunks).toHaveLength(2);

    await applyHunk(repo.ctx, { action: "stage", path: "long.txt", hunkIndex: 1, hunkHeader: files[0].hunks[1].header });
    const staged = (await getFileDiff(repo.ctx, { kind: "staged", path: "long.txt" })).files[0];
    expect(staged.hunks).toHaveLength(1);
    expect(staged.hunks[0].lines.some((line) => line.text === "LINE 29")).toBe(true);
    const unstaged = (await getFileDiff(repo.ctx, { kind: "unstaged", path: "long.txt" })).files[0];
    expect(unstaged.hunks).toHaveLength(1);
    expect(unstaged.hunks[0].lines.some((line) => line.text === "LINE TWO")).toBe(true);
  });

  it("unstages a staged hunk", async () => {
    const repo = twoHunkRepo();
    repo.git("add", "long.txt");
    const { files } = await getFileDiff(repo.ctx, { kind: "staged", path: "long.txt" });
    await applyHunk(repo.ctx, { action: "unstage", path: "long.txt", hunkIndex: 0, hunkHeader: files[0].hunks[0].header });
    expect((await getFileDiff(repo.ctx, { kind: "staged", path: "long.txt" })).files[0].hunks).toHaveLength(1);
  });

  it("discards one hunk only after confirmation", async () => {
    const repo = twoHunkRepo();
    const { files } = await getFileDiff(repo.ctx, { kind: "unstaged", path: "long.txt" });
    const params = { action: "discard", path: "long.txt", hunkIndex: 0, hunkHeader: files[0].hunks[0].header };
    await expect(applyHunk(repo.ctx, params)).rejects.toMatchObject({ kind: "validation" });
    await applyHunk(repo.ctx, { ...params, confirmed: true });
    expect(repo.read("long.txt")).toContain("line 2\n");
    expect(repo.read("long.txt")).toContain("LINE 29");
  });

  it("rejects a stale hunk header", async () => {
    const repo = twoHunkRepo();
    await expect(applyHunk(repo.ctx, { action: "stage", path: "long.txt", hunkIndex: 0, hunkHeader: "@@ -1,1 +1,1 @@" })).rejects.toMatchObject({ kind: "precondition" });
  });
});

describe("commit", () => {
  it("commits staged changes and verifies the new HEAD", async () => {
    const repo = createRepo();
    const before = repo.git("rev-parse", "HEAD");
    repo.write("app.txt", "x\n");
    await stageAll(repo.ctx);
    const result = await createCommit(repo.ctx, { message: "  Update app\n\nBody text  " });
    expect(result.headAfter).not.toBe(before);
    expect(repo.git("log", "-1", "--format=%B")).toBe("Update app\n\nBody text");
  });

  it("refuses an empty message or nothing staged", async () => {
    const repo = createRepo();
    repo.write("app.txt", "x\n");
    await expect(createCommit(repo.ctx, { message: "   " })).rejects.toMatchObject({ kind: "validation" });
    await expect(createCommit(repo.ctx, { message: "msg" })).rejects.toMatchObject({ kind: "precondition" });
  });

  it("amends the last commit, rewriting its hash", async () => {
    const repo = createRepo();
    const before = repo.git("rev-parse", "HEAD");
    const count = repo.git("rev-list", "--count", "HEAD");
    const result = await createCommit(repo.ctx, { message: "better message", amend: true });
    expect(result.headAfter).not.toBe(before);
    expect(repo.git("rev-list", "--count", "HEAD")).toBe(count);
    expect(repo.git("log", "-1", "--format=%s")).toBe("better message");
  });

  it("creates the first commit of an empty repository and cannot amend before it", async () => {
    const repo = createRepo({ initialCommit: false });
    repo.write("a.txt", "a");
    await stageAll(repo.ctx);
    await expect(createCommit(repo.ctx, { message: "x", amend: true })).rejects.toMatchObject({ kind: "precondition" });
    await createCommit(repo.ctx, { message: "first" });
    expect(repo.git("log", "-1", "--format=%s")).toBe("first");
  });

  it("explains a missing git identity", async () => {
    const repo = createRepo();
    repo.write("a.txt", "a");
    await stageAll(repo.ctx);
    const saved = { ...process.env };
    for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) delete process.env[key];
    repo.git("config", "user.useConfigOnly", "true");
    try {
      await expect(createCommit(repo.ctx, { message: "x" })).rejects.toMatchObject({ kind: "identity-missing" });
    } finally {
      Object.assign(process.env, saved);
    }
  });
});
