"use client";

import { useGitQuery } from "@/hooks/useGitQuery";
import { useWorkspace, type ViewId } from "@/components/workspace/WorkspaceProvider";
import { Badge } from "@/components/ui/Feedback";
import styles from "./layout.module.css";

const VIEWS: { id: ViewId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "graph", label: "Git Graph" },
  { id: "source-control", label: "Source Control" },
  { id: "branches", label: "Branches" },
  { id: "comparison", label: "Compare" },
  { id: "merges", label: "Merge History" },
  { id: "remotes", label: "Remotes" },
  { id: "stashes", label: "Stashes" },
  { id: "tags", label: "Tags" },
  { id: "operations", label: "Operations" },
];

export function ViewTabs() {
  const { view, setView, activeRepository } = useWorkspace();
  const status = useGitQuery("repo.status", activeRepository ? {} : null);
  const changed = status.data?.files.length ?? 0;
  const conflicts = status.data?.files.filter((file) => file.isConflicted).length ?? 0;

  return (
    <div className={styles.tabs} role="tablist" aria-label="Views">
      {VIEWS.map((entry) => (
        <button key={entry.id} type="button" role="tab" aria-selected={view === entry.id} className={`${styles.tab} ${view === entry.id ? styles.tabActive : ""}`} onClick={() => setView(entry.id)}>
          {entry.label}
          {entry.id === "source-control" && changed > 0 && (
            <span className={styles.tabBadge}>
              <Badge tone={conflicts > 0 ? "danger" : "warning"}>{conflicts > 0 ? `${conflicts} conflict${conflicts === 1 ? "" : "s"}` : changed}</Badge>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
