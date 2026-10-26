"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CommitDetailsPanel } from "@/components/commits/CommitDetailsPanel";
import { CompareCommitsPanel } from "@/components/commits/CompareCommitsPanel";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import styles from "./layout.module.css";

/** Contextual details for whatever is selected: a commit, or a comparison of two commits. */
export function RightPanel() {
  const { selection, select } = useWorkspace();
  const [isWide, setIsWide] = useState(false);
  if (!selection) return null;

  return (
    <aside className={`${styles.rightPanel} ${isWide ? styles.rightPanelWide : ""}`} aria-label="Details">
      <div className={styles.rightPanelHeader}>
        <span style={{ flex: 1 }}>{selection.kind === "commit" ? "Commit details" : "Compare commits"}</span>
        <Button size="small" variant="ghost" onClick={() => setIsWide((wide) => !wide)} aria-label={isWide ? "Narrow panel" : "Widen panel"} title={isWide ? "Narrow panel" : "Widen panel"}>
          {isWide ? "⇥" : "⇤"}
        </Button>
        <Button size="small" variant="ghost" onClick={() => select(null)} aria-label="Close details">✕</Button>
      </div>
      <div className={styles.rightPanelBody}>
        {selection.kind === "commit" ? <CommitDetailsPanel key={selection.hash} hash={selection.hash} /> : <CompareCommitsPanel key={`${selection.base}-${selection.head}`} base={selection.base} head={selection.head} />}
      </div>
    </aside>
  );
}
