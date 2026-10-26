"use client";

import { useState } from "react";
import { shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { DiffViewer } from "@/components/shared/DiffViewer";
import { FileChangeList } from "@/components/shared/FileChangeList";

type Kind = "cherry-pick" | "revert";

const COPY: Record<Kind, { title: string; verb: string; explain: string }> = {
  "cherry-pick": {
    title: "Cherry-pick commit",
    verb: "Cherry-pick",
    explain: "Copies the changes of this commit onto the current branch as a new commit. The original commit stays where it is.",
  },
  revert: {
    title: "Revert commit",
    verb: "Revert",
    explain: "Creates a new commit that undoes the changes of this commit. History is not rewritten.",
  },
};

/** Previews a cherry-pick or revert (changes and predicted conflicts), then runs it on explicit confirmation. */
export function ApplyCommitDialog({ kind, hash, onClose }: { kind: Kind; hash: string; onClose: () => void }) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();
  const [mainline, setMainline] = useState<number | undefined>(undefined);
  const status = useGitQuery("repo.status", {});
  const details = useGitQuery("commit.details", { hash });
  const preview = useGitQuery("apply.preview", { kind, hash, mainline });
  const copy = COPY[kind];

  const currentBranch = status.data?.head.branch;
  const needsMainline = Boolean(preview.data?.isMerge) && mainline === undefined;
  const canRun = Boolean(preview.data) && !needsMainline && Boolean(status.data?.head.hash);

  async function run() {
    const result = await runOperation(`${copy.verb} ${shortHash(hash)}`, () => call(kind === "revert" ? "revert.run" : "cherryPick.run", { hash, mainline }));
    if (result) onClose();
  }

  return (
    <Dialog title={`${copy.title} ${shortHash(hash)}`} description={copy.explain} onClose={onClose} wide>
      {preview.error && <ErrorNotice error={preview.error} onRetry={preview.reload} />}
      {!preview.data && !preview.error && <LoadingBlock label="Checking what would happen…" />}
      {preview.data && (
        <>
          <p>
            <strong>{preview.data.subject}</strong>
          </p>
          <Notice tone="info">
            Target: <strong>{currentBranch ?? "detached HEAD"}</strong> (the current branch receives the new commit).
          </Notice>
          {preview.data.isMerge && (
            <label className="field">
              <span>This is a merge commit with {preview.data.parentCount} parents. Choose the mainline parent (the side to keep):</span>
              <select value={mainline ?? ""} onChange={(event) => setMainline(event.target.value ? Number(event.target.value) : undefined)}>
                <option value="">— select —</option>
                {Array.from({ length: preview.data.parentCount }, (_, index) => (
                  <option key={index} value={index + 1}>
                    Parent {index + 1}
                    {details.data?.parentSummaries[index] ? ` — ${details.data.parentSummaries[index].subject}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {preview.data.dirtyFileCount > 0 && <Notice tone="warning">You have {preview.data.dirtyFileCount} file(s) with uncommitted changes. Commit or stash them first; this operation will be refused otherwise.</Notice>}
          {!needsMainline && !preview.data.conflicts.supported && <Notice>Conflict prediction is unavailable (requires Git 2.38+). Conflicts, if any, will be shown after the operation starts.</Notice>}
          {preview.data.conflicts.hasConflicts && (
            <Notice tone="warning">
              Expected conflicts in: {preview.data.conflicts.files.join(", ")}. The operation will pause and let you resolve them or abort.
            </Notice>
          )}
          {preview.data.conflicts.supported && !preview.data.conflicts.hasConflicts && !needsMainline && <Notice tone="success">No conflicts expected.</Notice>}
        </>
      )}
      <h3 style={{ marginTop: 12 }}>Changes in this commit</h3>
      {details.data && (
        <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
          <FileChangeList files={details.data.files} renderDiff={(file) => <DiffViewer target={{ kind: "commit", hash, path: file.path, oldPath: file.oldPath }} />} />
        </div>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!canRun} onClick={run}>
          {copy.verb} onto {currentBranch ?? "HEAD"}
        </Button>
      </div>
    </Dialog>
  );
}
