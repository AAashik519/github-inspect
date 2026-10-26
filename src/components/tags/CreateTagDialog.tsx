"use client";

import { shortHash } from "@/lib/format";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

export function CreateTagDialog({ revision, onClose }: { revision?: string; onClose: () => void }) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name")).trim();
    const message = String(form.get("message")).trim();
    const target = String(form.get("revision")).trim();
    const result = await runOperation(`Create ${message ? "annotated" : "lightweight"} tag ${name}`, () => call("tags.create", { name, revision: target || undefined, message: message || undefined }));
    if (result) onClose();
  }

  return (
    <Dialog title="Create tag" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Tag name</span>
          <input name="name" required autoFocus placeholder="v1.0.0" spellCheck={false} />
        </label>
        <label className="field">
          <span>Commit (branch, tag or hash; empty = current HEAD)</span>
          <input name="revision" defaultValue={revision ?? ""} placeholder="HEAD" spellCheck={false} title={revision ? shortHash(revision) : undefined} />
        </label>
        <label className="field">
          <span>Message (optional — a message makes the tag annotated)</span>
          <textarea name="message" rows={3} />
        </label>
        <div style={{ marginTop: 10 }}>
          <Notice>Creating a tag does not publish it. Push it from the Tags view when you want it on a remote.</Notice>
        </div>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Create tag
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
