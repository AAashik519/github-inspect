"use client";

import { useState } from "react";
import { plural } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { AddRemoteDialog, EditRemoteUrlDialog } from "./RemoteDialogs";
import { SyncPanel } from "./SyncPanel";

type Dialog = { kind: "add" } | { kind: "edit" | "remove"; name: string };

export function RemotesView() {
  const { runOperation, runningOperation } = useWorkspace();
  const call = useRepoCall();
  const remotes = useGitQuery("remotes.list", {});
  const status = useGitQuery("repo.status", {});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [shouldPrune, setShouldPrune] = useState(false);
  const isBusy = runningOperation !== null;

  const fetchRemote = (remote: string | null) => void runOperation(remote ? `Fetch ${remote}` : "Fetch all remotes", () => call("remotes.fetch", { remote, prune: shouldPrune }));

  return (
    <div className="view">
      <div className="view-header">
        <h2>Remotes and synchronization</h2>
        <label className="toolbar" title="Also delete remote-tracking branches that no longer exist on the server">
          <input type="checkbox" checked={shouldPrune} onChange={(event) => setShouldPrune(event.target.checked)} />
          <span>Prune deleted branches</span>
        </label>
        <Button disabled={isBusy || !remotes.data?.length} onClick={() => fetchRemote(null)}>Fetch all remotes</Button>
        <Button variant="primary" onClick={() => setDialog({ kind: "add" })}>Add remote…</Button>
      </div>
      <div className="view-scroll">
        {remotes.error && <ErrorNotice error={remotes.error} onRetry={remotes.reload} />}
        {!remotes.data && !remotes.error && <LoadingBlock label="Reading remotes…" />}
        {remotes.data?.length === 0 && <EmptyState title="No remotes configured">Add a remote to fetch, pull and push. This repository currently exists only on this computer.</EmptyState>}

        {remotes.data && remotes.data.length > 0 && status.data && <SyncPanel remotes={remotes.data} status={status.data} />}

        {remotes.data?.map((remote) => (
          <div className="card" key={remote.name}>
            <div className="card-header">
              {remote.name}
              <span className="spacer row-actions">
                <Button size="small" disabled={isBusy} onClick={() => fetchRemote(remote.name)}>Fetch</Button>
                <Button size="small" onClick={() => setDialog({ kind: "edit", name: remote.name })}>Edit URL…</Button>
                <Button size="small" variant="danger" onClick={() => setDialog({ kind: "remove", name: remote.name })}>Remove…</Button>
              </span>
            </div>
            <div className="card-body">
              <div>Fetch URL: <code>{remote.fetchUrl}</code></div>
              {remote.pushUrl !== remote.fetchUrl && <div>Push URL: <code>{remote.pushUrl}</code></div>}
              <div className="muted">{plural(remote.branches.length, "remote-tracking branch", "remote-tracking branches")} known locally</div>
            </div>
          </div>
        ))}
      </div>

      {dialog?.kind === "add" && <AddRemoteDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <EditRemoteUrlDialog name={dialog.name} onClose={() => setDialog(null)} />}
      {dialog?.kind === "remove" && (
        <ConfirmDialog
          title={`Remove remote ${dialog.name}?`}
          description="Removes the remote and its remote-tracking branches from this repository. Nothing on the server is changed, and local branches are kept (their upstream setting is cleared)."
          confirmLabel="Remove remote"
          isDangerous
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const result = await runOperation(`Remove remote ${dialog.name}`, () => call("remotes.remove", { name: dialog.name }));
            if (result) setDialog(null);
          }}
        />
      )}
    </div>
  );
}
