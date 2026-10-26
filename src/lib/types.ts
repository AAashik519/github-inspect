// Domain types shared by the local Git backend (src/server) and the UI (src/components).
// Every value here is derived from real Git output; nothing is mocked.

export type RepoState = "ok" | "missing" | "invalid";

export interface RepositoryEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
  state: RepoState;
  stateMessage?: string;
}

export interface HeadInfo {
  branch: string | null;
  hash: string | null;
  detached: boolean;
  /** True for a repository without any commit yet. */
  unborn: boolean;
}

export interface RepositoryInfo {
  id: string;
  name: string;
  path: string;
  gitDir: string;
  isLinkedWorktree: boolean;
  isShallow: boolean;
  /** Path of the parent repository when this repository is a submodule. */
  superproject: string | null;
  submodules: string[];
  head: HeadInfo;
  hasCommits: boolean;
  commitCount: number | null;
  localBranchCount: number;
  remoteBranchCount: number;
  tagCount: number;
  stashCount: number;
  remoteCount: number;
  gitVersion: string;
  lastCommit: CommitSummary | null;
}

export interface UpstreamInfo {
  name: string;
  ahead: number;
  behind: number;
  gone: boolean;
}

export interface StatusFile {
  path: string;
  originalPath?: string;
  /** Index (staged) status letter, or " " when unchanged. */
  index: string;
  /** Working-tree status letter, or " " when unchanged. */
  worktree: string;
  isUntracked: boolean;
  isConflicted: boolean;
}

export type InProgressKind = "merge" | "rebase" | "cherry-pick" | "revert";

export interface InProgressOperation {
  kind: InProgressKind;
  detail: string | null;
  step: { current: number; total: number } | null;
}

export interface WorkingTreeStatus {
  head: HeadInfo;
  upstream: UpstreamInfo | null;
  files: StatusFile[];
  inProgress: InProgressOperation | null;
}

export type RefKind = "local" | "remote" | "tag";

export interface RefInfo {
  /** Short name, e.g. `main`, `origin/main`, `v1.0.0`. */
  name: string;
  fullName: string;
  kind: RefKind;
  /** Commit the ref resolves to (annotated tags are peeled). */
  hash: string;
  isHead: boolean;
  upstream: string | null;
}

export interface CommitSummary {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerDate: string;
  subject: string;
}

export type FileChangeStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U";

export interface FileChange {
  path: string;
  oldPath?: string;
  status: FileChangeStatus;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface CommitDetails extends CommitSummary {
  body: string;
  committerName: string;
  committerEmail: string;
  isMerge: boolean;
  parentSummaries: { hash: string; subject: string }[];
  branches: string[];
  tags: string[];
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
  /** Merge commits are compared against their first parent. */
  diffBase: "first-parent" | "root";
}

export interface BranchRelative {
  ahead: number;
  behind: number;
  merged: boolean;
}

export interface BranchInfo {
  name: string;
  fullName: string;
  kind: "local" | "remote";
  isCurrent: boolean;
  hash: string;
  subject: string;
  authorName: string;
  date: string;
  upstream: string | null;
  upstreamGone: boolean;
  trackingAhead: number | null;
  trackingBehind: number | null;
  /** Relative to the selected comparison target, computed from real ancestry. */
  relative: BranchRelative | null;
}

export type ComparisonRelation = "identical" | "ahead" | "behind" | "diverged" | "unrelated";

export interface BranchComparison {
  source: string;
  target: string;
  sourceHash: string;
  targetHash: string;
  mergeBase: string | null;
  ahead: number;
  behind: number;
  relation: ComparisonRelation;
  sourceOnly: CommitSummary[];
  targetOnly: CommitSummary[];
  files: FileChange[];
  commitListTruncated: boolean;
}

export interface RevisionComparison {
  base: string;
  head: string;
  files: FileChange[];
}

export type MergeStrategy = "default" | "no-ff" | "ff-only" | "squash";

export interface MergePreview {
  source: string;
  target: string;
  currentBranch: string | null;
  targetIsCurrent: boolean;
  mergeBase: string | null;
  commitsToIntroduce: CommitSummary[];
  commitsToIntroduceTotal: number;
  targetOnlyCount: number;
  alreadyMerged: boolean;
  canFastForward: boolean;
  conflicts: ConflictPreview;
  dirtyFileCount: number;
}

/**
 * How a merge's source or target branch name was established:
 * - message-and-refs: named in the merge message and current branches agree with it.
 * - message:          named in the merge message only; nothing in the current refs confirms it.
 * - ancestry:         exactly one local branch has this merge on its first-parent line.
 * - none:             could not be determined reliably.
 */
export type RelationshipEvidence = "message-and-refs" | "message" | "ancestry" | "none";

export interface MergeEndpoint {
  name: string | null;
  evidence: RelationshipEvidence;
  /** Branches that fit equally well when the answer is ambiguous. */
  candidates: string[];
}

export interface MergeEvent {
  hash: string;
  parents: string[];
  subject: string;
  authorName: string;
  authorDate: string;
  committerDate: string;
  /** Names parsed from the default merge message — inferred, not guaranteed. */
  inferredSource: string | null;
  inferredTarget: string | null;
  /** Branch/tag names currently pointing at each parent (confirmed facts). */
  parentRefs: string[][];
  /** Message names plus refs at the parents, de-duplicated. */
  relatedBranches: string[];
  /** Files changed relative to the first parent (what the merge brought into the receiving line). */
  filesChanged: number | null;
  /** Set when filtering by branch: the merge is in the branch's history, or brought the branch's work elsewhere. */
  involvement: "in-history" | "merged-from" | null;
}

export interface MergeHistoryPage {
  events: MergeEvent[];
  /** Merges matching the filters (before paging). */
  total: number;
  hasMore: boolean;
  /** True when the repository has more merge commits than were scanned. */
  scanTruncated: boolean;
}

export interface MergeAnatomy {
  hash: string;
  parents: { hash: string; subject: string; refs: string[]; uniqueCommits: number }[];
  mergeBase: string | null;
  mergeBaseSubject: string | null;
  branchesContaining: string[];
  files: FileChange[];
  relationship: { source: MergeEndpoint; target: MergeEndpoint };
}

export interface OperationResult {
  outcome: "success" | "conflict" | "noop";
  summary: string;
  output: string;
  headBefore: string | null;
  headAfter: string | null;
}

export interface ConflictFile {
  path: string;
  /** Human-readable conflict type derived from the unmerged index stages. */
  type: "both-modified" | "both-added" | "deleted-by-us" | "deleted-by-them" | "both-deleted" | "other";
}

export interface ConflictContent {
  path: string;
  type: ConflictFile["type"];
  /** Stage 2 — the branch you are on (current). */
  ours: string | null;
  /** Stage 1 — common ancestor. */
  base: string | null;
  /** Stage 3 — the branch being merged in (incoming). */
  theirs: string | null;
  /** The file as currently on disk, including conflict markers. */
  working: string | null;
  isBinary: boolean;
  oursLabel: string;
  theirsLabel: string;
}

export interface StashEntry {
  ref: string;
  index: number;
  hash: string;
  message: string;
  date: string;
  branch: string | null;
}

export interface TagInfo {
  name: string;
  /** Commit the tag points to. */
  hash: string;
  type: "lightweight" | "annotated";
  tagger: string | null;
  date: string | null;
  message: string;
  commitSubject: string;
}

export interface RemoteInfo {
  name: string;
  /** URLs are returned with embedded credentials removed. */
  fetchUrl: string;
  pushUrl: string;
  branches: string[];
}

export interface SyncStatus {
  remote: string | null;
  branch: string | null;
  upstream: string | null;
  incoming: CommitSummary[];
  outgoing: CommitSummary[];
  /** Simulated merge of the incoming commits into HEAD (no files are touched). */
  conflicts: ConflictPreview | null;
}

export interface ConflictPreview {
  supported: boolean;
  hasConflicts: boolean;
  files: string[];
}

export interface RebasePreview {
  branch: string;
  onto: string;
  commitsToReplay: CommitSummary[];
  commitsToReplayTotal: number;
  mergeCommitCount: number;
  alreadyBased: boolean;
  /** Commits that will be rewritten although they already exist on the upstream branch. */
  publishedCount: number;
  upstream: string | null;
  dirtyFileCount: number;
}

export interface ApplyPreview {
  hash: string;
  subject: string;
  isMerge: boolean;
  parentCount: number;
  conflicts: ConflictPreview;
  dirtyFileCount: number;
}

export type DiagnosticSeverity = "ok" | "info" | "warning" | "error";

export interface DiagnosticCheck {
  id: string;
  severity: DiagnosticSeverity;
  title: string;
  detail: string;
  suggestion?: string;
}

export interface DiagnosticReport {
  gitVersion: string | null;
  gitPath: string | null;
  checks: DiagnosticCheck[];
}

export interface ReflogEntry {
  selector: string;
  hash: string;
  subject: string;
  date: string;
}

export type ErrorKind =
  | "git-missing"
  | "invalid-path"
  | "not-a-repository"
  | "repository-missing"
  | "unsafe-directory"
  | "validation"
  | "precondition"
  | "auth-failed"
  | "network"
  | "non-fast-forward"
  | "no-remote"
  | "no-upstream"
  | "merge-conflict"
  | "dirty-worktree"
  | "identity-missing"
  | "ref-not-found"
  | "ref-exists"
  | "not-fully-merged"
  | "locked"
  | "timeout"
  | "verification-failed"
  | "forbidden-origin"
  | "unknown";

export interface ApiErrorPayload {
  kind: ErrorKind;
  message: string;
  explanation: string;
  suggestions: string[];
  /** Sanitised Git output (credentials removed). */
  output?: string;
}

export interface OperationLogEntry {
  id: string;
  at: string;
  repoId: string;
  label: string;
  /** Sanitised `git` arguments. */
  command: string;
  outcome: "success" | "conflict" | "failed";
  durationMs: number;
  output: string;
  error?: ApiErrorPayload;
}
