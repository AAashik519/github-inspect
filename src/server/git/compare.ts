import type { BranchComparison, ComparisonRelation, ConflictPreview, RevisionComparison } from "@/lib/types";
import { readFileChanges } from "./changes";
import { git, resolveCommit, type RepoContext } from "./context";
import { readRangeCommits } from "./history";

const COMMIT_LIST_LIMIT = 100;

export async function findMergeBase(ctx: RepoContext, a: string, b: string): Promise<string | null> {
  const { stdout, code } = await git(ctx, ["merge-base", a, b], { okCodes: [0, 1] });
  return code === 0 ? stdout.trim() : null;
}

/** Ahead/behind from real ancestry: `behind` = in target only, `ahead` = in source only. */
export async function countAheadBehind(ctx: RepoContext, target: string, source: string): Promise<{ ahead: number; behind: number }> {
  const { stdout } = await git(ctx, ["rev-list", "--left-right", "--count", `${target}...${source}`, "--"]);
  const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
  return { ahead, behind };
}

export async function compareBranches(ctx: RepoContext, sourceRef: unknown, targetRef: unknown): Promise<BranchComparison> {
  const [sourceHash, targetHash] = await Promise.all([resolveCommit(ctx, sourceRef, "source"), resolveCommit(ctx, targetRef, "target")]);
  const [mergeBase, counts, sourceOnly, targetOnly] = await Promise.all([
    findMergeBase(ctx, targetHash, sourceHash),
    countAheadBehind(ctx, targetHash, sourceHash),
    readRangeCommits(ctx, sourceHash, [targetHash], COMMIT_LIST_LIMIT),
    readRangeCommits(ctx, targetHash, [sourceHash], COMMIT_LIST_LIMIT),
  ]);

  // With a common ancestor, the three-dot diff shows what the source introduced; otherwise compare the tips directly.
  const files = await readFileChanges(ctx, mergeBase ? [`${targetHash}...${sourceHash}`] : [targetHash, sourceHash]);

  let relation: ComparisonRelation;
  if (!mergeBase) relation = "unrelated";
  else if (counts.ahead === 0 && counts.behind === 0) relation = "identical";
  else if (counts.behind === 0) relation = "ahead";
  else if (counts.ahead === 0) relation = "behind";
  else relation = "diverged";

  return {
    source: String(sourceRef),
    target: String(targetRef),
    sourceHash,
    targetHash,
    mergeBase,
    ahead: counts.ahead,
    behind: counts.behind,
    relation,
    sourceOnly: sourceOnly.commits,
    targetOnly: targetOnly.commits,
    files,
    commitListTruncated: sourceOnly.total > COMMIT_LIST_LIMIT || targetOnly.total > COMMIT_LIST_LIMIT,
  };
}

export async function compareRevisions(ctx: RepoContext, baseRef: unknown, headRef: unknown): Promise<RevisionComparison> {
  const [base, head] = await Promise.all([resolveCommit(ctx, baseRef, "base"), resolveCommit(ctx, headRef, "head")]);
  return { base, head, files: await readFileChanges(ctx, [base, head]) };
}

/**
 * Simulates a merge with `git merge-tree --write-tree` (Git 2.38+). It writes unreachable objects only;
 * the working tree, index and refs are never touched.
 */
export async function previewTreeMerge(ctx: RepoContext, ours: string, theirs: string, mergeBase?: string): Promise<ConflictPreview> {
  const baseArgs = mergeBase ? [`--merge-base=${mergeBase}`] : [];
  const { stdout, code } = await git(ctx, ["merge-tree", "--write-tree", "--name-only", ...baseArgs, ours, theirs], {
    okCodes: [0, 1, 128, 129],
  });
  if (code === 0) return { supported: true, hasConflicts: false, files: [] };
  if (code !== 1) return { supported: false, hasConflicts: false, files: [] };
  // Output: tree id, conflicted file names, a blank line, then informational messages.
  const [, ...rest] = stdout.split("\n");
  const blankLine = rest.indexOf("");
  const files = (blankLine === -1 ? rest : rest.slice(0, blankLine)).filter(Boolean);
  return { supported: true, hasConflicts: true, files: [...new Set(files)] };
}
