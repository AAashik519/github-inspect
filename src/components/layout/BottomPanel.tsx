"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, ErrorNotice, Spinner } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import styles from "./layout.module.css";

/**
 * Operation status. The spinner is indeterminate on purpose: Git does not report a reliable
 * percentage for most operations, so no progress number is invented.
 */
export function BottomPanel() {
  const { runningOperation, lastOutcome, dismissOutcome, setView } = useWorkspace();
  const [isExpanded, setIsExpanded] = useState(false);

  const result = lastOutcome?.result;
  const error = lastOutcome?.error;

  return (
    <footer className={styles.bottomBar} aria-live="polite">
      <div className={styles.bottomSummary}>
        {runningOperation ? (
          <>
            <Spinner label="Running" />
            <span className={styles.message}>Running: <strong>{runningOperation}</strong>… (waiting for Git)</span>
          </>
        ) : lastOutcome ? (
          <>
            <Badge tone={error ? "danger" : result?.outcome === "conflict" ? "warning" : "success"}>{error ? "failed" : result?.outcome === "conflict" ? "conflict" : result?.outcome === "noop" ? "no change" : "done"}</Badge>
            <span className={`${styles.message} truncate`}>
              <strong>{lastOutcome.label}</strong> — {error ? error.message : result?.summary}
            </span>
            <Button size="small" variant="ghost" onClick={() => setIsExpanded((expanded) => !expanded)}>{isExpanded ? "Hide details" : "Details"}</Button>
            <Button size="small" variant="ghost" onClick={() => setView("operations")}>History</Button>
            <Button size="small" variant="ghost" onClick={dismissOutcome} aria-label="Dismiss">✕</Button>
          </>
        ) : (
          <span className="muted">Ready.</span>
        )}
      </div>
      {isExpanded && lastOutcome && !runningOperation && (
        <div className={styles.bottomDetail}>
          {error ? <ErrorNotice error={error} /> : <pre className="output">{result?.output || "Git printed no output."}</pre>}
        </div>
      )}
    </footer>
  );
}
