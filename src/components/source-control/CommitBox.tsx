"use client";

import { useState } from "react";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

const SUBJECT_SOFT_LIMIT = 72;

interface CommitBoxProps {
  stagedCount: number;
  canCommit: boolean;
  /** Why committing is blocked (merge in progress, conflicts ...). */
  blockedReason: string | null;
  headHash: string | null;
  hasUpstream: boolean;
}

export function CommitBox({ stagedCount, canCommit, blockedReason, headHash, hasUpstream }: CommitBoxProps) {
  const { runOperation, runningOperation } = useWorkspace();
  const call = useRepoCall();
  const [message, setMessage] = useState("");
  const [isAmending, setIsAmending] = useState(false);

  const trimmed = message.trim();
  const subjectLength = trimmed.split("\n")[0].length;
  const hasChangesToCommit = isAmending || stagedCount > 0;
  const isDisabled = !canCommit || trimmed === "" || !hasChangesToCommit || runningOperation !== null;

  async function toggleAmend(checked: boolean) {
    setIsAmending(checked);
    if (!checked || !headHash || trimmed !== "") return;
    // Start from the existing message so the user edits it instead of retyping.
    const last = await call("commit.details", { hash: headHash });
    setMessage(last.body ? `${last.subject}\n\n${last.body}` : last.subject);
  }

  async function commit() {
    const result = await runOperation(isAmending ? "Amend last commit" : "Commit", () => call("commit.create", { message: trimmed, amend: isAmending }));
    if (result) {
      setMessage("");
      setIsAmending(false);
    }
  }

  return (
    <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        rows={3}
        placeholder={isAmending ? "Amended commit message" : "Commit message (first line is the summary)"}
        aria-label="Commit message"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !isDisabled) void commit();
        }}
      />
      {subjectLength > SUBJECT_SOFT_LIMIT && <span className="field-hint">The summary line is {subjectLength} characters; {SUBJECT_SOFT_LIMIT} or fewer reads best in history views.</span>}
      <label className="field-inline" style={{ margin: 0 }}>
        <input type="checkbox" checked={isAmending} disabled={!headHash} onChange={(event) => void toggleAmend(event.target.checked)} />
        <span>Amend the last commit</span>
      </label>
      {isAmending && (
        <Notice tone="warning">
          Amending <strong>rewrites</strong> the last commit (new hash). {hasUpstream ? "If it was already pushed, you will need a force push." : ""} Staged changes, if any, are added to it.
        </Notice>
      )}
      {blockedReason && <Notice tone="warning">{blockedReason}</Notice>}
      <div className="toolbar">
        <Button variant="primary" disabled={isDisabled} onClick={commit} title={!hasChangesToCommit ? "Stage changes first" : trimmed === "" ? "Enter a commit message" : undefined}>
          {isAmending ? "Amend commit" : `Commit ${stagedCount > 0 ? `${stagedCount} staged file${stagedCount === 1 ? "" : "s"}` : ""}`}
        </Button>
        {!hasChangesToCommit && <span className="muted">Nothing staged.</span>}
      </div>
    </div>
  );
}
