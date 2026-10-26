// The typed request/response contract between the UI and the local Git backend.
// Every UI call is `callGit("<action>", params)`; the backend validates params at runtime.

import type { DiffFile } from "./diff/parse";
import type {
  ApiErrorPayload,
  ApplyPreview,
  BranchComparison,
  BranchInfo,
  CommitDetails,
  CommitSummary,
  ConflictContent,
  ConflictFile,
  DiagnosticReport,
  FileChange,
  MergeAnatomy,
  MergeHistoryPage,
  MergePreview,
  MergeStrategy,
  OperationLogEntry,
  OperationResult,
  RebasePreview,
  ReflogEntry,
  RefInfo,
  RemoteInfo,
  RepositoryEntry,
  RepositoryInfo,
  RevisionComparison,
  StashEntry,
  SyncStatus,
  TagInfo,
  WorkingTreeStatus,
  InProgressKind,
} from "./types";

export type DiffTarget =
  | { kind: "unstaged" | "staged" | "untracked"; path: string; oldPath?: string }
  | { kind: "commit"; hash: string; path: string; oldPath?: string }
  | { kind: "range"; base: string; head: string; path: string; oldPath?: string; fromMergeBase?: boolean }
  | { kind: "stash"; ref: string; path: string };

export interface FileDiffResult {
  files: DiffFile[];
  truncated: boolean;
}

type Action<Params, Result> = { params: Params; result: Result };
type NoParams = Record<string, never>;

export type ActionMap = {
  // Repository registry (no repository selected)
  "repos.list": Action<NoParams, RepositoryEntry[]>;
  "repos.add": Action<{ path: string }, RepositoryEntry>;
  "repos.remove": Action<{ id: string }, null>;
  "repos.open": Action<{ id: string }, RepositoryEntry>;
  "repos.pickFolder": Action<NoParams, { path: string | null }>;

  // Repository state
  "repo.info": Action<NoParams, RepositoryInfo>;
  "repo.status": Action<NoParams, WorkingTreeStatus>;
  "repo.diagnostics": Action<NoParams, DiagnosticReport>;
  "repo.operations": Action<NoParams, OperationLogEntry[]>;
  "repo.reflog": Action<NoParams, ReflogEntry[]>;

  // Graph and commits
  "graph.refs": Action<NoParams, RefInfo[]>;
  "graph.commits": Action<{ skip: number; limit: number; refs?: string[] }, { commits: CommitSummary[]; hasMore: boolean }>;
  "graph.search": Action<{ query: string }, { commits: CommitSummary[]; refs: RefInfo[] }>;
  "commit.details": Action<{ hash: string }, CommitDetails>;
  "diff.file": Action<DiffTarget, FileDiffResult>;

  // Branches and comparison
  "branches.list": Action<{ target?: string }, BranchInfo[]>;
  "branches.unique": Action<{ branch: string; target: string }, CommitSummary[]>;
  "branches.create": Action<{ name: string; startPoint?: string; checkout?: boolean }, OperationResult>;
  "branches.checkout": Action<{ name: string; detached?: boolean }, OperationResult>;
  "branches.rename": Action<{ from: string; to: string }, OperationResult>;
  "branches.delete": Action<{ name: string; force?: boolean }, OperationResult>;
  "branches.deleteRemote": Action<{ remote: string; name: string; confirmName: string }, OperationResult>;
  "branches.setUpstream": Action<{ name: string; upstream: string | null }, OperationResult>;
  "compare.branches": Action<{ source: string; target: string }, BranchComparison>;
  "compare.revisions": Action<{ base: string; head: string }, RevisionComparison>;

  // Merge
  "merge.history": Action<{ skip?: number; limit?: number; ref?: string; since?: string; until?: string; query?: string; order?: "newest" | "oldest" }, MergeHistoryPage>;
  "merge.anatomy": Action<{ hash: string }, MergeAnatomy>;
  "merge.preview": Action<{ source: string; target: string }, MergePreview>;
  "merge.run": Action<{ source: string; target: string; strategy: MergeStrategy; message?: string }, OperationResult>;

  // Conflicts and paused operations
  "conflicts.list": Action<NoParams, ConflictFile[]>;
  "conflicts.get": Action<{ path: string }, ConflictContent>;
  "conflicts.resolve": Action<{ path: string; content: string }, OperationResult>;
  "conflicts.takeSide": Action<{ path: string; side: "ours" | "theirs" | "delete" }, OperationResult>;
  "conflicts.restore": Action<{ path: string }, OperationResult>;
  "operation.continue": Action<{ kind: InProgressKind }, OperationResult>;
  "operation.skip": Action<{ kind: "rebase" | "cherry-pick" }, OperationResult>;
  "operation.abort": Action<{ kind: InProgressKind }, OperationResult>;

  // History-changing operations
  "rebase.preview": Action<{ onto: string }, RebasePreview>;
  "rebase.run": Action<{ onto: string }, OperationResult>;
  "apply.preview": Action<{ kind: "cherry-pick" | "revert"; hash: string; mainline?: number }, ApplyPreview>;
  "cherryPick.run": Action<{ hash: string; mainline?: number }, OperationResult>;
  "revert.run": Action<{ hash: string; mainline?: number }, OperationResult>;
  "reset.run": Action<{ target: string; mode: "soft" | "mixed" | "hard"; confirmHard?: boolean }, OperationResult>;

  // Source control
  "stage.add": Action<{ paths: string[] }, OperationResult>;
  "stage.addAll": Action<NoParams, OperationResult>;
  "stage.remove": Action<{ paths: string[] }, OperationResult>;
  "stage.removeAll": Action<NoParams, OperationResult>;
  "stage.discard": Action<{ paths: string[]; confirmed: boolean }, OperationResult>;
  "stage.hunk": Action<
    { action: "stage" | "unstage" | "discard"; path: string; hunkIndex: number; hunkHeader: string; confirmed?: boolean },
    OperationResult
  >;
  "commit.create": Action<{ message: string; amend?: boolean }, OperationResult>;

  // Remotes
  "remotes.list": Action<NoParams, RemoteInfo[]>;
  "remotes.add": Action<{ name: string; url: string }, OperationResult>;
  "remotes.remove": Action<{ name: string }, OperationResult>;
  "remotes.setUrl": Action<{ name: string; url: string }, OperationResult>;
  "remotes.fetch": Action<{ remote: string | null; prune?: boolean }, OperationResult>;
  "remotes.sync": Action<{ remote?: string; branch?: string }, SyncStatus>;
  "remotes.pull": Action<{ remote: string; branch: string; mode: "ff-only" | "merge" | "rebase" }, OperationResult>;
  "remotes.push": Action<{ remote: string; branch: string; setUpstream?: boolean; force?: boolean; forceConfirm?: string }, OperationResult>;

  // Stashes
  "stash.list": Action<NoParams, StashEntry[]>;
  "stash.files": Action<{ ref: string }, FileChange[]>;
  "stash.create": Action<{ message?: string; includeUntracked?: boolean }, OperationResult>;
  "stash.apply": Action<{ ref: string }, OperationResult>;
  "stash.pop": Action<{ ref: string }, OperationResult>;
  "stash.drop": Action<{ ref: string }, OperationResult>;

  // Tags
  "tags.list": Action<NoParams, TagInfo[]>;
  "tags.message": Action<{ name: string }, string>;
  "tags.create": Action<{ name: string; revision?: string; message?: string }, OperationResult>;
  "tags.delete": Action<{ name: string }, OperationResult>;
  "tags.push": Action<{ remote: string; name: string }, OperationResult>;
  "tags.deleteRemote": Action<{ remote: string; name: string; confirmName: string }, OperationResult>;
  "tags.checkout": Action<{ name: string }, OperationResult>;
};

export type ActionName = keyof ActionMap;

/** Actions that do not operate on a selected repository. */
export const REGISTRY_ACTIONS = ["repos.list", "repos.add", "repos.remove", "repos.open", "repos.pickFolder"] as const;

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiErrorPayload };
