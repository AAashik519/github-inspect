"use client";

import { shortHash } from "@/lib/format";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

interface CreateBranchDialogProps {
  /** Branch, tag or commit hash the new branch starts from. Defaults to the current HEAD. */
  startPoint?: string;
  onClose: () => void;
}

export function CreateBranchDialog({ startPoint, onClose }: CreateBranchDialogProps) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name")).trim();
    const start = String(form.get("startPoint")).trim();
    const result = await runOperation(`Create branch ${name}`, () => call("branches.create", { name, startPoint: start || undefined, checkout: form.get("checkout") === "on" }));
    if (result) onClose();
  }

  return (
    <Dialog title="Create branch" description="The new branch points at the start point. Nothing else changes unless you choose to switch to it." onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Branch name</span>
          <input name="name" required autoFocus placeholder="feature/my-change" spellCheck={false} />
        </label>
        <label className="field">
          <span>Start point (branch, tag or commit; empty = current HEAD)</span>
          <input name="startPoint" defaultValue={startPoint ?? ""} placeholder="HEAD" spellCheck={false} title={startPoint ? shortHash(startPoint) : undefined} />
        </label>
        <label className="field-inline">
          <input type="checkbox" name="checkout" defaultChecked />
          <span>Switch to the new branch after creating it</span>
        </label>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Create branch
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
