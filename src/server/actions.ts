import type { ActionMap, ActionName } from "@/lib/contract";
import { REGISTRY_ACTIONS } from "@/lib/contract";
import path from "node:path";
import { createBranch, checkoutRevision, deleteBranch, deleteRemoteBranch, listBranches, renameBranch, setUpstream, uniqueCommits } from "./git/branches";
import { compareBranches, compareRevisions } from "./git/compare";
import { getCommitDetails, getRepositoryInfo } from "./git/commits";
import { getConflictContent, listConflicts, recreateConflict, resolveWithContent, resolveWithSide } from "./git/conflicts";
import type { RepoContext } from "./git/context";
import { readReflog, runDiagnostics } from "./git/diagnostics";
import { getFileDiff } from "./git/diff";
import { GitError } from "./git/errors";
import { readCommits, searchCommits } from "./git/history";
import { mergeAnatomy, mergeHistory, previewMerge, runMerge } from "./git/merge";
import { listOperations } from "./git/operations-log";
import { listRefs } from "./git/refs";
import { addRemote, fetchRemote, listRemotes, pullBranch, pushBranch, removeRemote, setRemoteUrl, syncStatus } from "./git/remotes";
import { addRepository, getRepositoryContext, listRepositories, openRepository, removeRepository } from "./git/repositories";
import { abortOperation, continueOperation, previewApply, previewRebase, runCherryPick, runRebase, runReset, runRevert, skipOperation } from "./git/sequencer";
import { applyStashEntry, createStash, dropStash, listStashes, popStashEntry, stashFiles } from "./git/stash";
import { applyHunk, createCommit, discardPaths, stageAll, stagePaths, unstageAll, unstagePaths } from "./git/staging";
import { readStatus } from "./git/status";
import { checkoutTag, createTag, deleteRemoteTag, deleteTag, listTags, pushTag, tagMessage } from "./git/tags";
import { optionalInteger, optionalString, requireRevision, requireString } from "./git/validate";
import { pickFolder } from "./native/pickFolder";

type Params = Record<string, unknown>;
type RegistryName = (typeof REGISTRY_ACTIONS)[number];
type Handlers = { [K in Exclude<ActionName, RegistryName>]: (ctx: RepoContext, params: Params) => Promise<ActionMap[K]["result"]> };
type RegistryHandlers = { [K in RegistryName]: (params: Params) => Promise<ActionMap[K]["result"]> };

const registryHandlers: RegistryHandlers = {
  "repos.list": () => listRepositories(),
  "repos.add": ({ path: folder }) => addRepository(folder),
  "repos.remove": async ({ id }) => {
    await removeRepository(requireString(id, "id", 64));
    return null;
  },
  "repos.open": ({ id }) => openRepository(requireString(id, "id", 64)),
  "repos.pickFolder": async () => ({ path: await pickFolder() }),
};

const handlers: Handlers = {
  "repo.info": (ctx) => getRepositoryInfo(ctx, path.basename(ctx.root)),
  "repo.status": (ctx) => readStatus(ctx),
  "repo.diagnostics": (ctx) => runDiagnostics(ctx),
  "repo.operations": async (ctx) => listOperations(ctx.id),
  "repo.reflog": (ctx) => readReflog(ctx),

  "graph.refs": (ctx) => listRefs(ctx),
  "graph.commits": (ctx, params) =>
    readCommits(ctx, {
      limit: optionalInteger(params.limit, "limit", 1, 2000, 300),
      skip: optionalInteger(params.skip, "skip", 0, 10_000_000, 0),
      refs: Array.isArray(params.refs) ? params.refs.filter((ref): ref is string => typeof ref === "string") : undefined,
    }),
  "graph.search": (ctx, params) => searchCommits(ctx, requireString(params.query, "query", 200)),
  "commit.details": (ctx, params) => getCommitDetails(ctx, params.hash),
  "diff.file": (ctx, params) => getFileDiff(ctx, params),

  "branches.list": (ctx, params) => listBranches(ctx, optionalString(params.target, "target", 256)),
  "branches.unique": (ctx, params) => uniqueCommits(ctx, params.branch, params.target),
  "branches.create": createBranch,
  "branches.checkout": checkoutRevision,
  "branches.rename": renameBranch,
  "branches.delete": deleteBranch,
  "branches.deleteRemote": deleteRemoteBranch,
  "branches.setUpstream": setUpstream,
  "compare.branches": (ctx, params) => compareBranches(ctx, requireRevision(params.source, "source"), requireRevision(params.target, "target")),
  "compare.revisions": (ctx, params) => compareRevisions(ctx, requireRevision(params.base, "base"), requireRevision(params.head, "head")),

  "merge.history": (ctx, params) => mergeHistory(ctx, params),
  "merge.anatomy": (ctx, params) => mergeAnatomy(ctx, params.hash),
  "merge.preview": previewMerge,
  "merge.run": runMerge,

  "conflicts.list": (ctx) => listConflicts(ctx),
  "conflicts.get": (ctx, params) => getConflictContent(ctx, params.path),
  "conflicts.resolve": resolveWithContent,
  "conflicts.takeSide": resolveWithSide,
  "conflicts.restore": (ctx, params) => recreateConflict(ctx, params.path),
  "operation.continue": continueOperation,
  "operation.skip": skipOperation,
  "operation.abort": abortOperation,

  "rebase.preview": previewRebase,
  "rebase.run": runRebase,
  "apply.preview": previewApply,
  "cherryPick.run": runCherryPick,
  "revert.run": runRevert,
  "reset.run": runReset,

  "stage.add": stagePaths,
  "stage.addAll": (ctx) => stageAll(ctx),
  "stage.remove": unstagePaths,
  "stage.removeAll": (ctx) => unstageAll(ctx),
  "stage.discard": discardPaths,
  "stage.hunk": applyHunk,
  "commit.create": createCommit,

  "remotes.list": (ctx) => listRemotes(ctx),
  "remotes.add": addRemote,
  "remotes.remove": removeRemote,
  "remotes.setUrl": setRemoteUrl,
  "remotes.fetch": fetchRemote,
  "remotes.sync": syncStatus,
  "remotes.pull": pullBranch,
  "remotes.push": pushBranch,

  "stash.list": (ctx) => listStashes(ctx),
  "stash.files": (ctx, params) => stashFiles(ctx, params.ref),
  "stash.create": createStash,
  "stash.apply": applyStashEntry,
  "stash.pop": popStashEntry,
  "stash.drop": dropStash,

  "tags.list": (ctx) => listTags(ctx),
  "tags.message": (ctx, params) => tagMessage(ctx, params.name),
  "tags.create": createTag,
  "tags.delete": deleteTag,
  "tags.push": pushTag,
  "tags.deleteRemote": deleteRemoteTag,
  "tags.checkout": checkoutTag,
};

const isRegistryAction = (action: string): action is RegistryName => (REGISTRY_ACTIONS as readonly string[]).includes(action);

/** Runs one validated action. Only registered action names can ever reach Git. */
export async function dispatchAction(request: { action: unknown; repoId?: unknown; params?: unknown }): Promise<unknown> {
  const action = request.action;
  if (typeof action !== "string") throw new GitError("validation", "Missing action.");
  const params: Params = request.params && typeof request.params === "object" && !Array.isArray(request.params) ? (request.params as Params) : {};

  if (isRegistryAction(action)) return registryHandlers[action](params);
  if (!Object.hasOwn(handlers, action)) throw new GitError("validation", `Unknown action “${action.slice(0, 60)}”.`, { status: 404 });

  const ctx = await getRepositoryContext(request.repoId);
  return (handlers as Record<string, (ctx: RepoContext, params: Params) => Promise<unknown>>)[action](ctx, params);
}
