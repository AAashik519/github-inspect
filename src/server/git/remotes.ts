import type { OperationResult, RemoteInfo, SyncStatus } from "@/lib/types";
import { previewTreeMerge } from "./compare";
import { currentHead, git, gitText, refExists, resolveCommit, verify, type RepoContext } from "./context";
import { GitError } from "./errors";
import { readRangeCommits } from "./history";
import { mutate, operationResult } from "./mutate";
import { listRefs } from "./refs";
import { redact } from "./redact";
import { NETWORK_TIMEOUT_MS } from "./run";
import { detectInProgress, dirtyTrackedFiles, readStatus } from "./status";
import { assertBranchName, assertRemoteName, assertRemoteUrl, optionalBoolean, requireEnum } from "./validate";

async function remoteNames(ctx: RepoContext): Promise<string[]> {
  const { stdout } = await git(ctx, ["remote"]);
  return stdout.split("\n").filter(Boolean);
}

async function requireRemote(ctx: RepoContext, name: unknown): Promise<string> {
  const remote = assertRemoteName(name);
  if (!(await remoteNames(ctx)).includes(remote)) {
    throw new GitError("no-remote", `The remote “${remote}” is not configured.`, { status: 404, suggestions: ["Add it in Remotes first."] });
  }
  return remote;
}

export async function listRemotes(ctx: RepoContext): Promise<RemoteInfo[]> {
  const [names, refs] = await Promise.all([remoteNames(ctx), listRefs(ctx)]);
  return Promise.all(
    names.map(async (name) => {
      const [fetchUrl, pushUrl] = await Promise.all([
        gitText(ctx, ["remote", "get-url", name]),
        gitText(ctx, ["remote", "get-url", "--push", name]),
      ]);
      return {
        name,
        fetchUrl: redact(fetchUrl),
        pushUrl: redact(pushUrl),
        branches: refs.filter((ref) => ref.kind === "remote" && ref.name.startsWith(`${name}/`)).map((ref) => ref.name),
      };
    }),
  );
}

export async function addRemote(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const name = assertRemoteName(params.name);
  const url = assertRemoteUrl(params.url);
  if ((await remoteNames(ctx)).includes(name)) throw new GitError("ref-exists", `A remote named “${name}” already exists.`);
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Add remote ${name}`, ["remote", "add", name, url]);
  verify((await remoteNames(ctx)).includes(name), "The remote was not added.");
  return operationResult(ctx, headBefore, "success", `Added remote ${name}. Fetch it to download its branches.`, result);
}

export async function removeRemote(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const name = await requireRemote(ctx, params.name);
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Remove remote ${name}`, ["remote", "remove", name]);
  verify(!(await remoteNames(ctx)).includes(name), "The remote still exists.");
  return operationResult(ctx, headBefore, "success", `Removed remote ${name} and its remote-tracking branches. The remote server itself was not changed.`, result);
}

export async function setRemoteUrl(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const name = await requireRemote(ctx, params.name);
  const url = assertRemoteUrl(params.url);
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Change URL of ${name}`, ["remote", "set-url", name, url]);
  verify((await gitText(ctx, ["remote", "get-url", name])) === url, "The remote URL was not updated.");
  return operationResult(ctx, headBefore, "success", `Updated the URL of ${name}.`, result);
}

export async function fetchRemote(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const prune = optionalBoolean(params.prune);
  const remotes = await remoteNames(ctx);
  if (remotes.length === 0) throw new GitError("no-remote", "This repository has no remotes.", { suggestions: ["Add a remote in Remotes."] });

  const headBefore = await currentHead(ctx);
  const isAll = params.remote === null || params.remote === undefined;
  const remote = isAll ? null : await requireRemote(ctx, params.remote);
  const args = ["fetch", ...(prune ? ["--prune"] : []), ...(remote ? [remote] : ["--all"])];
  const result = await mutate(ctx, remote ? `Fetch ${remote}` : "Fetch all remotes", args, { timeoutMs: NETWORK_TIMEOUT_MS });
  const output = `${result.stdout}${result.stderr}`.trim();
  return operationResult(ctx, headBefore, output ? "success" : "noop", output ? `Fetched ${remote ?? "all remotes"}.` : `${remote ?? "All remotes"} already up to date.`, result);
}

/** Incoming and outgoing commits between HEAD and a remote branch (the upstream by default). */
export async function syncStatus(ctx: RepoContext, params: Record<string, unknown>): Promise<SyncStatus> {
  const status = await readStatus(ctx);
  let remote: string | null = null;
  let branch: string | null = null;
  if (params.remote && params.branch) {
    remote = await requireRemote(ctx, params.remote);
    branch = await assertBranchName(params.branch);
  } else if (status.upstream && !status.upstream.gone) {
    const slash = status.upstream.name.indexOf("/");
    remote = status.upstream.name.slice(0, slash);
    branch = status.upstream.name.slice(slash + 1);
  }
  const empty: SyncStatus = { remote, branch, upstream: null, incoming: [], outgoing: [], conflicts: null };
  if (!remote || !branch || !status.head.hash || !(await refExists(ctx, `refs/remotes/${remote}/${branch}`))) return empty;

  const upstream = `${remote}/${branch}`;
  const upstreamHash = await resolveCommit(ctx, upstream);
  const [incoming, outgoing, conflicts] = await Promise.all([
    readRangeCommits(ctx, upstreamHash, [status.head.hash], 100),
    readRangeCommits(ctx, status.head.hash, [upstreamHash], 100),
    previewTreeMerge(ctx, status.head.hash, upstreamHash),
  ]);
  return { remote, branch, upstream, incoming: incoming.commits, outgoing: outgoing.commits, conflicts };
}

export async function pullBranch(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const remote = await requireRemote(ctx, params.remote);
  const branch = await assertBranchName(params.branch);
  const mode = requireEnum(params.mode ?? "ff-only", "mode", ["ff-only", "merge", "rebase"] as const);
  const status = await readStatus(ctx);

  if (status.inProgress) throw new GitError("precondition", `A ${status.inProgress.kind} is in progress. Finish or abort it before pulling.`);
  if (!status.head.branch) throw new GitError("precondition", "You are on a detached HEAD; check out a branch before pulling.");
  if (mode !== "ff-only" && dirtyTrackedFiles(status).length > 0) {
    throw new GitError("dirty-worktree", "You have uncommitted changes. Commit or stash them before a merge/rebase pull.");
  }

  const flag = { "ff-only": "--ff-only", merge: "--no-rebase", rebase: "--rebase" }[mode];
  const headBefore = status.head.hash;
  const label = `Pull ${remote}/${branch} into ${status.head.branch} (${mode})`;
  const result = await mutate(ctx, label, ["pull", flag, remote, branch], { okCodes: [0, 1], timeoutMs: NETWORK_TIMEOUT_MS });

  const inProgress = await detectInProgress(ctx);
  if (result.code !== 0) {
    if (inProgress) {
      return operationResult(ctx, headBefore, "conflict", `Pulling ${remote}/${branch} stopped with conflicts. Resolve them, then continue or abort.`, result);
    }
    throw new GitError("unknown", "The pull failed.", { output: `${result.stdout}\n${result.stderr}` });
  }
  verify(inProgress === null, "The pull reported success but an operation is still in progress.");
  const headAfter = await currentHead(ctx);
  if (headAfter === headBefore) return operationResult(ctx, headBefore, "noop", `${status.head.branch} is already up to date with ${remote}/${branch}.`, result);
  return operationResult(ctx, headBefore, "success", `Pulled ${remote}/${branch} into ${status.head.branch}.`, result);
}

export async function pushBranch(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const remote = await requireRemote(ctx, params.remote);
  const branch = await assertBranchName(params.branch);
  const setUpstream = optionalBoolean(params.setUpstream);
  const force = optionalBoolean(params.force);
  if (!(await refExists(ctx, `refs/heads/${branch}`))) throw new GitError("ref-not-found", `Local branch “${branch}” does not exist.`, { status: 404 });
  if (force && params.forceConfirm !== branch) {
    throw new GitError("validation", "A force push can destroy commits on the remote. Type the branch name to confirm.");
  }

  const headBefore = await currentHead(ctx);
  const refspec = `refs/heads/${branch}:refs/heads/${branch}`;
  // --force-with-lease refuses to overwrite remote commits we have not seen, unlike a plain --force.
  const args = ["push", ...(setUpstream ? ["--set-upstream"] : []), ...(force ? ["--force-with-lease"] : []), remote, refspec];
  const result = await mutate(ctx, `Push ${branch} to ${remote}${force ? " (force with lease)" : ""}`, args, { timeoutMs: NETWORK_TIMEOUT_MS });

  const trackingRef = `refs/remotes/${remote}/${branch}`;
  if (await refExists(ctx, trackingRef)) {
    const [local, remoteTracking] = await Promise.all([gitText(ctx, ["rev-parse", `refs/heads/${branch}`]), gitText(ctx, ["rev-parse", trackingRef])]);
    verify(local === remoteTracking, `The push finished but ${remote}/${branch} does not match ${branch}.`);
  }
  const upToDate = /everything up-to-date/i.test(`${result.stdout}${result.stderr}`);
  return operationResult(ctx, headBefore, upToDate ? "noop" : "success", upToDate ? `${remote}/${branch} is already up to date.` : `Pushed ${branch} to ${remote}.`, result);
}
