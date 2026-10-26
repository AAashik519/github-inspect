"use client";

import { useState } from "react";
import { callGit, toErrorPayload } from "@/lib/api-client";
import type { ApiErrorPayload } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorNotice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

export function AddRepositoryDialog({ onClose }: { onClose: () => void }) {
  const { addRepository } = useWorkspace();
  const [path, setPath] = useState("");
  const [error, setError] = useState<ApiErrorPayload | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function browse() {
    setError(null);
    try {
      const { path: picked } = await callGit("repos.pickFolder", {});
      if (picked) setPath(picked);
    } catch (pickError) {
      setError(toErrorPayload(pickError));
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      await addRepository(path);
      onClose();
    } catch (addError) {
      setError(toErrorPayload(addError));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Dialog title="Add a local repository" description="Choose a folder that contains a Git repository. Nothing in it is modified." onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Repository folder</span>
          <div className="toolbar">
            <input
              style={{ flex: 1 }}
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/home/you/projects/my-app"
              autoFocus
              spellCheck={false}
              aria-label="Repository folder path"
            />
            <Button onClick={browse}>Browse…</Button>
          </div>
        </label>
        {error && (
          <div style={{ marginTop: 10 }}>
            <ErrorNotice error={error} />
          </div>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isBusy || path.trim() === ""}>
            {isBusy ? "Checking…" : "Add repository"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
