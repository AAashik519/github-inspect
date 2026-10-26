"use client";

import type { ReactNode } from "react";
import type { StatusFile } from "@/lib/types";
import { FileStatusMark } from "@/components/shared/FileChangeList";

export interface ChangeEntry {
  file: StatusFile;
  /** Status letter shown for this group (index status, work-tree status, "?" or "U"). */
  letter: string;
}

interface ChangeGroupProps {
  title: string;
  summary?: string;
  entries: ChangeEntry[];
  selectedPath: string | null;
  onSelect: (entry: ChangeEntry) => void;
  headerActions?: ReactNode;
  renderRowActions: (entry: ChangeEntry) => ReactNode;
}

export function ChangeGroup({ title, summary, entries, selectedPath, onSelect, headerActions, renderRowActions }: ChangeGroupProps) {
  if (entries.length === 0) return null;
  return (
    <section aria-label={title}>
      <div className="card-header" style={{ background: "var(--bg-subtle)" }}>
        {title} <span className="muted">({entries.length})</span>
        {summary && <span className="muted" style={{ fontWeight: 400 }}>{summary}</span>}
        <span className="spacer row-actions">{headerActions}</span>
      </div>
      <ul className="list">
        {entries.map((entry) => (
          <li key={`${title}:${entry.file.path}`} className={`list-item ${selectedPath === entry.file.path ? "is-selected" : ""}`}>
            <button type="button" className="plain-button list-item-main" onClick={() => onSelect(entry)} title={entry.file.originalPath ? `${entry.file.originalPath} → ${entry.file.path}` : entry.file.path}>
              <span className="truncate mono">{entry.file.path.split("/").pop()}</span>
              <span className="muted truncate mono" style={{ fontSize: 11 }}>
                {entry.file.originalPath ? `${entry.file.originalPath} → ` : ""}
                {entry.file.path.includes("/") ? entry.file.path.slice(0, entry.file.path.lastIndexOf("/")) : ""}
              </span>
            </button>
            <span className="row-actions">{renderRowActions(entry)}</span>
            <FileStatusMark status={entry.letter} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const LETTER_NAME: Record<string, string> = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", T: "type changed", "?": "untracked", U: "conflicted" };

/** "3 modified, 1 deleted" for a group of status letters. */
export function summarizeLetters(entries: ChangeEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.letter, (counts.get(entry.letter) ?? 0) + 1);
  return ` — ${[...counts].map(([letter, count]) => `${count} ${LETTER_NAME[letter] ?? letter}`).join(", ")}`;
}
