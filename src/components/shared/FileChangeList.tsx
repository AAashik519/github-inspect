"use client";

import { useState, type ReactNode } from "react";
import type { FileChange } from "@/lib/types";
import { Badge } from "@/components/ui/Feedback";

const STATUS_LABEL: Record<string, string> = { A: "Added", M: "Modified", D: "Deleted", R: "Renamed", C: "Copied", T: "Type changed", U: "Unmerged" };

export function FileStatusMark({ status }: { status: string }) {
  return (
    <span className={`file-status file-status-${status}`} title={STATUS_LABEL[status] ?? status} aria-label={STATUS_LABEL[status] ?? status}>
      {status}
    </span>
  );
}

/** Changed files with line counts. Clicking a file expands `renderDiff(file)` beneath it. */
export function FileChangeList({ files, renderDiff }: { files: FileChange[]; renderDiff?: (file: FileChange) => ReactNode }) {
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  return (
    <ul className="list">
      {files.map((file) => {
        const isExpanded = expandedPath === file.path;
        return (
          <li key={file.path}>
            <button type="button" className={`list-item ${isExpanded ? "is-selected" : ""}`} onClick={() => setExpandedPath(isExpanded ? null : file.path)} aria-expanded={isExpanded}>
              <FileStatusMark status={file.status} />
              <span className="list-item-main">
                <span className="truncate mono" title={file.path}>{file.path}</span>
                {file.oldPath && <span className="muted truncate mono">from {file.oldPath}</span>}
              </span>
              {file.binary ? (
                <Badge>binary</Badge>
              ) : (
                <span className="mono">
                  <span className="additions">+{file.additions ?? 0}</span> <span className="deletions">−{file.deletions ?? 0}</span>
                </span>
              )}
            </button>
            {isExpanded && renderDiff && <div style={{ padding: "8px 12px" }}>{renderDiff(file)}</div>}
          </li>
        );
      })}
    </ul>
  );
}
