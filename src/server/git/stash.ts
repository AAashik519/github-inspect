import type { FileChange, OperationResult, StashEntry } from "@/lib/types";
import { emptyTreeHash, readFileChanges } from "./changes";
import { currentHead, git, type RepoContext, verify } from "./context";
import { GitError } from "./errors";
import { mutate, operationResult } from "./mutate";
import { readStatus } from "./status";
import { assertStashRef, optionalBoolean, optionalString } from "./validate";

const FIELD = "\u001f";
const STASH_BRANCH = /^(?:WIP on|On) ([^:]+):/;

export async function listStashes(ctx: RepoContext): Promise<StashEntry[]> {
  const { stdout } = await git(ctx, ["stash", "list", "--format=%gd%x1f%H%x1f%gs%x1f%cI"]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      const [ref, hash, message, date] = line.split(FIELD);
      return { ref, index, hash, message, date, branch: STASH_BRANCH.exec(message)?.[1] ?? null };
    });
}

async function requireStash(ctx: RepoContext, value: unknown): Promise<StashEntry> {
  const { ref } = assertStashRef(value);
  const entry = (await listStashes(ctx)).find((stash) => stash.ref === ref);
  if (!entry) throw new GitError("ref-not-found", `${ref} does not exist.`, { status: 404 });
  return entry;
}

export async function stashFiles(ctx: RepoContext, value: unknown): Promise<FileChange[]> {
  const { ref } = await requireStash(ctx, value);
  const tracked = await readFileChanges(ctx, [`${ref}^1`, ref]);
  const { code } = await git(ctx, ["rev-parse", "--verify", "--quiet", `${ref}^3`], { okCodes: [0, 1] });
  if (code !== 0) return tracked;
  const untracked = await readFileChanges(ctx, [await emptyTreeHash(ctx), `${ref}^3`]);
  return [...tracked, ...untracked];
}

export async function createStash(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const includeUntracked = optionalBoolean(params.includeUntracked);
  const message = optionalString(params.message, "message", 1000);
  const status = await readStatus(ctx);
  if (status.head.unborn) throw new GitError("precondition", "Stashing needs at least one commit.");
  const hasChanges = status.files.some((file) => (includeUntracked ? true : !file.isUntracked));
  if (!hasChanges) throw new GitError("precondition", "There are no local changes to stash.");
  if (status.files.some((file) => file.isConflicted)) throw new GitError("precondition", "Resolve conflicts before stashing.");

  const before = (await listStashes(ctx)).length;
  const args = ["stash", "push", ...(includeUntracked ? ["--include-untracked"] : []), ...(message ? ["-m", message] : [])];
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, "Create stash", args);
  verify((await listStashes(ctx)).length === before + 1, "Git reported success but no stash was created.");
  return operationResult(ctx, headBefore, "success", "Stashed your local changes. The working tree now matches HEAD.", result);
}

async function applyStash(ctx: RepoContext, action: "apply" | "pop", value: unknown): Promise<OperationResult> {
  const stash = await requireStash(ctx, value);
  const before = await listStashes(ctx);
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Stash ${action} ${stash.ref}`, ["stash", action, stash.ref], { okCodes: [0, 1] });

  const hasConflicts = (await readStatus(ctx)).files.some((file) => file.isConflicted);
  if (result.code !== 0) {
    if (hasConflicts) {
      const note = action === "pop" ? " The stash was kept because the pop did not complete cleanly." : "";
      return operationResult(ctx, headBefore, "conflict", `Applying ${stash.ref} produced conflicts. Resolve the conflicted files.${note}`, result);
    }
    throw new GitError("dirty-worktree", `Could not apply ${stash.ref}.`, { output: `${result.stdout}\n${result.stderr}` });
  }
  if (action === "pop") verify((await listStashes(ctx)).length === before.length - 1, "The stash was applied but not removed.");
  return operationResult(ctx, headBefore, "success", action === "pop" ? `Applied and removed ${stash.ref}.` : `Applied ${stash.ref}. The stash was kept.`, result);
}

export const applyStashEntry = (ctx: RepoContext, params: Record<string, unknown>) => applyStash(ctx, "apply", params.ref);
export const popStashEntry = (ctx: RepoContext, params: Record<string, unknown>) => applyStash(ctx, "pop", params.ref);

export async function dropStash(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const stash = await requireStash(ctx, params.ref);
  const before = (await listStashes(ctx)).length;
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Drop ${stash.ref}`, ["stash", "drop", stash.ref]);
  verify((await listStashes(ctx)).length === before - 1, "The stash was not removed.");
  return operationResult(ctx, headBefore, "success", `Dropped ${stash.ref}. To recover it: git stash apply ${stash.hash}`, result);
}
