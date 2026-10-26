import type { MergeAnatomy, MergeEvent, MergeHistoryPage, MergePreview, MergeStrategy, OperationResult, RefInfo } from "@/lib/types";
import { commitFileChanges } from "./changes";
import { countAheadBehind, findMergeBase, previewTreeMerge } from "./compare";
import { currentBranch, currentHead, git, gitText, refExists, resolveCommit, verify, type RepoContext } from "./context";
import { inferMergeNames, resolveEndpoint } from "@/lib/merge-message";
import { GitError } from "./errors";
import { COMMIT_FORMAT, parseCommits, readRangeCommits } from "./history";
import { mutate, operationResult } from "./mutate";
import { listRefs } from "./refs";
import { dirtyTrackedFiles, readStatus } from "./status";
import { optionalInteger, optionalString, requireEnum, requireRevision } from "./validate";

const PREVIEW_COMMIT_LIMIT = 100;

async function assertMergeableRefs(ctx: RepoContext, source: string, target: string) {
  if (!(await refExists(ctx, `refs/heads/${target}`))) {
    throw new GitError("precondition", `The target “${target}” must be a local branch — it is the branch that receives the changes.`);
  }
  await resolveCommit(ctx, source, "source");
}

export async function previewMerge(ctx: RepoContext, params: Record<string, unknown>): Promise<MergePreview> {
  const source = requireRevision(params.source, "source");
  const target = requireRevision(params.target, "target");
  if (source === target) throw new GitError("validation", "Source and target are the same branch.");
  await assertMergeableRefs(ctx, source, target);

  const [sourceHash, targetHash] = await Promise.all([resolveCommit(ctx, source), resolveCommit(ctx, target)]);
  const [status, branch, mergeBase, counts, introduced, conflicts] = await Promise.all([
    readStatus(ctx),
    currentBranch(ctx),
    findMergeBase(ctx, targetHash, sourceHash),
    countAheadBehind(ctx, targetHash, sourceHash),
    readRangeCommits(ctx, sourceHash, [targetHash], PREVIEW_COMMIT_LIMIT),
    previewTreeMerge(ctx, targetHash, sourceHash),
  ]);

  return {
    source,
    target,
    currentBranch: branch,
    targetIsCurrent: branch === target,
    mergeBase,
    commitsToIntroduce: introduced.commits,
    commitsToIntroduceTotal: introduced.total,
    targetOnlyCount: counts.behind,
    alreadyMerged: counts.ahead === 0,
    canFastForward: counts.ahead > 0 && mergeBase === targetHash,
    conflicts,
    dirtyFileCount: dirtyTrackedFiles(status).length,
  };
}

const MERGE_ARGUMENTS: Record<MergeStrategy, string[]> = {
  default: ["--no-edit"],
  "no-ff": ["--no-ff", "--no-edit"],
  "ff-only": ["--ff-only"],
  squash: ["--squash"],
};

/** Merges `source` into the checked-out branch, which must be `target`. Never switches branches. */
export async function runMerge(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const source = requireRevision(params.source, "source");
  const target = requireRevision(params.target, "target");
  const strategy = requireEnum(params.strategy ?? "default", "strategy", ["default", "no-ff", "ff-only", "squash"] as const);
  const message = optionalString(params.message, "message", 10_000);
  await assertMergeableRefs(ctx, source, target);

  const status = await readStatus(ctx);
  if (status.inProgress) throw new GitError("precondition", `A ${status.inProgress.kind} is already in progress. Finish or abort it first.`);
  if (status.head.branch !== target) {
    throw new GitError("precondition", `The target “${target}” is not checked out (you are on ${status.head.branch ?? "a detached HEAD"}). Switch to “${target}” first so it receives the merge.`);
  }
  const dirty = dirtyTrackedFiles(status);
  if (dirty.length > 0) {
    throw new GitError("dirty-worktree", `${dirty.length} file(s) have uncommitted changes. Commit or stash them before merging so the merge can be aborted safely.`);
  }

  const headBefore = await currentHead(ctx);
  const args = ["merge", ...MERGE_ARGUMENTS[strategy]];
  if (message && strategy !== "squash" && strategy !== "ff-only") args.push("-m", message);
  args.push(source);
  const result = await mutate(ctx, `Merge ${source} into ${target}`, args, { okCodes: [0, 1], timeoutMs: 120_000 });

  if (result.code === 1) {
    const after = await readStatus(ctx);
    if (after.inProgress?.kind === "merge" || after.files.some((file) => file.isConflicted)) {
      return operationResult(ctx, headBefore, "conflict", `Merging ${source} into ${target} stopped with conflicts. Resolve them, then continue or abort the merge.`, result);
    }
    throw new GitError("unknown", "The merge failed.", { output: `${result.stdout}\n${result.stderr}` });
  }

  const output = `${result.stdout}${result.stderr}`;
  const headAfter = await currentHead(ctx);
  if (/already up to date/i.test(output)) return operationResult(ctx, headBefore, "noop", `${target} already contains ${source}; nothing to merge.`, result);
  if (strategy === "squash") {
    const staged = (await readStatus(ctx)).files.some((file) => file.index !== " " && !file.isUntracked);
    verify(staged, "The squash merge reported success but staged no changes.");
    return operationResult(ctx, headBefore, "success", `Squashed the changes of ${source} into your index. Nothing is committed yet — review and commit them in Source Control.`, result);
  }
  verify(headAfter !== headBefore, "The merge reported success but HEAD did not move.");
  const fastForwarded = (await git(ctx, ["rev-list", "--parents", "-n", "1", "HEAD"])).stdout.trim().split(" ").length === 2;
  return operationResult(ctx, headBefore, "success", fastForwarded ? `Fast-forwarded ${target} to ${source}.` : `Merged ${source} into ${target} with a merge commit.`, result);
}

const MERGE_SCAN_LIMIT = 20_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function optionalDate(value: unknown, field: string): string | undefined {
  const date = optionalString(value, field, 10);
  if (date !== undefined && !DATE_PATTERN.test(date)) throw new GitError("validation", `“${field}” must be a date (YYYY-MM-DD).`);
  return date;
}

/** Files changed by each merge relative to its first parent, for one page of merges. */
async function countMergeFiles(ctx: RepoContext, hashes: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (hashes.length === 0) return counts;
  const { stdout } = await git(ctx, ["log", "--no-walk=unsorted", "--diff-merges=first-parent", "--shortstat", "--format=%x1e%H", ...hashes, "--"]);
  for (const record of stdout.split("\u001e")) {
    const [hash, ...rest] = record.trim().split("\n");
    if (!hash) continue;
    counts.set(hash, Number(/(\d+) files? changed/.exec(rest.join("\n"))?.[1] ?? 0));
  }
  return counts;
}

/**
 * Merge commits across all refs, filtered and ordered by date. Filtering by branch uses real ancestry:
 * a merge is related when the branch contains it, or when one of its merged-in parents is in the branch's history.
 */
export async function mergeHistory(ctx: RepoContext, params: Record<string, unknown>): Promise<MergeHistoryPage> {
  const limit = optionalInteger(params.limit, "limit", 1, 500, 100);
  const skip = optionalInteger(params.skip, "skip", 0, 1_000_000, 0);
  const refFilter = optionalString(params.ref, "ref", 512);
  const since = optionalDate(params.since, "since");
  const until = optionalDate(params.until, "until");
  const query = optionalString(params.query, "query", 200)?.trim().toLowerCase();
  const order = requireEnum(params.order ?? "newest", "order", ["newest", "oldest"] as const);

  const refs = await listRefs(ctx);
  const filterRef = refFilter ? refs.find((ref) => ref.fullName === refFilter) : undefined;
  if (refFilter && !filterRef) throw new GitError("ref-not-found", `The branch or tag “${refFilter}” no longer exists.`);

  const { stdout } = await git(
    ctx,
    ["log", "--merges", "--topo-order", COMMIT_FORMAT, `--max-count=${MERGE_SCAN_LIMIT + 1}`, "--branches", "--remotes", "--tags", "HEAD", "--"],
    { okCodes: [0, 128] },
  );
  const scanned = parseCommits(stdout);
  const scanTruncated = scanned.length > MERGE_SCAN_LIMIT;

  const refsByHash = new Map<string, string[]>();
  for (const ref of refs) refsByHash.set(ref.hash, [...(refsByHash.get(ref.hash) ?? []), ref.name]);
  const reachable = filterRef ? new Set((await git(ctx, ["rev-list", filterRef.fullName, "--"])).stdout.split("\n").filter(Boolean)) : null;

  const sinceTime = since ? new Date(`${since}T00:00:00`).getTime() : -Infinity;
  const untilTime = until ? new Date(`${until}T23:59:59.999`).getTime() : Infinity;

  const matching: MergeEvent[] = [];
  for (const commit of scanned.slice(0, MERGE_SCAN_LIMIT)) {
    const time = new Date(commit.authorDate).getTime();
    if (time < sinceTime || time > untilTime) continue;

    let involvement: MergeEvent["involvement"] = null;
    if (reachable) {
      if (reachable.has(commit.hash)) involvement = "in-history";
      else if (commit.parents.slice(1).some((parent) => reachable.has(parent))) involvement = "merged-from";
      else continue;
    }

    const inferred = inferMergeNames(commit.subject);
    const parentRefs = commit.parents.map((parent) => refsByHash.get(parent) ?? []);
    const relatedBranches = [...new Set([inferred.source, inferred.target, ...parentRefs.flat()].filter((name): name is string => Boolean(name)))];
    if (query && !commit.hash.startsWith(query) && !commit.subject.toLowerCase().includes(query) && !relatedBranches.some((name) => name.toLowerCase().includes(query))) continue;

    matching.push({
      hash: commit.hash,
      parents: commit.parents,
      subject: commit.subject,
      authorName: commit.authorName,
      authorDate: commit.authorDate,
      committerDate: commit.committerDate,
      inferredSource: inferred.source,
      inferredTarget: inferred.target,
      parentRefs,
      relatedBranches,
      filesChanged: null,
      involvement,
    });
  }

  const direction = order === "newest" ? -1 : 1;
  matching.sort((a, b) => direction * (new Date(a.committerDate).getTime() - new Date(b.committerDate).getTime()));
  const events = matching.slice(skip, skip + limit);
  const fileCounts = await countMergeFiles(ctx, events.map((event) => event.hash));
  for (const event of events) event.filesChanged = fileCounts.get(event.hash) ?? null;

  return { events, total: matching.length, hasMore: skip + limit < matching.length, scanTruncated };
}

/** Whether `ancestor` is reachable from `descendant` (or is it). */
async function isAncestor(ctx: RepoContext, ancestor: string, descendant: string): Promise<boolean> {
  return (await git(ctx, ["merge-base", "--is-ancestor", ancestor, descendant], { okCodes: [0, 1, 128] })).code === 0;
}

/** Refs a branch name from a merge message may refer to: `feature`, `origin/feature`, or `owner/feature` from a pull request. */
function refsMatchingName(refs: RefInfo[], name: string): RefInfo[] {
  const withoutOwner = name.includes("/") ? name.slice(name.indexOf("/") + 1) : null;
  return refs.filter(
    (ref) => ref.kind !== "tag" && (ref.name === name || ref.name.endsWith(`/${name}`) || (withoutOwner !== null && (ref.name === withoutOwner || ref.name.endsWith(`/${withoutOwner}`)))),
  );
}

const MAX_ANCESTRY_CHECKS = 25;

/**
 * Evaluates which branch was merged into which, using the merge message only as a claim that current
 * refs must back up. The receiving branch can also be found from first-parent ancestry: a branch whose
 * first-parent line passes through the merge received it (unless several branches share that line).
 */
async function evaluateRelationship(ctx: RepoContext, hash: string, parents: string[], subject: string, refs: RefInfo[], containing: string[]): Promise<MergeAnatomy["relationship"]> {
  const inferred = inferMergeNames(subject);

  const sourceConfirmed = inferred.source
    ? (await Promise.all(refsMatchingName(refs, inferred.source).map((ref) => Promise.all(parents.slice(1).map((parent) => isAncestor(ctx, parent, ref.fullName)))))).some((results) => results.some(Boolean))
    : false;

  const targetConfirmed = inferred.target ? (await Promise.all(refsMatchingName(refs, inferred.target).map((ref) => isAncestor(ctx, hash, ref.fullName)))).some(Boolean) : false;

  let firstParentBranches: string[] = [];
  if (!inferred.target) {
    const containingLocal = new Set(containing);
    const candidates = refs.filter((ref) => ref.kind === "local" && containingLocal.has(ref.name)).slice(0, MAX_ANCESTRY_CHECKS);
    // The first-parent walk from the branch stops at history already in the first parent, so it is short.
    const onFirstParentLine = await Promise.all(
      candidates.map(async (ref) => (await git(ctx, ["rev-list", "--first-parent", ref.fullName, "--not", parents[0], "--"])).stdout.split("\n").includes(hash)),
    );
    firstParentBranches = candidates.filter((_, index) => onFirstParentLine[index]).map((ref) => ref.name);
  }

  return {
    source: resolveEndpoint(inferred.source, sourceConfirmed),
    target: resolveEndpoint(inferred.target, targetConfirmed, firstParentBranches),
  };
}

export async function mergeAnatomy(ctx: RepoContext, revision: unknown): Promise<MergeAnatomy> {
  const hash = await resolveCommit(ctx, revision, "commit");
  const [parentLine, subject] = await Promise.all([gitText(ctx, ["rev-list", "--parents", "-n", "1", hash]), gitText(ctx, ["show", "-s", "--format=%s", hash])]);
  const parents = parentLine.split(" ").slice(1);
  if (parents.length < 2) throw new GitError("precondition", "This commit is not a merge commit.");

  const refs = await listRefs(ctx);
  const mergeBase = await git(ctx, ["merge-base", ...(parents.length > 2 ? ["--octopus"] : []), ...parents], { okCodes: [0, 1] });
  const baseHash = mergeBase.code === 0 ? mergeBase.stdout.trim() : null;

  const [summaries, uniqueCounts, containing, files, baseSubject] = await Promise.all([
    git(ctx, ["show", "-s", "--format=%H%x1f%s", ...parents]),
    Promise.all(
      parents.map((parent) =>
        git(ctx, ["rev-list", "--count", parent, "--not", ...parents.filter((other) => other !== parent), "--"]).then(({ stdout }) => Number(stdout.trim())),
      ),
    ),
    git(ctx, ["for-each-ref", "--contains", hash, "--format=%(refname:short)", "refs/heads", "refs/remotes"]),
    commitFileChanges(ctx, hash),
    baseHash ? gitText(ctx, ["show", "-s", "--format=%s", baseHash]) : Promise.resolve(null),
  ]);

  const branchesContaining = containing.stdout.split("\n").filter((name) => name && !name.endsWith("/HEAD"));
  const relationship = await evaluateRelationship(ctx, hash, parents, subject, refs, branchesContaining);

  const subjectByHash = new Map(
    summaries.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\u001f") as [string, string]),
  );
  return {
    hash,
    parents: parents.map((parent, index) => ({
      hash: parent,
      subject: subjectByHash.get(parent) ?? "",
      refs: refs.filter((ref) => ref.hash === parent).map((ref) => ref.name),
      uniqueCommits: uniqueCounts[index],
    })),
    mergeBase: baseHash,
    mergeBaseSubject: baseSubject,
    branchesContaining,
    files,
    relationship,
  };
}
