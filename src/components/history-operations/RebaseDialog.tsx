"use client";

import { plural } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { CommitList } from "@/components/shared/CommitList";

/** Rebases the checked-out branch onto `onto` after showing exactly what will be replayed. */
export function RebaseDialog({ onto, onClose }: { onto: string; onClose: () => void }) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();
  const { data: preview, error, reload } = useGitQuery("rebase.preview", { onto });

  async function run() {
    const result = await runOperation(`Rebase onto ${onto}`, () => call("rebase.run", { onto }));
    if (result) onClose();
  }

  return (
    <Dialog
      title={preview ? `Rebase ${preview.branch} onto ${onto}` : `Rebase onto ${onto}`}
      description="Replays the commits of the current branch on top of the target. This rewrites history: the replayed commits get new hashes."
      onClose={onClose}
      wide
    >
      {error && <ErrorNotice error={error} onRetry={reload} />}
      {!preview && !error && <LoadingBlock label="Calculating…" />}
      {preview && (
        <>
          <Notice tone="info">
            <strong>{preview.branch}</strong> will be moved on top of <strong>{onto}</strong>. The target branch itself is not changed.
          </Notice>
          {preview.alreadyBased && <Notice tone="success">{preview.branch} already contains everything in {onto}; there is nothing to rebase.</Notice>}
          {preview.publishedCount > 0 && (
            <Notice tone="warning">
              {plural(preview.publishedCount, "of these commits")} already exist on <code>{preview.upstream}</code>. After rebasing, pushing {preview.branch} will require a force push, which affects anyone who uses that branch.
            </Notice>
          )}
          {preview.mergeCommitCount > 0 && <Notice tone="warning">{plural(preview.mergeCommitCount, "merge commit")} will be flattened by the rebase.</Notice>}
          {preview.dirtyFileCount > 0 && <Notice tone="danger">You have {preview.dirtyFileCount} file(s) with uncommitted changes. Commit or stash them first.</Notice>}
          <h3 style={{ marginTop: 10 }}>{plural(preview.commitsToReplayTotal, "commit")} will be replayed</h3>
          <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
            <CommitList commits={preview.commitsToReplay} emptyText="Nothing to replay." />
          </div>
        </>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!preview || preview.alreadyBased || preview.dirtyFileCount > 0} onClick={run}>
          Rebase {preview?.branch ?? ""} onto {onto}
        </Button>
      </div>
    </Dialog>
  );
}
