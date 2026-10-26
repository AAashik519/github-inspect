import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RepositoryEntry } from "@/lib/types";
import type { RepoContext } from "./context";
import { GitError } from "./errors";
import { runGit } from "./run";

interface StoredRepository {
  id: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
}

function dataDirectory(): string {
  if (process.env.GIT_HISTORY_DATA_DIR) return process.env.GIT_HISTORY_DATA_DIR;
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "git-history");
}

const storeFile = () => path.join(dataDirectory(), "repositories.json");

// Serialises read-modify-write cycles within this process.
let writeQueue: Promise<unknown> = Promise.resolve();

async function readStore(): Promise<StoredRepository[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(storeFile(), "utf8"));
    if (!Array.isArray(parsed)) throw new Error("repositories.json must contain an array");
    return parsed.filter(
      (entry): entry is StoredRepository => typeof entry?.id === "string" && typeof entry?.path === "string",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new GitError("unknown", `Could not read the repository list (${storeFile()}): ${(error as Error).message}`, { status: 500 });
  }
}

async function writeStore(entries: StoredRepository[]): Promise<void> {
  await fs.mkdir(dataDirectory(), { recursive: true, mode: 0o700 });
  const temporaryFile = `${storeFile()}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(entries, null, 2), { mode: 0o600 });
  await fs.rename(temporaryFile, storeFile());
}

function updateStore<T>(update: (entries: StoredRepository[]) => { entries: StoredRepository[]; result: T }): Promise<T> {
  const run = writeQueue.then(async () => {
    const { entries, result } = update(await readStore());
    await writeStore(entries);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

const repositoryId = (root: string) => createHash("sha1").update(root).digest("hex").slice(0, 12);

export interface RepositoryLocation {
  root: string;
  gitDir: string;
  isLinkedWorktree: boolean;
  superproject: string | null;
}

/** Validates a user-supplied folder and resolves it to the real repository root. */
export async function inspectRepositoryPath(input: unknown): Promise<RepositoryLocation> {
  if (typeof input !== "string" || input.trim() === "" || input.includes("\u0000")) {
    throw new GitError("invalid-path", "Enter the full path of a folder.");
  }
  let candidate = input.trim();
  if (candidate === "~" || candidate.startsWith("~/")) candidate = path.join(os.homedir(), candidate.slice(1));
  if (!path.isAbsolute(candidate)) throw new GitError("invalid-path", "Use an absolute path, for example /home/you/projects/app.");

  let realPath: string;
  try {
    realPath = await fs.realpath(candidate);
    if (!(await fs.stat(realPath)).isDirectory()) throw new GitError("invalid-path", "That path is a file, not a folder.");
  } catch (error) {
    if (error instanceof GitError) throw error;
    throw new GitError("invalid-path", `The folder “${candidate}” does not exist or cannot be read.`);
  }

  const bare = await runGit(["rev-parse", "--is-bare-repository"], { cwd: realPath });
  if (bare.stdout.trim() === "true") {
    throw new GitError("precondition", "Bare repositories are not supported: this app needs a working tree.", {
      suggestions: ["Select a normal clone, or add a worktree of this repository."],
    });
  }
  const { stdout } = await runGit(
    ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-superproject-working-tree"],
    { cwd: realPath },
  );
  const [root, gitDir, commonDir, superproject] = stdout.split("\n");
  return {
    root: await fs.realpath(root),
    gitDir,
    isLinkedWorktree: path.resolve(gitDir) !== path.resolve(commonDir),
    superproject: superproject?.trim() ? superproject.trim() : null,
  };
}

function toEntry(stored: StoredRepository, state: RepositoryEntry["state"], stateMessage?: string): RepositoryEntry {
  return { ...stored, name: path.basename(stored.path), state, stateMessage };
}

async function describeStored(stored: StoredRepository): Promise<RepositoryEntry> {
  try {
    if (!(await fs.stat(stored.path)).isDirectory()) return toEntry(stored, "missing", "The path is no longer a folder.");
  } catch {
    return toEntry(stored, "missing", "The folder no longer exists. Remove it from the list or restore the folder.");
  }
  try {
    await fs.access(path.join(stored.path, ".git"));
    return toEntry(stored, "ok");
  } catch {
    return toEntry(stored, "invalid", "The folder exists but is no longer a Git repository.");
  }
}

export async function listRepositories(): Promise<RepositoryEntry[]> {
  const stored = await readStore();
  const entries = await Promise.all(stored.map(describeStored));
  return entries.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
}

export async function addRepository(input: unknown): Promise<RepositoryEntry> {
  const location = await inspectRepositoryPath(input);
  const id = repositoryId(location.root);
  const now = new Date().toISOString();
  const stored = await updateStore((entries) => {
    const existing = entries.find((entry) => entry.id === id);
    if (existing) {
      existing.lastOpenedAt = now;
      return { entries, result: existing };
    }
    const created: StoredRepository = { id, path: location.root, addedAt: now, lastOpenedAt: now };
    return { entries: [...entries, created], result: created };
  });
  return toEntry(stored, "ok");
}

/** Only removes the registry entry. Repository files are never touched. */
export async function removeRepository(id: string): Promise<void> {
  await updateStore((entries) => ({ entries: entries.filter((entry) => entry.id !== id), result: undefined }));
}

export async function openRepository(id: string): Promise<RepositoryEntry> {
  const stored = await updateStore((entries) => {
    const entry = entries.find((candidate) => candidate.id === id);
    if (entry) entry.lastOpenedAt = new Date().toISOString();
    return { entries, result: entry };
  });
  if (!stored) throw new GitError("repository-missing", "This repository is not in your list.", { status: 404 });
  return describeStored(stored);
}

/** Resolves a registered repository id to a context, verifying that the folder still exists. */
export async function getRepositoryContext(id: unknown): Promise<RepoContext> {
  if (typeof id !== "string") throw new GitError("validation", "A repository must be selected.");
  const stored = (await readStore()).find((entry) => entry.id === id);
  if (!stored) throw new GitError("repository-missing", "This repository is not in your list.", { status: 404 });
  const entry = await describeStored(stored);
  if (entry.state !== "ok") {
    throw new GitError(entry.state === "missing" ? "repository-missing" : "not-a-repository", entry.stateMessage ?? "Repository unavailable.", {
      status: 404,
    });
  }
  return { id: stored.id, root: stored.path };
}

export async function getRepositoryLocation(ctx: RepoContext) {
  return inspectRepositoryPath(ctx.root);
}
