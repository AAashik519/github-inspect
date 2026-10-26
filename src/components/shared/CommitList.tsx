"use client";

import type { CommitSummary } from "@/lib/types";
import { relativeTime, shortHash } from "@/lib/format";
import { Badge } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

interface CommitListProps {
  commits: CommitSummary[];
  /** Defaults to opening the commit in the right-hand details panel. */
  onSelect?: (hash: string) => void;
  emptyText?: string;
}

export function CommitList({ commits, onSelect, emptyText = "No commits." }: CommitListProps) {
  const { selection, select } = useWorkspace();
  if (commits.length === 0) return <p className="muted" style={{ padding: "8px 12px" }}>{emptyText}</p>;

  return (
    <ul className="list">
      {commits.map((commit) => (
        <li key={commit.hash}>
          <button
            type="button"
            className={`list-item ${selection?.kind === "commit" && selection.hash === commit.hash ? "is-selected" : ""}`}
            onClick={() => (onSelect ? onSelect(commit.hash) : select({ kind: "commit", hash: commit.hash }))}
          >
            <code>{shortHash(commit.hash)}</code>
            <span className="list-item-main">
              <span className="truncate" title={commit.subject}>{commit.subject}</span>
              <span className="muted truncate">{commit.authorName} · {relativeTime(commit.authorDate)}</span>
            </span>
            {commit.parents.length > 1 && <Badge tone="merge">merge</Badge>}
          </button>
        </li>
      ))}
    </ul>
  );
}
