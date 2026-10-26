import fs from "node:fs/promises";
import path from "node:path";
import { hasConflictMarkers } from "@/lib/conflicts/markers";
import type { ConflictContent, ConflictFile, OperationResult } from "@/lib/types";
import { currentHead, git, type RepoContext } from "./context";
import { GitError } from "./errors";
import { mutate, operationResult } from "./mutate";
import { detectInProgress } from "./status";
import { assertRelativePath, requireEnum, requireString } from "./validate";

const MAX_CONFLICT_FILE_BYTES = 2 * 1024 * 1024;

export async function listConflicts(ctx: RepoContext): Promise<ConflictFile[]> {
  const { stdout } = await git(ctx, ["ls-files", "--unmerged", "-z"]);
  const stagesByPath = new Map<string, Set<number>>();
  for (const entry of stdout.split("\0").filter(Boolean)) {
    // "<mode> <object> <stage>\t<path>"
    const [meta, filePath] = [entry.slice(0, entry.indexOf("\t")), entry.slice(entry.indexOf("\t") + 1)];
    const stage = Number(meta.split(" ")[2]);
    stagesByPath.set(filePath, (stagesByPath.get(filePath) ?? new Set()).add(stage));
  }
  return [...stagesByPath].map(([filePath, stages]) => ({ path: filePath, type: conflictType(stages) }));
}

function conflictType(stages: Set<number>): ConflictFile["type"] {
  const key = [1, 2, 3].map((stage) => (stages.has(stage) ? stage : 0)).join("");
  switch (key) {
    case "123":
      return "both-modified";
    case "023":
      return "both-added";
    case "103":
      return "deleted-by-us";
    case "120":
      return "deleted-by-them";
    case "100":
      return "both-deleted";
    default:
      return "other";
  }
}

async function requireConflictedPath(ctx: RepoContext, value: unknown): Promise<ConflictFile> {
  const filePath = assertRelativePath(value);
  const conflict = (await listConflicts(ctx)).find((entry) => entry.path === filePath);
  if (!conflict) throw new GitError("precondition", `“${filePath}” is not a conflicted file.`);
  return conflict;
}

/** Resolves a repository-relative path and refuses anything that escapes the work tree (e.g. via symlinks). */
async function safeWorktreePath(ctx: RepoContext, relativePath: string): Promise<string> {
  const absolute = path.resolve(ctx.root, relativePath);
  const parent = await fs.realpath(path.dirname(absolute));
  const root = await fs.realpath(ctx.root);
  if (parent !== root && !parent.startsWith(root + path.sep)) throw new GitError("validation", "The path is outside the repository.");
  return path.join(parent, path.basename(absolute));
}

async function readStage(ctx: RepoContext, stage: number, filePath: string): Promise<Buffer | null> {
  const { stdout, code } = await git(ctx, ["show", `:${stage}:${filePath}`], { okCodes: [0, 128], maxBytes: MAX_CONFLICT_FILE_BYTES });
  return code === 0 ? Buffer.from(stdout, "utf8") : null;
}

export async function getConflictContent(ctx: RepoContext, value: unknown): Promise<ConflictContent> {
  const conflict = await requireConflictedPath(ctx, value);
  const [ours, base, theirs] = await Promise.all([2, 1, 3].map((stage) => readStage(ctx, stage, conflict.path)));

  let working: string | null = null;
  let isBinary = [ours, base, theirs].some((buffer) => buffer?.includes(0));
  try {
    const file = await safeWorktreePath(ctx, conflict.path);
    const stat = await fs.stat(file);
    if (stat.size > MAX_CONFLICT_FILE_BYTES) isBinary = true;
    else {
      const buffer = await fs.readFile(file);
      if (buffer.includes(0)) isBinary = true;
      else working = buffer.toString("utf8");
    }
  } catch {
    working = null; // The file is deleted on one side.
  }

  const inProgress = await detectInProgress(ctx);
  const labels: Record<string, [string, string]> = {
    merge: ["Current (the branch you are on)", "Incoming (the branch being merged)"],
    rebase: ["Current (the branch you are rebasing onto)", "Incoming (your commit being replayed)"],
    "cherry-pick": ["Current (the branch you are on)", "Incoming (the commit being picked)"],
    revert: ["Current (the branch you are on)", "Incoming (the reverting change)"],
  };
  const [oursLabel, theirsLabel] = labels[inProgress?.kind ?? "merge"];
  const text = (buffer: Buffer | null) => (isBinary || !buffer ? null : buffer.toString("utf8"));

  return {
    path: conflict.path,
    type: conflict.type,
    ours: text(ours),
    base: text(base),
    theirs: text(theirs),
    working,
    isBinary,
    oursLabel,
    theirsLabel,
  };
}

async function remainingConflicts(ctx: RepoContext): Promise<number> {
  return (await listConflicts(ctx)).length;
}

/** Writes the user's final text for a conflicted file and stages it — only if no conflict markers remain. */
export async function resolveWithContent(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const conflict = await requireConflictedPath(ctx, params.path);
  const content = requireString(params.content, "content", MAX_CONFLICT_FILE_BYTES);
  if (hasConflictMarkers(content)) {
    throw new GitError("validation", "The resolved text still contains conflict markers (<<<<<<<, =======, >>>>>>>). Resolve every block first.");
  }
  const headBefore = await currentHead(ctx);
  await fs.writeFile(await safeWorktreePath(ctx, conflict.path), content, "utf8");
  const result = await mutate(ctx, `Mark ${conflict.path} resolved`, ["add", "--", conflict.path], { literalPaths: true });

  const stillConflicted = (await listConflicts(ctx)).some((entry) => entry.path === conflict.path);
  if (stillConflicted) throw new GitError("verification-failed", `${conflict.path} is still marked as conflicted.`, { status: 500 });
  return operationResult(ctx, headBefore, "success", `Marked ${conflict.path} as resolved (${await remainingConflicts(ctx)} conflicted file(s) left).`, result);
}

/** Takes one whole side of a conflicted file, or removes the file. */
export async function resolveWithSide(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const conflict = await requireConflictedPath(ctx, params.path);
  const side = requireEnum(params.side, "side", ["ours", "theirs", "delete"] as const);
  const headBefore = await currentHead(ctx);

  let result;
  if (side === "delete") {
    result = await mutate(ctx, `Resolve ${conflict.path} by deleting it`, ["rm", "--force", "--", conflict.path], { literalPaths: true });
  } else {
    await mutate(ctx, `Take ${side === "ours" ? "current" : "incoming"} version of ${conflict.path}`, ["checkout", `--${side}`, "--", conflict.path], { literalPaths: true });
    result = await mutate(ctx, `Mark ${conflict.path} resolved`, ["add", "--", conflict.path], { literalPaths: true });
  }
  if ((await listConflicts(ctx)).some((entry) => entry.path === conflict.path)) {
    throw new GitError("verification-failed", `${conflict.path} is still marked as conflicted.`, { status: 500 });
  }
  return operationResult(ctx, headBefore, "success", `Resolved ${conflict.path}.`, result);
}

/** Restores the original conflict markers for a file that has not been staged yet. */
export async function recreateConflict(ctx: RepoContext, value: unknown): Promise<OperationResult> {
  const conflict = await requireConflictedPath(ctx, value);
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Restore conflict markers in ${conflict.path}`, ["checkout", "--merge", "--", conflict.path], { literalPaths: true });
  return operationResult(ctx, headBefore, "success", `Restored the original conflict in ${conflict.path}.`, result);
}
