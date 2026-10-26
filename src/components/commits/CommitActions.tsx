"use client";

import { useState } from "react";
import { shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CreateBranchDialog } from "@/components/branches/CreateBranchDialog";
import { ApplyCommitDialog } from "@/components/history-operations/ApplyCommitDialog";
import { ResetDialog } from "@/components/history-operations/ResetDialog";
import { CreateTagDialog } from "@/components/tags/CreateTagDialog";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

type Dialog = "branch" | "tag" | "checkout" | "cherry-pick" | "revert" | "reset";

/** Operations that start from a commit. Each one opens a dialog that explains it before anything runs. */
export function CommitActions({ hash }: { hash: string }) {
  const { runOperation, select } = useWorkspace();
  const call = useRepoCall();
  const headHash = useGitQuery("repo.status", {}).data?.head.hash;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  return (
    <>
      <div className="row-actions">
        <Button size="small" onClick={() => setDialog("branch")}>New branch here</Button>
        <Button size="small" onClick={() => setDialog("tag")}>Tag</Button>
        <Button size="small" onClick={() => setDialog("checkout")}>Checkout (detached)</Button>
        <Button size="small" onClick={() => setDialog("cherry-pick")}>Cherry-pick…</Button>
        <Button size="small" onClick={() => setDialog("revert")}>Revert…</Button>
        <Button size="small" onClick={() => setDialog("reset")}>Reset branch here…</Button>
        <Button size="small" disabled={!headHash || headHash === hash} onClick={() => headHash && select({ kind: "compare", base: hash, head: headHash })} title="Compare this commit with the current HEAD">Compare with HEAD</Button>
      </div>
      {dialog === "branch" && <CreateBranchDialog startPoint={hash} onClose={close} />}
      {dialog === "tag" && <CreateTagDialog revision={hash} onClose={close} />}
      {dialog === "cherry-pick" && <ApplyCommitDialog kind="cherry-pick" hash={hash} onClose={close} />}
      {dialog === "revert" && <ApplyCommitDialog kind="revert" hash={hash} onClose={close} />}
      {dialog === "reset" && <ResetDialog hash={hash} onClose={close} />}
      {dialog === "checkout" && (
        <ConfirmDialog
          title={`Check out ${shortHash(hash)} (detached HEAD)?`}
          description="HEAD will point at this commit instead of a branch. Commits you make there belong to no branch and can be lost unless you create a branch for them."
          confirmLabel="Check out detached"
          onCancel={close}
          onConfirm={async () => {
            const result = await runOperation(`Checkout ${shortHash(hash)} (detached HEAD)`, () => call("branches.checkout", { name: hash, detached: true }));
            if (result) close();
          }}
        />
      )}
    </>
  );
}
