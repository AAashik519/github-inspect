// Merge, rebase, cherry-pick and revert share a pause/continue/abort life cycle.

import type { ApplyPreview, InProgressKind, OperationResult, RebasePreview } from "@/lib/types";
import { countAheadBehind, previewTreeMerge } from "./compare";
import { currentBranch, currentHead, gitText, resolveCommit, verify, type RepoContext } from "./context";
import { GitError } from "./errors";
import { readRangeCommits } from "./history";
import { listConflicts } from "./conflicts";
import { mutate, operationResult } from "./mutate";
import { detectInProgress, dirtyTrackedFiles, readStatus } from "./status";
import { optionalBoolean, optionalInteger, requireEnum, requireRevision } from "./validate";

const KINDS = ["merge", "rebase", "cherry-pick", "revert"] as const;

async function assertCleanAndIdle(ctx: RepoContext, action: string) {
  const status = await readStatus(ctx);
  if (status.inProgress) throw new GitError("precondition", `A ${status.inProgress.kind} is already in progress. Finish or abort it before you ${action}.`);
  const dirty = dirtyTrackedFiles(status);
  if (dirty.length > 0) {
    throw new GitError("dirty-worktree", `${dirty.length} file(s) have uncommitted changes. Commit or stash them before you ${action}.`);
  }
  return status;
}

/** Common tail for operations that may stop on conflicts instead of failing. */
async function finishPausable(
  ctx: RepoContext,
  kind: InProgressKind,
  headBefore: string | null,
  result: Awaited<ReturnType<typeof mutate>>,
  messages: { success: string; conflict: string },
): Promise<OperationResult> {
  if (result.code === 0) {
    verify((await detectInProgress(ctx)) === null, `The ${kind} reported success but is still in progress.`);
    return operationResult(ctx, headBefore, "success", messages.success, result);
  }
  const inProgress = await detectInProgress(ctx);
  if (inProgress?.kind === kind) return operationResult(ctx, headBefore, "conflict", messages.conflict, result);
  throw new GitError("unknown", `The ${kind} failed.`, { output: `${result.stdout}\n${result.stderr}` });
}

export async function continueOperation(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const kind = requireEnum(params.kind, "kind", KINDS);
  const inProgress = await detectInProgress(ctx);
  if (inProgress?.kind !== kind) throw new GitError("precondition", `No ${kind} is in progress.`);
  const unresolved = await listConflicts(ctx);
  if (unresolved.length > 0) {
    throw new GitError("precondition", `${unresolved.length} file(s) still have unresolved conflicts: ${unresolved.map((file) => file.path).join(", ")}.`);
  }
  const headBefore = await currentHead(ctx);
  const command = kind === "merge" ? ["commit", "--no-edit"] : [kind, "--continue"];
  const result = await mutate(ctx, `Continue ${kind}`, command, { okCodes: [0, 1] });
  return finishPausable(ctx, kind, headBefore, result, {
    success: kind === "merge" ? "Merge completed." : `The ${kind} finished.`,
    conflict: `The ${kind} continued but stopped again on the next commit. Resolve the new conflicts.`,
  });
}

/** Rebase and cherry-pick can skip the current commit; merge and revert cannot. */
export async function skipOperation(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const kind = requireEnum(params.kind, "kind", ["rebase", "cherry-pick"] as const);
  const inProgress = await detectInProgress(ctx);
  if (inProgress?.kind !== kind) throw new GitError("precondition", `No ${kind} is in progress.`);
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Skip current commit of ${kind}`, [kind, "--skip"], { okCodes: [0, 1] });
  return finishPausable(ctx, kind, headBefore, result, {
    success: `Skipped the commit; the ${kind} finished.`,
    conflict: `Skipped the commit, but the next one conflicts.`,
  });
}

export async function abortOperation(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const kind = requireEnum(params.kind, "kind", KINDS);
  const inProgress = await detectInProgress(ctx);
  if (inProgress?.kind !== kind) throw new GitError("precondition", `No ${kind} is in progress.`);
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Abort ${kind}`, [kind, "--abort"]);
  verify((await detectInProgress(ctx)) === null, `The ${kind} is still in progress after aborting.`);
  return operationResult(ctx, headBefore, "success", `Aborted the ${kind}; the repository is back to its state before it started.`, result);
}

export async function previewRebase(ctx: RepoContext, params: Record<string, unknown>): Promise<RebasePreview> {
  const onto = requireRevision(params.onto, "onto");
  const [ontoHash, status, branch] = await Promise.all([resolveCommit(ctx, onto, "onto"), readStatus(ctx), currentBranch(ctx)]);
  if (!branch) throw new GitError("precondition", "Rebase needs a checked-out branch. You are on a detached HEAD.");
  if (branch === onto) throw new GitError("validation", "A branch cannot be rebased onto itself.");

  const head = await resolveCommit(ctx, "HEAD");
  const [replay, counts, merges, upstream] = await Promise.all([
    readRangeCommits(ctx, head, [ontoHash], 100),
    countAheadBehind(ctx, ontoHash, head),
    gitText(ctx, ["rev-list", "--merges", "--count", head, "--not", ontoHash, "--"]),
    status.upstream && !status.upstream.gone ? status.upstream.name : null,
  ]);

  let publishedCount = 0;
  if (upstream) {
    const unpublished = await readRangeCommits(ctx, head, [ontoHash, upstream], 1);
    publishedCount = Math.max(0, replay.total - unpublished.total);
  }
  return {
    branch,
    onto,
    commitsToReplay: replay.commits,
    commitsToReplayTotal: replay.total,
    mergeCommitCount: Number(merges),
    alreadyBased: counts.behind === 0,
    publishedCount,
    upstream,
    dirtyFileCount: dirtyTrackedFiles(status).length,
  };
}

export async function runRebase(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const onto = requireRevision(params.onto, "onto");
  const status = await assertCleanAndIdle(ctx, "rebase");
  if (!status.head.branch) throw new GitError("precondition", "Rebase needs a checked-out branch. You are on a detached HEAD.");
  if (status.head.branch === onto) throw new GitError("validation", "A branch cannot be rebased onto itself.");
  await resolveCommit(ctx, onto, "onto");

  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Rebase ${status.head.branch} onto ${onto}`, ["rebase", onto], { okCodes: [0, 1], timeoutMs: 120_000 });
  const headAfter = await currentHead(ctx);
  if (result.code === 0 && headAfter === headBefore) {
    return operationResult(ctx, headBefore, "noop", `${status.head.branch} is already based on ${onto}.`, result);
  }
  return finishPausable(ctx, "rebase", headBefore, result, {
    success: `Rebased ${status.head.branch} onto ${onto}. Its commits were rewritten (new hashes).`,
    conflict: `Rebasing ${status.head.branch} onto ${onto} stopped with conflicts. Resolve them, then continue or abort.`,
  });
}

/** Conflict simulation for cherry-pick and revert, against the current HEAD. */
export async function previewApply(ctx: RepoContext, params: Record<string, unknown>): Promise<ApplyPreview> {
  const kind = requireEnum(params.kind, "kind", ["cherry-pick", "revert"] as const);
  const hash = await resolveCommit(ctx, params.hash, "commit");
  const mainline = params.mainline === undefined ? undefined : optionalInteger(params.mainline, "mainline", 1, 99, 1);
  const parents = (await gitText(ctx, ["rev-list", "--parents", "-n", "1", hash])).split(" ").slice(1);
  const status = await readStatus(ctx);
  const subject = await gitText(ctx, ["show", "-s", "--format=%s", hash]);

  const preview: ApplyPreview = {
    hash,
    subject,
    isMerge: parents.length > 1,
    parentCount: parents.length,
    conflicts: { supported: true, hasConflicts: false, files: [] },
    dirtyFileCount: dirtyTrackedFiles(status).length,
  };
  if (parents.length > 1 && !mainline) return { ...preview, conflicts: { supported: false, hasConflicts: false, files: [] } };

  const parent = parents.length === 0 ? null : parents[(mainline ?? 1) - 1];
  if (parents.length > 1 && !parent) throw new GitError("validation", `The commit only has ${parents.length} parents.`);
  if (!status.head.hash) return preview;
  if (kind === "cherry-pick") {
    // Applying commit C onto HEAD is a 3-way merge with the commit's parent as the base.
    return { ...preview, conflicts: parent ? await previewTreeMerge(ctx, status.head.hash, hash, parent) : preview.conflicts };
  }
  // Reverting is the same merge with base and theirs swapped.
  return { ...preview, conflicts: parent ? await previewTreeMerge(ctx, status.head.hash, parent, hash) : preview.conflicts };
}

async function applyCommit(ctx: RepoContext, kind: "cherry-pick" | "revert", params: Record<string, unknown>): Promise<OperationResult> {
  const hash = await resolveCommit(ctx, params.hash, "commit");
  const status = await assertCleanAndIdle(ctx, kind);
  if (status.head.unborn) throw new GitError("precondition", `Cannot ${kind} in a repository without commits.`);

  const parents = (await gitText(ctx, ["rev-list", "--parents", "-n", "1", hash])).split(" ").slice(1);
  const args: string[] = [kind];
  if (kind === "revert") args.push("--no-edit");
  if (parents.length > 1) {
    const mainline = params.mainline === undefined ? undefined : optionalInteger(params.mainline, "mainline", 1, parents.length, 1);
    if (!mainline) {
      throw new GitError("validation", `${hash.slice(0, 8)} is a merge commit with ${parents.length} parents. Choose the mainline parent (the side to keep) explicitly.`);
    }
    args.push("-m", String(mainline));
  }
  args.push(hash);

  const headBefore = await currentHead(ctx);
  const label = kind === "revert" ? "Revert" : "Cherry-pick";
  const result = await mutate(ctx, `${label} ${hash.slice(0, 8)}`, args, { okCodes: [0, 1] });
  if (result.code === 0) verify((await currentHead(ctx)) !== headBefore, `The ${kind} reported success but HEAD did not move.`);
  return finishPausable(ctx, kind, headBefore, result, {
    success: kind === "revert" ? `Reverted ${hash.slice(0, 8)} with a new commit.` : `Cherry-picked ${hash.slice(0, 8)} onto the current branch.`,
    conflict: `The ${kind} of ${hash.slice(0, 8)} stopped with conflicts. Resolve them, then continue or abort.`,
  });
}

export const runCherryPick = (ctx: RepoContext, params: Record<string, unknown>) => applyCommit(ctx, "cherry-pick", params);
export const runRevert = (ctx: RepoContext, params: Record<string, unknown>) => applyCommit(ctx, "revert", params);

export async function runReset(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const mode = requireEnum(params.mode, "mode", ["soft", "mixed", "hard"] as const);
  const hash = await resolveCommit(ctx, params.target, "target");
  const status = await readStatus(ctx);
  if (status.inProgress) throw new GitError("precondition", `A ${status.inProgress.kind} is in progress. Finish or abort it before resetting.`);
  if (mode === "hard" && !optionalBoolean(params.confirmHard)) {
    throw new GitError("validation", "A hard reset discards uncommitted changes and must be confirmed explicitly.");
  }
  const headBefore = await currentHead(ctx);
  const lostFiles = dirtyTrackedFiles(status).length;
  const result = await mutate(ctx, `Reset (${mode}) to ${hash.slice(0, 8)}`, ["reset", `--${mode}`, hash]);
  verify((await currentHead(ctx)) === hash, "HEAD does not point at the requested commit after the reset.");
  const recovery = headBefore ? ` To undo, reset back to ${headBefore.slice(0, 12)} (also listed in the reflog).` : "";
  const discarded = mode === "hard" && lostFiles > 0 ? ` ${lostFiles} file(s) with uncommitted changes were overwritten.` : "";
  return operationResult(ctx, headBefore, "success", `Reset ${status.head.branch ?? "HEAD"} (${mode}) to ${hash.slice(0, 8)}.${discarded}${recovery}`, result);
}