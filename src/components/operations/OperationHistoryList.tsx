"use client";

import { formatDate, relativeTime } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { Badge, EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";

const OUTCOME_TONE = { success: "success", conflict: "warning", failed: "danger" } as const;

/** Every state-changing Git command run through this app since the server started, with its real output. */
export function OperationHistoryList() {
  const { data, error, reload } = useGitQuery("repo.operations", {});
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return <LoadingBlock label="Reading operation history…" />;
  if (data.length === 0) return <EmptyState title="No operations yet">Commands you run from this app appear here with their exact Git output. History is kept in memory until the server restarts.</EmptyState>;

  return (
    <div className="card">
      <ul className="list">
        {data.map((entry) => (
          <li key={entry.id} className="list-item" style={{ alignItems: "flex-start", flexDirection: "column" }}>
            <div className="toolbar" style={{ width: "100%" }}>
              <Badge tone={OUTCOME_TONE[entry.outcome]}>{entry.outcome}</Badge>
              <strong>{entry.label}</strong>
              <span className="muted" title={formatDate(entry.at)}>{relativeTime(entry.at)} · {entry.durationMs} ms</span>
            </div>
            <code className="truncate" style={{ maxWidth: "100%" }}>{entry.command}</code>
            {entry.error && (
              <div style={{ width: "100%" }}>
                <ErrorNotice error={entry.error} />
              </div>
            )}
            {entry.output && !entry.error && (
              <details>
                <summary className="muted">Git output</summary>
                <pre className="output">{entry.output}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
