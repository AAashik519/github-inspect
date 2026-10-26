"use client";

import { useState } from "react";
import type { StashEntry } from "@/lib/types";
import { plural, relativeTime, shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { DiffViewer } from "@/components/shared/DiffViewer";
import { FileChangeList } from "@/components/shared/FileChangeList";

export function StashManager() {
  const { runOperation, runningOperation } = useWorkspace();
  const call = useRepoCall();
  const stashes = useGitQuery("stash.list", {});
  const status = useGitQuery("repo.status", {});
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<StashEntry | null>(null);

  const selected = stashes.data?.find((entry) => entry.ref === selectedRef) ?? null;
  const files = useGitQuery("stash.files", selected ? { ref: selected.ref } : null);
  const isBusy = runningOperation !== null;
  const dirtyCount = status.data?.files.filter((file) => !file.isUntracked).length ?? 0;
  const untrackedCount = status.data?.files.filter((file) => file.isUntracked).length ?? 0;

  async function createStash(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const message = String(data.get("message")).trim();
    const result = await runOperation("Create stash", () => call("stash.create", { message: message || undefined, includeUntracked: data.get("includeUntracked") === "on" }));
    if (result) form.reset();
  }

  return (
    <div className="view">
      <div className="view-header">
        <h2>Stashes</h2>
        <span className="muted">Shelve uncommitted work temporarily and bring it back later.</span>
      </div>
      <div className="view-split">
        <div>
          <form className="card-body" onSubmit={createStash} style={{ borderBottom: "1px solid var(--border)" }}>
            <input name="message" placeholder="Stash message (optional)" aria-label="Stash message" />
            <label className="field-inline" style={{ margin: 0 }}>
              <input type="checkbox" name="includeUntracked" />
              <span>Include untracked files{untrackedCount > 0 ? ` (${untrackedCount})` : ""}</span>
            </label>
            <div>
              <Button type="submit" variant="primary" disabled={isBusy || (status.data !== undefined && status.data.files.length === 0)}>Stash changes</Button>
              <span className="muted"> {status.data && status.data.files.length === 0 ? "No local changes." : `${plural(dirtyCount, "tracked change")}`}</span>
            </div>
          </form>
          {stashes.error && <ErrorNotice error={stashes.error} onRetry={stashes.reload} />}
          {!stashes.data && !stashes.error && <LoadingBlock label="Reading stashes…" />}
          {stashes.data?.length === 0 && <EmptyState title="No stashes" />}
          <ul className="list">
            {stashes.data?.map((entry) => (
              <li key={entry.ref}>
                <button type="button" className={`list-item ${selectedRef === entry.ref ? "is-selected" : ""}`} onClick={() => setSelectedRef(entry.ref)}>
                  <span className="list-item-main">
                    <span className="truncate">{entry.message}</span>
                    <span className="muted"><code>{entry.ref}</code> · {entry.branch ?? "unknown branch"} · {relativeTime(entry.date)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          {!selected && <EmptyState title="Select a stash">See what it contains and apply, pop or delete it.</EmptyState>}
          {selected && (
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <h3>{selected.message}</h3>
                <span className="muted"><code>{selected.ref}</code> · <code>{shortHash(selected.hash)}</code> · created on {selected.branch ?? "unknown branch"}</span>
              </div>
              {dirtyCount > 0 && <Notice tone="warning">Your working tree has {plural(dirtyCount, "uncommitted change")}. Applying a stash that touches the same files can conflict or be refused.</Notice>}
              <div className="row-actions">
                <Button disabled={isBusy} onClick={() => void runOperation(`Apply ${selected.ref}`, () => call("stash.apply", { ref: selected.ref }))} title="Restore the changes and keep the stash">Apply (keep stash)</Button>
                <Button variant="primary" disabled={isBusy} onClick={() => void runOperation(`Pop ${selected.ref}`, () => call("stash.pop", { ref: selected.ref }))} title="Restore the changes and delete the stash if it applied cleanly">Pop (apply and delete)</Button>
                <Button variant="danger" disabled={isBusy} onClick={() => setPendingDrop(selected)}>Delete…</Button>
              </div>
              {files.error && <ErrorNotice error={files.error} onRetry={files.reload} />}
              {!files.data && !files.error && <LoadingBlock label="Reading stash contents…" />}
              {files.data && (
                <div className="card">
                  <div className="card-header">{plural(files.data.length, "file")} in this stash</div>
                  <FileChangeList files={files.data} renderDiff={(file) => <DiffViewer target={{ kind: "stash", ref: selected.ref, path: file.path }} />} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {pendingDrop && (
        <ConfirmDialog
          title={`Delete ${pendingDrop.ref}?`}
          description={`“${pendingDrop.message}” will be removed. Right after deleting you can still recover it with: git stash apply ${pendingDrop.hash}`}
          confirmLabel="Delete stash"
          isDangerous
          onCancel={() => setPendingDrop(null)}
          onConfirm={async () => {
            const result = await runOperation(`Drop ${pendingDrop.ref}`, () => call("stash.drop", { ref: pendingDrop.ref }));
            if (result) {
              setPendingDrop(null);
              setSelectedRef(null);
            }
          }}
        />
      )}
    </div>
  );
}
