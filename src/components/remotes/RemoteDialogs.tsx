"use client";

import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

export function AddRemoteDialog({ onClose }: { onClose: () => void }) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name")).trim();
    const url = String(form.get("url")).trim();
    const result = await runOperation(`Add remote ${name}`, () => call("remotes.add", { name, url }));
    if (result) onClose();
  }

  return (
    <Dialog title="Add remote" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input name="name" required autoFocus defaultValue="origin" spellCheck={false} />
        </label>
        <label className="field">
          <span>URL</span>
          <input name="url" required placeholder="https://github.com/owner/repo.git or git@host:owner/repo.git" spellCheck={false} />
        </label>
        <div style={{ marginTop: 10 }}>
          <Notice>Authentication uses your existing Git setup (credential helper or SSH agent). Do not paste access tokens into the URL — they would be stored in plain text in .git/config.</Notice>
        </div>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Add remote</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function EditRemoteUrlDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get("url")).trim();
    const result = await runOperation(`Change URL of ${name}`, () => call("remotes.setUrl", { name, url }));
    if (result) onClose();
  }

  return (
    <Dialog title={`Change URL of ${name}`} description="Enter the complete new URL. Existing credentials in the old URL are never displayed." onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>New URL</span>
          <input name="url" required autoFocus spellCheck={false} />
        </label>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save URL</Button>
        </div>
      </form>
    </Dialog>
  );
}
