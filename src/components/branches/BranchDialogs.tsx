"use client";

import { useState } from "react";
import { plural } from "@/lib/format";
import type { BranchInfo } from "@/lib/types";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { CommitList } from "@/components/shared/CommitList";

export function RenameBranchDialog({ branch, onClose }: { branch: BranchInfo; onClose: () => void }) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const to = String(new FormData(event.currentTarget).get("name")).trim();
    const result = await runOperation(`Rename ${branch.name} to ${to}`, () => call("branches.rename", { from: branch.name, to }));
    if (result) onClose();
  }

  return (
    <Dialog title={`Rename ${branch.name}`} description="Only the local branch name changes. A remote branch with the old name is not renamed." onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>New name</span>
          <input name="name" defaultValue={branch.name} required autoFocus spellCheck={false} />
        </label>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Rename
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Deleting a branch that has commits no other branch contains needs an explicit "force" acknowledgement. */
export function DeleteBranchDialog({ branch, onClose }: { branch: BranchInfo; onClose: () => void }) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();
  const unique = useGitQuery("branches.unique", { branch: branch.name, target: "HEAD" });
  const [isForceAcknowledged, setIsForceAcknowledged] = useState(false);

  if (!unique.data) {
    return (
      <Dialog title={`Delete ${branch.name}`} onClose={onClose}>
        <LoadingBlock label="Checking for unmerged commits…" />
      </Dialog>
    );
  }
  const unmergedCount = unique.data.length;

  return (
    <ConfirmDialog
      title={`Delete local branch ${branch.name}?`}
      description={`Removes the branch pointer (it pointed at ${branch.hash.slice(0, 8)}). Commits are only lost if no other branch or tag reaches them.`}
      confirmLabel={unmergedCount > 0 ? "Force delete" : "Delete branch"}
      isDangerous
      isConfirmDisabled={unmergedCount > 0 && !isForceAcknowledged}
      onCancel={onClose}
      onConfirm={async () => {
        const result = await runOperation(`Delete branch ${branch.name}`, () => call("branches.delete", { name: branch.name, force: unmergedCount > 0 }));
        if (result) onClose();
      }}
    >
      {unmergedCount > 0 ? (
        <>
          <Notice tone="danger">
            {plural(unmergedCount, "commit")} on this branch {unmergedCount === 1 ? "is" : "are"} not in the current branch. Deleting it makes {unmergedCount === 1 ? "it" : "them"} hard to find (recoverable through the reflog).
          </Notice>
          <div style={{ maxHeight: 160, overflow: "auto" }}>
            <CommitList commits={unique.data.slice(0, 20)} />
          </div>
          <label className="field-inline">
            <input type="checkbox" checked={isForceAcknowledged} onChange={(event) => setIsForceAcknowledged(event.target.checked)} />
            <span>I understand these commits will no longer be on any branch</span>
          </label>
        </>
      ) : (
        <Notice tone="success">All commits of this branch are already in the current branch.</Notice>
      )}
    </ConfirmDialog>
  );
}

export function DeleteRemoteBranchDialog({ branch, onClose }: { branch: BranchInfo; onClose: () => void }) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();
  const slash = branch.name.indexOf("/");
  const remote = branch.name.slice(0, slash);
  const name = branch.name.slice(slash + 1);

  return (
    <ConfirmDialog
      title={`Delete ${branch.name} from the remote?`}
      description={
        <>
          This runs <code>git push {remote} --delete {name}</code> and removes the branch on the <strong>server</strong> for everyone. Local branches are not affected.
        </>
      }
      confirmLabel="Delete remote branch"
      isDangerous
      requiredText={name}
      onCancel={onClose}
      onConfirm={async () => {
        const result = await runOperation(`Delete remote branch ${branch.name}`, () => call("branches.deleteRemote", { remote, name, confirmName: name }));
        if (result) onClose();
      }}
    />
  );
}

export function SetUpstreamDialog({ branch, remoteBranches, onClose }: { branch: BranchInfo; remoteBranches: string[]; onClose: () => void }) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const choice = String(new FormData(event.currentTarget).get("upstream"));
    const upstream = choice === "" ? null : choice;
    const result = await runOperation(upstream ? `Set upstream of ${branch.name}` : `Unset upstream of ${branch.name}`, () => call("branches.setUpstream", { name: branch.name, upstream }));
    if (result) onClose();
  }

  return (
    <Dialog title={`Upstream of ${branch.name}`} description="The upstream decides what pull compares with and what the ahead/behind counters mean." onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Tracks</span>
          <select name="upstream" defaultValue={branch.upstream ?? ""}>
            <option value="">(no upstream)</option>
            {remoteBranches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {remoteBranches.length === 0 && <p className="field-hint">No remote branches are known. Fetch a remote first.</p>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
