import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRepositoryContext, inspectRepositoryPath, listRepositories, addRepository, removeRepository } from "./repositories";
import { getRepositoryInfo } from "./commits";
import { readStatus } from "./status";
import { cleanupTempDirs, createRepo, makeTempDir, sh } from "./test-helpers";

beforeEach(() => {
  process.env.GIT_HISTORY_DATA_DIR = makeTempDir("git-history-data-");
});
afterEach(cleanupTempDirs);

async function expectKind(promise: Promise<unknown>, kind: string) {
  await expect(promise).rejects.toMatchObject({ kind });
}

describe("repository validation", () => {
  it("accepts a git repository and resolves its root from a subfolder", async () => {
    const repo = createRepo();
    fs.mkdirSync(path.join(repo.dir, "src/deep"), { recursive: true });
    const location = await inspectRepositoryPath(path.join(repo.dir, "src/deep"));
    expect(location.root).toBe(repo.dir);
    expect(location.isLinkedWorktree).toBe(false);
  });

  it("rejects relative paths, missing folders, files and non-repositories", async () => {
    const plainFolder = makeTempDir();
    const file = path.join(plainFolder, "file.txt");
    fs.writeFileSync(file, "x");
    await expectKind(inspectRepositoryPath("relative/path"), "invalid-path");
    await expectKind(inspectRepositoryPath(path.join(plainFolder, "missing")), "invalid-path");
    await expectKind(inspectRepositoryPath(file), "invalid-path");
    await expectKind(inspectRepositoryPath(plainFolder), "not-a-repository");
    await expectKind(inspectRepositoryPath("\u0000"), "invalid-path");
  });

  it("rejects bare repositories with an explanation", async () => {
    const bare = makeTempDir();
    sh(bare, "init", "-q", "--bare");
    await expectKind(inspectRepositoryPath(bare), "precondition");
  });

  it("detects linked worktrees", async () => {
    const repo = createRepo();
    const worktree = path.join(makeTempDir(), "wt");
    repo.git("worktree", "add", "-q", "-b", "wt-branch", worktree);
    const location = await inspectRepositoryPath(worktree);
    expect(location.isLinkedWorktree).toBe(true);
  });
});

describe("repository registry", () => {
  it("adds, lists, deduplicates and removes without deleting files", async () => {
    const repo = createRepo();
    const first = await addRepository(repo.dir);
    const second = await addRepository(repo.dir);
    expect(second.id).toBe(first.id);
    expect(await listRepositories()).toHaveLength(1);

    await removeRepository(first.id);
    expect(await listRepositories()).toHaveLength(0);
    expect(fs.existsSync(path.join(repo.dir, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(repo.dir, "README.md"))).toBe(true);
  });

  it("flags a repository whose folder disappeared and refuses to run commands in it", async () => {
    const repo = createRepo();
    const entry = await addRepository(repo.dir);
    fs.rmSync(repo.dir, { recursive: true });
    expect((await listRepositories())[0].state).toBe("missing");
    await expectKind(getRepositoryContext(entry.id), "repository-missing");
  });

  it("flags a folder that is no longer a repository", async () => {
    const repo = createRepo();
    await addRepository(repo.dir);
    fs.rmSync(path.join(repo.dir, ".git"), { recursive: true });
    expect((await listRepositories())[0].state).toBe("invalid");
  });

  it("rejects unknown repository ids", async () => {
    await expectKind(getRepositoryContext("nope"), "repository-missing");
    await expectKind(getRepositoryContext(42), "validation");
  });
});

describe("repository state", () => {
  it("reports an empty repository (no commits yet)", async () => {
    const repo = createRepo({ initialCommit: false });
    const status = await readStatus(repo.ctx);
    expect(status.head).toMatchObject({ unborn: true, branch: "main", hash: null });
    const info = await getRepositoryInfo(repo.ctx, "empty");
    expect(info).toMatchObject({ hasCommits: false, commitCount: 0, lastCommit: null });
  });

  it("reports a detached HEAD", async () => {
    const repo = createRepo();
    const hash = repo.commit("second", { "a.txt": "a" });
    repo.git("checkout", "-q", "--detach", "HEAD~1");
    const status = await readStatus(repo.ctx);
    expect(status.head.detached).toBe(true);
    expect(status.head.branch).toBeNull();
    expect(status.head.hash).not.toBe(hash);
  });

  it("summarises branches, tags and stashes", async () => {
    const repo = createRepo();
    repo.git("branch", "feature");
    repo.git("tag", "v1");
    expect(await getRepositoryInfo(repo.ctx, "demo")).toMatchObject({ localBranchCount: 2, tagCount: 1, stashCount: 0, remoteCount: 0, commitCount: 1, isShallow: false });

    repo.write("app.txt", "changed\n");
    repo.git("stash", "push", "-m", "first");
    repo.write("app.txt", "changed again\n");
    repo.git("stash", "push", "-m", "second");
    expect((await getRepositoryInfo(repo.ctx, "demo")).stashCount).toBe(2);
  });
});
