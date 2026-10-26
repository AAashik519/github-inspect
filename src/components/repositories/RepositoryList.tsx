"use client";

import { useState } from "react";
import { toErrorPayload } from "@/lib/api-client";
import type { RepositoryEntry } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import styles from "@/components/layout/layout.module.css";
import { AddRepositoryDialog } from "./AddRepositoryDialog";

export function RepositoryList() {
  const { repositories, activeRepository, openRepository, removeRepository } = useWorkspace();
  const [isAdding, setIsAdding] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<RepositoryEntry | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  async function open(entry: RepositoryEntry) {
    setOpenError(null);
    try {
      await openRepository(entry.id);
    } catch (error) {
      setOpenError(toErrorPayload(error).message);
    }
  }

  return (
    <details className={styles.sidebarSection} open>
      <summary>
        Repositories <span className="count">{repositories.length}</span>
      </summary>
      <ul className="list">
        {repositories.map((entry) => (
          <li key={entry.id} className={`list-item ${entry.id === activeRepository?.id ? "is-selected" : ""}`}>
            <button type="button" className="list-item-main plain-button" onClick={() => open(entry)} title={entry.path}>
              <span className="truncate">{entry.name}</span>
              <span className="muted truncate mono">{entry.path}</span>
            </button>
            {entry.state !== "ok" && (
              <Badge tone="danger" title={entry.stateMessage}>
                {entry.state}
              </Badge>
            )}
            <button type="button" className="button button-ghost button-small" aria-label={`Remove ${entry.name} from the list`} title="Remove from the list (files are kept)" onClick={() => setPendingRemoval(entry)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {openError && <p className="muted" style={{ padding: "4px 12px", color: "var(--danger)" }}>{openError}</p>}
      <div style={{ padding: 8 }}>
        <button type="button" className="button button-secondary button-small" onClick={() => setIsAdding(true)}>
          + Add repository
        </button>
      </div>
      {isAdding && <AddRepositoryDialog onClose={() => setIsAdding(false)} />}
      {pendingRemoval && (
        <ConfirmDialog
          title={`Remove “${pendingRemoval.name}” from the app?`}
          description={
            <>
              The repository is only removed from this list. <strong>No files or commits are deleted</strong> — it stays at <code>{pendingRemoval.path}</code>.
            </>
          }
          confirmLabel="Remove from list"
          onCancel={() => setPendingRemoval(null)}
          onConfirm={async () => {
            await removeRepository(pendingRemoval.id);
            setPendingRemoval(null);
          }}
        />
      )}
    </details>
  );
}
