import type { BranchInfo, BranchRelative, CommitSummary, OperationResult } from "@/lib/types";
import { countAheadBehind } from "./compare";
import { currentBranch, currentHead, git, gitText, refExists, resolveCommit, verify, type RepoContext } from "./context";
import { GitError } from "./errors";
import { readRangeCommits } from "./history";
import { mutate, operationResult } from "./mutate";
import { detectInProgress } from "./status";
import { assertBranchName, assertRemoteName, optionalBoolean, requireRevision, requireString } from "./validate";

const FIELD = "\u001f";
const BRANCH_FORMAT = [
  "%(refname)",
  "%(objectname)",
  "%(HEAD)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
  "%(contents:subject)",
  "%(authorname)",
  "%(committerdate:iso-strict)",
].join("%1f");
const RELATIVE_CONCURRENCY = 8;

function parseTracking(track: string): { gone: boolean; ahead: number; behind: number } {
  return {
    gone: track.includes("gone"),
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
  };
}

async function mapWithLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]);
      }
    }),
  );
  return results;
}

/** Lists branches. When `target` is given each branch is compared to it using real ancestry. */
export async function listBranches(ctx: RepoContext, targetRef?: string): Promise<BranchInfo[]> {
  const { stdout } = await git(ctx, ["for-each-ref", `--format=${BRANCH_FORMAT}`, "refs/heads", "refs/remotes"]);
  const branches: BranchInfo[] = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [fullName, hash, headMarker, upstream, track, subject, authorName, date] = line.split(FIELD);
      const tracking = parseTracking(track);
      const hasUpstream = Boolean(upstream);
      return {
        name: fullName.replace(/^refs\/(heads|remotes)\//, ""),
        fullName,
        kind: fullName.startsWith("refs/remotes/") ? ("remote" as const) : ("local" as const),
        isCurrent: headMarker === "*",
        hash,
        subject,
        authorName,
        date,
        upstream: hasUpstream ? upstream : null,
        upstreamGone: hasUpstream && tracking.gone,
        trackingAhead: hasUpstream && !tracking.gone ? tracking.ahead : null,
        trackingBehind: hasUpstream && !tracking.gone ? tracking.behind : null,
        relative: null as BranchRelative | null,
      };
    })
    .filter((branch) => !branch.fullName.endsWith("/HEAD"));

  if (targetRef) {
    const target = await resolveCommit(ctx, targetRef, "target");
    await mapWithLimit(branches, RELATIVE_CONCURRENCY, async (branch) => {
      const { ahead, behind } = await countAheadBehind(ctx, target, branch.hash);
      branch.relative = { ahead, behind, merged: ahead === 0 };
    });
  }
  return branches.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.date.localeCompare(a.date));
}

export async function uniqueCommits(ctx: RepoContext, branchRef: unknown, targetRef: unknown): Promise<CommitSummary[]> {
  const [branch, target] = await Promise.all([resolveCommit(ctx, branchRef, "branch"), resolveCommit(ctx, targetRef, "target")]);
  return (await readRangeCommits(ctx, branch, [target], 200)).commits;
}

async function assertNoOperationInProgress(ctx: RepoContext, action: string): Promise<void> {
  const inProgress = await detectInProgress(ctx);
  if (inProgress) {
    throw new GitError("precondition", `A ${inProgress.kind} is in progress. Finish or abort it before you ${action}.`);
  }
}

async function localBranchTip(ctx: RepoContext, name: string): Promise<string> {
  if (!(await refExists(ctx, `refs/heads/${name}`))) throw new GitError("ref-not-found", `Local branch “${name}” does not exist.`, { status: 404 });
  return gitText(ctx, ["rev-parse", `refs/heads/${name}`]);
}

export async function createBranch(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const name = await assertBranchName(params.name);
  const checkout = optionalBoolean(params.checkout);
  const startPoint = params.startPoint ? requireRevision(params.startPoint, "start point") : undefined;
  if (startPoint) await resolveCommit(ctx, startPoint, "start point");
  if (await refExists(ctx, `refs/heads/${name}`)) throw new GitError("ref-exists", `A branch named “${name}” already exists.`);
  if (checkout) await assertNoOperationInProgress(ctx, "switch branches");

  const headBefore = await currentHead(ctx);
  const args = checkout ? ["switch", "-c", name] : ["branch", name];
  if (startPoint) args.push(startPoint);
  const result = await mutate(ctx, `Create branch ${name}`, args);

  verify(await refExists(ctx, `refs/heads/${name}`), `Git reported success but branch “${name}” does not exist.`);
  if (checkout) verify((await currentBranch(ctx)) === name, `Branch “${name}” was created but is not checked out.`);
  return operationResult(ctx, headBefore, "success", checkout ? `Created and switched to ${name}.` : `Created branch ${name}.`, result);
}

/** Switches to a local branch, creates a tracking branch from a remote one, or detaches HEAD at a commit/tag. */
export async function checkoutRevision(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  await assertNoOperationInProgress(ctx, "switch branches");
  const headBefore = await currentHead(ctx);

  if (optionalBoolean(params.detached)) {
    const hash = await resolveCommit(ctx, params.name, "revision");
    const result = await mutate(ctx, `Checkout ${hash.slice(0, 8)} (detached HEAD)`, ["switch", "--detach", hash]);
    verify((await currentHead(ctx)) === hash && (await currentBranch(ctx)) === null, "HEAD was not detached at the requested commit.");
    return operationResult(ctx, headBefore, "success", `HEAD is detached at ${hash.slice(0, 8)}.`, result);
  }

  const name = requireRevision(params.name, "branch");
  if (await refExists(ctx, `refs/heads/${name}`)) {
    const result = await mutate(ctx, `Switch to ${name}`, ["switch", name]);
    verify((await currentBranch(ctx)) === name, `Git reported success but “${name}” is not checked out.`);
    return operationResult(ctx, headBefore, "success", `Switched to ${name}.`, result);
  }

  if (await refExists(ctx, `refs/remotes/${name}`)) {
    const localName = name.slice(name.indexOf("/") + 1);
    await assertBranchName(localName);
    if (await refExists(ctx, `refs/heads/${localName}`)) {
      throw new GitError("ref-exists", `A local branch “${localName}” already exists. Switch to it instead of creating a new tracking branch.`);
    }
    const result = await mutate(ctx, `Checkout ${name} as ${localName}`, ["switch", "-c", localName, "--track", name]);
    verify((await currentBranch(ctx)) === localName, `Tracking branch “${localName}” was not checked out.`);
    return operationResult(ctx, headBefore, "success", `Created local branch ${localName} tracking ${name} and switched to it.`, result);
  }
  throw new GitError("ref-not-found", `Branch “${name}” does not exist.`, { status: 404 });
}

export async function renameBranch(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const from = requireRevision(params.from, "current name");
  const to = await assertBranchName(params.to, "new name");
  await localBranchTip(ctx, from);
  if (await refExists(ctx, `refs/heads/${to}`)) throw new GitError("ref-exists", `A branch named “${to}” already exists.`);
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Rename branch ${from} to ${to}`, ["branch", "-m", from, to]);
  verify((await refExists(ctx, `refs/heads/${to}`)) && !(await refExists(ctx, `refs/heads/${from}`)), "The branch was not renamed.");
  return operationResult(ctx, headBefore, "success", `Renamed ${from} to ${to}. The remote branch (if any) was not renamed.`, result);
}

export async function deleteBranch(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const name = requireRevision(params.name, "branch");
  const force = optionalBoolean(params.force);
  const tip = await localBranchTip(ctx, name);
  if ((await currentBranch(ctx)) === name) {
    throw new GitError("precondition", `“${name}” is the branch you are on. Git cannot delete the checked-out branch.`, {
      suggestions: ["Switch to another branch first, then delete it."],
    });
  }
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Delete branch ${name}`, ["branch", force ? "-D" : "-d", name]);
  verify(!(await refExists(ctx, `refs/heads/${name}`)), `Branch “${name}” still exists after deletion.`);
  return operationResult(ctx, headBefore, "success", `Deleted ${name} (it pointed at ${tip.slice(0, 8)}). To restore it: git branch ${name} ${tip}`, result);
}

export async function deleteRemoteBranch(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const remote = assertRemoteName(params.remote);
  const name = await assertBranchName(params.name);
  if (params.confirmName !== name) throw new GitError("validation", "Type the branch name to confirm deleting it from the remote.");
  if (!(await refExists(ctx, `refs/remotes/${remote}/${name}`))) {
    throw new GitError("ref-not-found", `${remote}/${name} is not known locally. Fetch first.`, { status: 404 });
  }
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Delete remote branch ${remote}/${name}`, ["push", remote, "--delete", name], { timeoutMs: 180_000 });
  verify(!(await refExists(ctx, `refs/remotes/${remote}/${name}`)), "The remote-tracking branch still exists after the push.");
  return operationResult(ctx, headBefore, "success", `Deleted ${name} from ${remote}.`, result);
}

export async function setUpstream(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const name = requireRevision(params.name, "branch");
  await localBranchTip(ctx, name);
  const headBefore = await currentHead(ctx);

  if (params.upstream === null) {
    const result = await mutate(ctx, `Unset upstream of ${name}`, ["branch", "--unset-upstream", name]);
    return operationResult(ctx, headBefore, "success", `${name} no longer tracks a remote branch.`, result);
  }
  const upstream = requireString(params.upstream, "upstream", 256);
  requireRevision(upstream, "upstream");
  if (!(await refExists(ctx, `refs/remotes/${upstream}`))) {
    throw new GitError("ref-not-found", `Remote-tracking branch “${upstream}” does not exist. Fetch the remote first.`, { status: 404 });
  }
  const result = await mutate(ctx, `Set upstream of ${name} to ${upstream}`, ["branch", `--set-upstream-to=${upstream}`, name]);
  const configured = await gitText(ctx, ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${name}`]);
  verify(configured === upstream, "The upstream was not updated.");
  return operationResult(ctx, headBefore, "success", `${name} now tracks ${upstream}.`, result);
}
