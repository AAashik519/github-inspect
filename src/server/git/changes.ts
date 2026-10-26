import type { FileChange, FileChangeStatus } from "@/lib/types";
import { git, resolveCommit, type RepoContext } from "./context";

const MAX_FILES = 3000;

/** Parses `--name-status -z` output into path/status pairs. Exported for tests. */
export function parseNameStatus(output: string): Map<string, FileChange> {
  const tokens = output.split("\0");
  const changes = new Map<string, FileChange>();
  for (let index = 0; index < tokens.length; index++) {
    const code = tokens[index];
    if (!code) continue;
    const status = code[0] as FileChangeStatus;
    if (status === "R" || status === "C") {
      const oldPath = tokens[++index];
      const path = tokens[++index];
      changes.set(path, { path, oldPath, status, additions: null, deletions: null, binary: false });
    } else {
      const path = tokens[++index];
      changes.set(path, { path, status, additions: null, deletions: null, binary: false });
    }
  }
  return changes;
}

/** Parses `--numstat -z`; renames carry an empty path followed by old and new paths. */
export function applyNumstat(output: string, changes: Map<string, FileChange>): void {
  const tokens = output.split("\0");
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;
    const [added, deleted, inlinePath] = token.split("\t");
    let path = inlinePath;
    if (path === "") {
      index++; // old path
      path = tokens[++index];
    }
    const change = changes.get(path);
    if (!change) continue;
    if (added === "-") change.binary = true;
    else {
      change.additions = Number(added);
      change.deletions = Number(deleted);
    }
  }
}

/** File changes for `git diff <revisionArgs>` (e.g. ["a", "b"] or ["a...b"]). */
export async function readFileChanges(ctx: RepoContext, revisionArgs: string[], extra: string[] = []): Promise<FileChange[]> {
  const common = ["diff", "--no-color", "--no-ext-diff", "-M", "-z", ...extra];
  const [nameStatus, numstat] = await Promise.all([
    git(ctx, [...common, "--name-status", ...revisionArgs, "--"]),
    git(ctx, [...common, "--numstat", ...revisionArgs, "--"]),
  ]);
  const changes = parseNameStatus(nameStatus.stdout);
  applyNumstat(numstat.stdout, changes);
  return [...changes.values()].slice(0, MAX_FILES).sort((a, b) => a.path.localeCompare(b.path));
}

let emptyTreeCache: string | undefined;

/** The empty tree for this object format; the diff base for a root commit. */
export async function emptyTreeHash(ctx: RepoContext): Promise<string> {
  if (!emptyTreeCache) {
    const { stdout } = await git(ctx, ["hash-object", "-t", "tree", "--stdin"], { input: "" });
    emptyTreeCache = stdout.trim();
  }
  return emptyTreeCache;
}

/** Commits are compared against their first parent (or the empty tree for a root commit). */
export async function diffBaseFor(ctx: RepoContext, hash: string): Promise<{ base: string; isRoot: boolean }> {
  const { stdout, code } = await git(ctx, ["rev-parse", "--verify", "--quiet", `${hash}^1`], { okCodes: [0, 1] });
  if (code === 0) return { base: stdout.trim(), isRoot: false };
  return { base: await emptyTreeHash(ctx), isRoot: true };
}

export async function commitFileChanges(ctx: RepoContext, revision: unknown): Promise<FileChange[]> {
  const hash = await resolveCommit(ctx, revision);
  const { base } = await diffBaseFor(ctx, hash);
  return readFileChanges(ctx, [base, hash]);
}

export function countByStatus(files: FileChange[]) {
  return files.reduce(
    (counts, file) => {
      if (file.status === "A") counts.added++;
      else if (file.status === "D") counts.deleted++;
      else if (file.status === "R" || file.status === "C") counts.renamed++;
      else counts.modified++;
      return counts;
    },
    { added: 0, modified: 0, deleted: 0, renamed: 0 },
  );
}
