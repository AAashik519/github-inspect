"use client";

import { useState } from "react";
import type { DiffHunk } from "@/lib/diff/parse";
import type { StatusFile } from "@/lib/types";
import { shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, EmptyState, ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { DiffViewer } from "@/components/shared/DiffViewer";
import { ChangeGroup, summarizeLetters, type ChangeEntry } from "./ChangeGroup";
import { CommitBox } from "./CommitBox";
import { ConflictResolver } from "./ConflictResolver";
import { InProgressBanner } from "./InProgressBanner";

type GroupKind = "conflicted" | "staged" | "unstaged" | "untracked";
interface SelectedFile {
  group: GroupKind;
  file: StatusFile;
}

const pathsOf = (entries: ChangeEntry[]) => entries.flatMap((entry) => (entry.file.originalPath ? [entry.file.path, entry.file.originalPath] : [entry.file.path]));

export function SourceControl() {
  const { runOperation, runningOperation } = useWorkspace();
  const call = useRepoCall();
  const { data: status, error, reload } = useGitQuery("repo.status", {});
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<StatusFile | null>(null);

  if (error) return <div className="view-scroll"><ErrorNotice error={error} onRetry={reload} /></div>;
  if (!status) return <LoadingBlock label="Reading working tree…" />;

  const regular = status.files.filter((file) => !file.isConflicted && !file.isUntracked);
  const conflicted: ChangeEntry[] = status.files.filter((file) => file.isConflicted).map((file) => ({ file, letter: "U" }));
  const staged: ChangeEntry[] = regular.filter((file) => file.index !== " ").map((file) => ({ file, letter: file.index }));
  const unstaged: ChangeEntry[] = regular.filter((file) => file.worktree !== " ").map((file) => ({ file, letter: file.worktree }));
  const untracked: ChangeEntry[] = status.files.filter((file) => file.isUntracked).map((file) => ({ file, letter: "?" }));
  const isBusy = runningOperation !== null;
  const hasChanges = status.files.length > 0;

  const blockedReason = status.inProgress
    ? `A ${status.inProgress.kind} is in progress. Use “Continue” above to finish it; manual commits are blocked.`
    : conflicted.length > 0
      ? "Resolve all conflicted files before committing."
      : null;

  const stageEntries = (entries: ChangeEntry[]) => void runOperation(`Stage ${entries.length} file(s)`, () => call("stage.add", { paths: pathsOf(entries) }));
  const unstageEntries = (entries: ChangeEntry[]) => void runOperation(`Unstage ${entries.length} file(s)`, () => call("stage.remove", { paths: pathsOf(entries) }));

  function renderHunkActions(group: "staged" | "unstaged", file: StatusFile, hunk: DiffHunk, index: number) {
    const action = group === "staged" ? "unstage" : "stage";
    return (
      <span className="row-actions">
        <Button
          size="small"
          disabled={isBusy}
          onClick={() => void runOperation(`${group === "staged" ? "Unstage" : "Stage"} change in ${file.path}`, () => call("stage.hunk", { action, path: file.path, hunkIndex: index, hunkHeader: hunk.header }))}
        >
          {group === "staged" ? "Unstage this change" : "Stage this change"}
        </Button>
      </span>
    );
  }

  const selectedStillExists = selected && status.files.some((file) => file.path === selected.file.path);
  const active = selectedStillExists ? selected : null;

  return (
    <div className="view">
      <div className="view-header">
        <h2>Source control</h2>
        <span>
          On <strong>{status.head.branch ?? `detached HEAD (${status.head.hash ? shortHash(status.head.hash) : "no commits"})`}</strong>
        </span>
        {status.upstream && !status.upstream.gone && <Badge tone={status.upstream.ahead || status.upstream.behind ? "warning" : "success"}>↑{status.upstream.ahead} ↓{status.upstream.behind} {status.upstream.name}</Badge>}
        {status.head.detached && <Badge tone="warning">detached HEAD</Badge>}
        <Badge tone={hasChanges ? "warning" : "success"}>{hasChanges ? `${status.files.length} changed` : "working tree clean"}</Badge>
        <Button size="small" disabled={isBusy || (unstaged.length === 0 && untracked.length === 0)} onClick={() => void runOperation("Stage all changes", () => call("stage.addAll", {}))}>Stage all</Button>
        <Button size="small" disabled={isBusy || staged.length === 0} onClick={() => void runOperation("Unstage all changes", () => call("stage.removeAll", {}))}>Unstage all</Button>
      </div>

      <div className="view-split" style={{ gridTemplateColumns: "minmax(300px, 400px) 1fr" }}>
        <div>
          {status.inProgress && <InProgressBanner operation={status.inProgress} conflictCount={conflicted.length} />}
          {status.head.detached && <div style={{ padding: "10px 10px 0" }}><Notice tone="warning">HEAD is detached. Commits made here belong to no branch; create a branch to keep them.</Notice></div>}
          <CommitBox
            stagedCount={staged.length}
            canCommit={!blockedReason}
            blockedReason={blockedReason}
            headHash={status.head.hash}
            hasUpstream={Boolean(status.upstream && !status.upstream.gone)}
          />
          {!hasChanges && !status.inProgress && <EmptyState title="Nothing to commit">Your working tree matches the last commit.</EmptyState>}

          <ChangeGroup
            title="Conflicted"
            entries={conflicted}
            selectedPath={active?.group === "conflicted" ? active.file.path : null}
            onSelect={(entry) => setSelected({ group: "conflicted", file: entry.file })}
            renderRowActions={() => null}
          />
          <ChangeGroup
            title="Staged changes"
            summary={summarizeLetters(staged)}
            entries={staged}
            selectedPath={active?.group === "staged" ? active.file.path : null}
            onSelect={(entry) => setSelected({ group: "staged", file: entry.file })}
            headerActions={<Button size="small" disabled={isBusy} onClick={() => unstageEntries(staged)}>Unstage all</Button>}
            renderRowActions={(entry) => <Button size="small" variant="ghost" disabled={isBusy} onClick={() => unstageEntries([entry])} title="Unstage">−</Button>}
          />
          <ChangeGroup
            title="Changes"
            summary={summarizeLetters(unstaged)}
            entries={unstaged}
            selectedPath={active?.group === "unstaged" ? active.file.path : null}
            onSelect={(entry) => setSelected({ group: "unstaged", file: entry.file })}
            headerActions={<Button size="small" disabled={isBusy} onClick={() => stageEntries(unstaged)}>Stage all</Button>}
            renderRowActions={(entry) => (
              <>
                <Button size="small" variant="ghost" disabled={isBusy} onClick={() => setPendingDiscard(entry.file)} title="Discard changes…">↺</Button>
                <Button size="small" variant="ghost" disabled={isBusy} onClick={() => stageEntries([entry])} title="Stage">+</Button>
              </>
            )}
          />
          <ChangeGroup
            title="Untracked"
            entries={untracked}
            selectedPath={active?.group === "untracked" ? active.file.path : null}
            onSelect={(entry) => setSelected({ group: "untracked", file: entry.file })}
            headerActions={<Button size="small" disabled={isBusy} onClick={() => stageEntries(untracked)}>Stage all</Button>}
            renderRowActions={(entry) => (
              <>
                <Button size="small" variant="ghost" disabled={isBusy} onClick={() => setPendingDiscard(entry.file)} title="Delete file…">🗑</Button>
                <Button size="small" variant="ghost" disabled={isBusy} onClick={() => stageEntries([entry])} title="Stage">+</Button>
              </>
            )}
          />
        </div>

        <div>
          {!active && <EmptyState title="Select a file">Choose a file on the left to see its changes{conflicted.length > 0 ? " or to resolve its conflict" : ""}.</EmptyState>}
          {active?.group === "conflicted" && <ConflictResolver key={active.file.path} path={active.file.path} onResolved={() => setSelected(null)} />}
          {active && active.group !== "conflicted" && (
            <div style={{ padding: 12 }}>
              <div className="toolbar" style={{ marginBottom: 8 }}>
                <h3 className="mono" style={{ fontSize: 14 }}>{active.file.path}</h3>
                <Badge>{active.group === "staged" ? "staged diff (index vs last commit)" : active.group === "unstaged" ? "unstaged diff (working tree vs index)" : "new file (untracked)"}</Badge>
              </div>
              <DiffViewer
                key={`${active.group}:${active.file.path}`}
                target={{ kind: active.group, path: active.file.path, oldPath: active.group === "staged" ? active.file.originalPath : undefined }}
                renderHunkActions={
                  active.group === "untracked"
                    ? undefined
                    : (hunk, index) => renderHunkActions(active.group as "staged" | "unstaged", active.file, hunk, index)
                }
              />
            </div>
          )}
        </div>
      </div>

      {pendingDiscard && (
        <ConfirmDialog
          title={pendingDiscard.isUntracked ? `Delete untracked file ${pendingDiscard.path}?` : `Discard changes in ${pendingDiscard.path}?`}
          description={
            pendingDiscard.isUntracked
              ? "This file is not tracked by Git, so deleting it cannot be undone."
              : "All unstaged changes in this file are thrown away and the file returns to its staged (or last committed) content. This cannot be undone. Staged changes are kept."
          }
          confirmLabel={pendingDiscard.isUntracked ? "Delete file" : "Discard changes"}
          isDangerous
          onCancel={() => setPendingDiscard(null)}
          onConfirm={async () => {
            const result = await runOperation(`Discard ${pendingDiscard.path}`, () => call("stage.discard", { paths: [pendingDiscard.path], confirmed: true }));
            if (result) setPendingDiscard(null);
          }}
        >
          <DiffViewer target={{ kind: pendingDiscard.isUntracked ? "untracked" : "unstaged", path: pendingDiscard.path }} />
        </ConfirmDialog>
      )}
    </div>
  );
}
