"use client";

import { useState } from "react";
import type { TagInfo } from "@/lib/types";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

interface TagRemoteDialogProps {
  tag: TagInfo;
  mode: "push" | "delete";
  onClose: () => void;
}

/** Push a tag to a remote, or delete it from one (the latter needs the tag name typed out). */
export function TagRemoteDialog({ tag, mode, onClose }: TagRemoteDialogProps) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();
  const remotes = useGitQuery("remotes.list", {});
  const [remote, setRemote] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");

  const activeRemote = remote ?? remotes.data?.[0]?.name ?? "";
  const canRun = activeRemote !== "" && (mode === "push" || typedName === tag.name);

  async function run() {
    const result =
      mode === "push"
        ? await runOperation(`Push tag ${tag.name} to ${activeRemote}`, () => call("tags.push", { remote: activeRemote, name: tag.name }))
        : await runOperation(`Delete tag ${tag.name} from ${activeRemote}`, () => call("tags.deleteRemote", { remote: activeRemote, name: tag.name, confirmName: typedName }));
    if (result) onClose();
  }

  return (
    <Dialog
      title={mode === "push" ? `Push tag ${tag.name}` : `Delete tag ${tag.name} from a remote`}
      description={mode === "push" ? "Publishes this tag to the chosen remote. Creating a tag never does this automatically." : "Removes the tag on the server for everyone. The local tag is kept."}
      onClose={onClose}
    >
      {remotes.data?.length === 0 && <Notice tone="warning">No remotes are configured.</Notice>}
      <label className="field">
        <span>Remote</span>
        <select value={activeRemote} onChange={(event) => setRemote(event.target.value)}>
          {remotes.data?.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
        </select>
      </label>
      {mode === "delete" && (
        <>
          <Notice tone="danger">Other people who fetched this tag keep their copy, but it disappears from the server.</Notice>
          <label className="field">
            <span>Type <code>{tag.name}</code> to confirm</span>
            <input value={typedName} onChange={(event) => setTypedName(event.target.value)} autoComplete="off" />
          </label>
        </>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={mode === "delete" ? "danger" : "primary"} disabled={!canRun} onClick={run}>
          {mode === "push" ? `Push to ${activeRemote || "…"}` : "Delete from remote"}
        </Button>
      </div>
    </Dialog>
  );
}
