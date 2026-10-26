"use client";

import { useState } from "react";
import type { InProgressOperation } from "@/lib/types";
import { plural } from "@/lib/format";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

const EXPLANATION: Record<InProgressOperation["kind"], string> = {
  merge: "Git stopped in the middle of a merge. Resolve the conflicted files, then continue to create the merge commit.",
  rebase: "Git paused a rebase. Your commits are being replayed one by one onto the new base (history is rewritten). Resolve the conflicts, then continue.",
  "cherry-pick": "Git paused a cherry-pick. Resolve the conflicts, then continue to create the commit.",
  revert: "Git paused a revert. Resolve the conflicts, then continue to create the revert commit.",
};

const ABORT_EFFECT: Record<InProgressOperation["kind"], string> = {
  merge: "Aborting discards the merge attempt and every conflict resolution you made so far. Your branch returns to its state before the merge.",
  rebase: "Aborting discards the rebase and your conflict resolutions, and returns the branch to its original commits.",
  "cherry-pick": "Aborting discards the cherry-pick and your conflict resolutions.",
  revert: "Aborting discards the revert and your conflict resolutions.",
};

export function InProgressBanner({ operation, conflictCount }: { operation: InProgressOperation; conflictCount: number }) {
  const { runOperation, runningOperation } = useWorkspace();
  const call = useRepoCall();
  const [isConfirmingAbort, setIsConfirmingAbort] = useState(false);
  const canSkip = operation.kind === "rebase" || operation.kind === "cherry-pick";

  return (
    <div style={{ padding: 10 }}>
      <Notice tone="warning">
        <strong>
          {operation.kind[0].toUpperCase() + operation.kind.slice(1)} in progress
          {operation.step ? ` — step ${operation.step.current} of ${operation.step.total}` : ""}
          {operation.detail ? ` (${operation.detail})` : ""}
        </strong>
        <span>{EXPLANATION[operation.kind]}</span>
        <span>
          {conflictCount > 0 ? <strong>{plural(conflictCount, "file")} still conflicted.</strong> : <strong>All conflicts resolved — you can continue.</strong>}
        </span>
        <div className="row-actions">
          <Button variant="primary" size="small" disabled={conflictCount > 0 || runningOperation !== null} onClick={() => void runOperation(`Continue ${operation.kind}`, () => call("operation.continue", { kind: operation.kind }))}>
            Continue {operation.kind}
          </Button>
          {canSkip && (
            <Button size="small" disabled={runningOperation !== null} onClick={() => void runOperation(`Skip commit of ${operation.kind}`, () => call("operation.skip", { kind: operation.kind as "rebase" | "cherry-pick" }))} title="Drop the commit that is currently being applied">
              Skip this commit
            </Button>
          )}
          <Button variant="danger" size="small" onClick={() => setIsConfirmingAbort(true)}>
            Abort {operation.kind}
          </Button>
        </div>
      </Notice>
      {isConfirmingAbort && (
        <ConfirmDialog
          title={`Abort the ${operation.kind}?`}
          description={ABORT_EFFECT[operation.kind]}
          confirmLabel={`Abort ${operation.kind}`}
          isDangerous
          onCancel={() => setIsConfirmingAbort(false)}
          onConfirm={async () => {
            const result = await runOperation(`Abort ${operation.kind}`, () => call("operation.abort", { kind: operation.kind }));
            if (result) setIsConfirmingAbort(false);
          }}
        />
      )}
    </div>
  );
}
