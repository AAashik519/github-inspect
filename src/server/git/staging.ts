import { buildHunkPatch } from "@/lib/diff/parse";
import type { OperationResult } from "@/lib/types";
import { currentHead, git, verify, type RepoContext } from "./context";
import { GitError } from "./errors";
import { getFileDiff } from "./diff";
import { mutate, operationResult } from "./mutate";
import { readStatus, stagedFiles } from "./status";
import { assertCommitMessage, assertPaths, assertRelativePath, optionalBoolean, optionalInteger, requireEnum, requireString } from "./validate";

const PATHSPEC_FROM_STDIN = ["--pathspec-from-file=-", "--pathspec-file-nul"];

function pathInput(paths: string[]): string {
  return paths.join("\0");
}

async function result(ctx: RepoContext, headBefore: string | null, summary: string, gitResult: Awaited<ReturnType<typeof mutate>>) {
  return operationResult(ctx, headBefore, "success", summary, gitResult);
}

export async function stagePaths(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const paths = assertPaths(params.paths);
  const headBefore = await currentHead(ctx);
  const gitResult = await mutate(ctx, `Stage ${paths.length} file(s)`, ["add", ...PATHSPEC_FROM_STDIN], { input: pathInput(paths), literalPaths: true });
  return result(ctx, headBefore, `Staged ${paths.length} file(s).`, gitResult);
}

export async function stageAll(ctx: RepoContext): Promise<OperationResult> {
  const headBefore = await currentHead(ctx);
  const gitResult = await mutate(ctx, "Stage all changes", ["add", "--all"]);
  return result(ctx, headBefore, "Staged all changes.", gitResult);
}

export async function unstagePaths(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const paths = assertPaths(params.paths);
  const headBefore = await currentHead(ctx);
  // Without a first commit there is no HEAD to restore from; remove the paths from the index instead.
  const command = headBefore ? ["restore", "--staged", ...PATHSPEC_FROM_STDIN] : ["rm", "--cached", "-r", "-q", ...PATHSPEC_FROM_STDIN];
  const gitResult = await mutate(ctx, `Unstage ${paths.length} file(s)`, command, { input: pathInput(paths), literalPaths: true });
  return result(ctx, headBefore, `Unstaged ${paths.length} file(s).`, gitResult);
}

export async function unstageAll(ctx: RepoContext): Promise<OperationResult> {
  const headBefore = await currentHead(ctx);
  const gitResult = await mutate(ctx, "Unstage all changes", ["reset", "--quiet"]);
  return result(ctx, headBefore, "Unstaged all changes. Your edits are still in the working tree.", gitResult);
}

/** Irreversibly throws away working-tree changes of the given files. The caller must pass `confirmed: true`. */
export async function discardPaths(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  if (!optionalBoolean(params.confirmed)) throw new GitError("validation", "Discarding changes must be confirmed explicitly.");
  const paths = assertPaths(params.paths);
  const status = await readStatus(ctx);
  const byPath = new Map(status.files.map((file) => [file.path, file]));

  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const filePath of paths) {
    const file = byPath.get(filePath);
    if (!file) throw new GitError("precondition", `“${filePath}” has no changes to discard.`);
    if (file.isConflicted) throw new GitError("precondition", `“${filePath}” is conflicted. Resolve or abort instead of discarding.`);
    (file.isUntracked ? untracked : tracked).push(filePath);
  }

  const headBefore = await currentHead(ctx);
  let last;
  if (tracked.length > 0) {
    last = await mutate(ctx, `Discard changes in ${tracked.length} file(s)`, ["restore", "--worktree", ...PATHSPEC_FROM_STDIN], { input: pathInput(tracked), literalPaths: true });
  }
  if (untracked.length > 0) {
    last = await mutate(ctx, `Delete ${untracked.length} untracked file(s)`, ["clean", "--force", "--", ...untracked], { literalPaths: true });
  }
  const after = new Map((await readStatus(ctx)).files.map((file) => [file.path, file]));
  verify(
    paths.every((filePath) => {
      const file = after.get(filePath);
      return !file || (!file.isUntracked && file.worktree === " ");
    }),
    "Some changes were not discarded.",
  );
  return result(ctx, headBefore, `Discarded changes in ${paths.length} file(s).`, last!);
}

/** Stage, unstage or discard a single hunk. The patch is rebuilt server-side from a fresh diff. */
export async function applyHunk(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const action = requireEnum(params.action, "action", ["stage", "unstage", "discard"] as const);
  const filePath = assertRelativePath(params.path);
  const hunkIndex = optionalInteger(params.hunkIndex, "hunkIndex", 0, 100_000, 0);
  const header = requireString(params.hunkHeader, "hunkHeader", 1000);
  if (action === "discard" && !optionalBoolean(params.confirmed)) throw new GitError("validation", "Discarding a hunk must be confirmed explicitly.");

  const { files, truncated } = await getFileDiff(ctx, { kind: action === "unstage" ? "staged" : "unstaged", path: filePath });
  const file = files[0];
  if (!file || truncated) throw new GitError("precondition", "The diff is unavailable or too large for hunk operations. Stage the whole file instead.");
  if (file.kind !== "modified") throw new GitError("precondition", "Hunk operations are only available for modified text files.");
  if (file.hunks[hunkIndex]?.header !== header) throw new GitError("precondition", "The file changed since the diff was loaded. Refresh and try again.");
  const patch = buildHunkPatch(file, hunkIndex);
  if (!patch) throw new GitError("precondition", "This hunk cannot be applied separately.");

  const flags = action === "stage" ? ["--cached"] : action === "unstage" ? ["--cached", "--reverse"] : ["--reverse"];
  const headBefore = await currentHead(ctx);
  const gitResult = await mutate(ctx, `${action} hunk in ${filePath}`, ["apply", ...flags, "--whitespace=nowarn", "-"], { input: patch, literalPaths: true });
  const verbs = { stage: "Staged", unstage: "Unstaged", discard: "Discarded" };
  return result(ctx, headBefore, `${verbs[action]} one change in ${filePath}.`, gitResult);
}

export async function createCommit(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const message = assertCommitMessage(params.message);
  const amend = optionalBoolean(params.amend);
  const status = await readStatus(ctx);

  if (status.inProgress) throw new GitError("precondition", `A ${status.inProgress.kind} is in progress. Use “Continue” to finish it instead of committing manually.`);
  if (status.files.some((file) => file.isConflicted)) throw new GitError("precondition", "Resolve all conflicted files before committing.");
  if (amend && status.head.unborn) throw new GitError("precondition", "There is no commit to amend yet.");
  if (!amend && stagedFiles(status).length === 0) throw new GitError("precondition", "There are no staged changes to commit. Stage files first.");

  const headBefore = status.head.hash;
  const gitResult = await mutate(ctx, amend ? "Amend last commit" : "Commit", ["commit", ...(amend ? ["--amend"] : []), "-F", "-"], { input: `${message}\n` });
  const headAfter = await currentHead(ctx);
  verify(headAfter !== null && headAfter !== headBefore, "Git reported success but no new commit was created.");
  const subject = (await git(ctx, ["show", "-s", "--format=%s", "HEAD"])).stdout.trim();
  return operationResult(ctx, headBefore, "success", `${amend ? "Amended" : "Committed"} ${headAfter!.slice(0, 8)}: ${subject}`, gitResult);
}
