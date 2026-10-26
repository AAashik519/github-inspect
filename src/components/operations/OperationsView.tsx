"use client";

import { useState } from "react";
import { formatDate, relativeTime, shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { ResetDialog } from "@/components/history-operations/ResetDialog";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { OperationHistoryList } from "./OperationHistoryList";

type Tab = "history" | "diagnostics" | "reflog";

function ReflogList() {
  const { select, setView } = useWorkspace();
  const { data, error, reload } = useGitQuery("repo.reflog", {});
  const [resetTarget, setResetTarget] = useState<string | null>(null);

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return <LoadingBlock label="Reading reflog…" />;
  if (data.length === 0) return <EmptyState title="The reflog is empty" />;

  return (
    <>
      <p className="muted" style={{ padding: "0 0 8px" }}>
        The reflog is Git’s private safety net: every position HEAD had recently. If a reset, rebase or deletion went wrong, the commit you lost is usually listed here.
      </p>
      <div className="card" style={{ overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>Entry</th><th>Commit</th><th>What happened</th><th>When</th><th></th></tr></thead>
          <tbody>
            {data.map((entry) => (
              <tr key={entry.selector}>
                <td><code>{entry.selector}</code></td>
                <td><code>{shortHash(entry.hash)}</code></td>
                <td>{entry.subject}</td>
                <td title={formatDate(entry.date)}>{relativeTime(entry.date)}</td>
                <td className="row-actions">
                  <Button size="small" onClick={() => { select({ kind: "commit", hash: entry.hash }); setView("graph"); }}>Show</Button>
                  <Button size="small" onClick={() => setResetTarget(entry.hash)}>Reset here…</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {resetTarget && <ResetDialog hash={resetTarget} onClose={() => setResetTarget(null)} />}
    </>
  );
}

export function OperationsView() {
  const [tab, setTab] = useState<Tab>("history");
  return (
    <div className="view">
      <div className="view-header">
        <h2>Operations and diagnostics</h2>
        <div className="toolbar" role="tablist">
          {([["history", "Operation history"], ["diagnostics", "Diagnostics"], ["reflog", "Reflog (recovery)"]] as [Tab, string][]).map(([id, label]) => (
            <Button key={id} role="tab" aria-selected={tab === id} size="small" variant={tab === id ? "primary" : "secondary"} onClick={() => setTab(id)}>{label}</Button>
          ))}
        </div>
      </div>
      <div className="view-scroll">
        {tab === "history" && <OperationHistoryList />}
        {tab === "diagnostics" && <DiagnosticsPanel />}
        {tab === "reflog" && <ReflogList />}
      </div>
    </div>
  );
}
