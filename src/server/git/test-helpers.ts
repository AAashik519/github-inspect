// Helpers for integration tests. Every repository lives in a fresh temp directory and the user's own
// Git configuration is ignored, so tests can never touch real repositories.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RepoContext } from "./context";

Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Committer",
  GIT_COMMITTER_EMAIL: "committer@example.com",
});

const created: string[] = [];

export function makeTempDir(prefix = "git-history-test-"): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export interface TempRepo {
  ctx: RepoContext;
  dir: string;
  git: (...args: string[]) => string;
  write: (file: string, content: string) => void;
  read: (file: string) => string;
  /** Writes the files, stages everything and commits. Returns the new commit hash. */
  commit: (message: string, files?: Record<string, string>) => string;
}

export function createRepo(options: { initialCommit?: boolean } = {}): TempRepo {
  const dir = makeTempDir();
  sh(dir, "init", "-q", "-b", "main");
  const repo: TempRepo = {
    ctx: { id: "test-repo", root: dir },
    dir,
    git: (...args) => sh(dir, ...args),
    write: (file, content) => {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    },
    read: (file) => fs.readFileSync(path.join(dir, file), "utf8"),
    commit: (message, files = {}) => {
      for (const [file, content] of Object.entries(files)) repo.write(file, content);
      sh(dir, "add", "--all");
      sh(dir, "commit", "-q", "-m", message);
      return sh(dir, "rev-parse", "HEAD");
    },
  };
  if (options.initialCommit !== false) repo.commit("initial commit", { "README.md": "# project\n", "app.txt": "line 1\nline 2\nline 3\n" });
  return repo;
}

/** Creates a bare remote and a clone of it, both in temp directories. */
export function createRepoWithRemote(): { local: TempRepo; remoteDir: string } {
  const remoteDir = makeTempDir("git-history-remote-");
  sh(remoteDir, "init", "-q", "--bare", "-b", "main");
  const local = createRepo();
  local.git("remote", "add", "origin", remoteDir);
  local.git("push", "-q", "-u", "origin", "main");
  return { local, remoteDir };
}

/** A second working clone, used to simulate another developer pushing to the remote. */
export function cloneRemote(remoteDir: string): TempRepo {
  const dir = makeTempDir("git-history-clone-");
  sh(dir, "clone", "-q", remoteDir, ".");
  const repo: TempRepo = {
    ctx: { id: "clone", root: dir },
    dir,
    git: (...args) => sh(dir, ...args),
    write: (file, content) => fs.writeFileSync(path.join(dir, file), content),
    read: (file) => fs.readFileSync(path.join(dir, file), "utf8"),
    commit: (message, files = {}) => {
      for (const [file, content] of Object.entries(files)) repo.write(file, content);
      sh(dir, "add", "--all");
      sh(dir, "commit", "-q", "-m", message);
      return sh(dir, "rev-parse", "HEAD");
    },
  };
  return repo;
}
