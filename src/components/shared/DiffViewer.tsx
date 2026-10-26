"use client";

import { useState, type ReactNode } from "react";
import type { DiffTarget } from "@/lib/contract";
import type { DiffHunk } from "@/lib/diff/parse";
import { useGitQuery } from "@/hooks/useGitQuery";
import { ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";

const COLLAPSE_AFTER_LINES = 1500;

interface DiffViewerProps {
  target: DiffTarget;
  /** Buttons rendered in each hunk header (stage / unstage / discard hunk). */
  renderHunkActions?: (hunk: DiffHunk, index: number) => ReactNode;
}

/** Loads and renders the unified diff of a single file for the given comparison. */
export function DiffViewer({ target, renderHunkActions }: DiffViewerProps) {
  const { data, error, isLoading, reload } = useGitQuery("diff.file", target);
  const [showAll, setShowAll] = useState(false);

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (isLoading || !data) return <LoadingBlock label="Loading diff…" />;

  const file = data.files[0];
  if (!file) return <Notice>No textual changes. The file may have only a mode change, or it is identical.</Notice>;
  if (file.isBinary) return <Notice>Binary file — no text diff available.</Notice>;
  if (file.hunks.length === 0) {
    return <Notice>{file.kind === "renamed" ? `Renamed${file.oldPath ? ` from ${file.oldPath}` : ""} without content changes.` : "No textual changes (mode change only)."}</Notice>;
  }

  const totalLines = file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  const isCollapsed = totalLines > COLLAPSE_AFTER_LINES && !showAll;
  let budget = isCollapsed ? COLLAPSE_AFTER_LINES : Infinity;
  const shownHunks: { hunk: DiffHunk; index: number; lines: DiffHunk["lines"] }[] = [];
  for (const [index, hunk] of file.hunks.entries()) {
    if (budget <= 0) break;
    const lines = hunk.lines.slice(0, budget);
    budget -= lines.length;
    shownHunks.push({ hunk, index, lines });
  }

  return (
    <div>
      {data.truncated && <Notice tone="warning">This diff is very large and was cut off. Only the beginning is shown.</Notice>}
      <div className="toolbar" style={{ margin: "4px 0" }}>
        <span className="additions">+{file.additions}</span>
        <span className="deletions">−{file.deletions}</span>
        {file.kind === "renamed" && <span className="muted">renamed from {file.oldPath}</span>}
      </div>
      <div className="diff" role="table" aria-label="File diff">
        {shownHunks.map(({ hunk, index: hunkIndex, lines: visible }) => {
          return (
            <div key={`${hunk.header}-${hunkIndex}`} role="rowgroup">
              <div className="diff-hunk-header">
                <span style={{ flex: 1 }}>{hunk.header}</span>
                {renderHunkActions?.(hunk, hunkIndex)}
              </div>
              {visible.map((line, lineIndex) => (
                <div key={lineIndex} role="row" className={`diff-line ${line.type === "add" ? "diff-add" : line.type === "del" ? "diff-del" : line.type === "meta" ? "diff-meta" : ""}`}>
                  <span className="gutter">{line.oldNumber ?? ""}</span>
                  <span className="gutter">{line.newNumber ?? ""}</span>
                  <span className="marker">{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</span>
                  <span>{line.text}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {isCollapsed && (
        <button type="button" className="button button-secondary button-small" style={{ marginTop: 6 }} onClick={() => setShowAll(true)}>
          Show all {totalLines} lines
        </button>
      )}
    </div>
  );
}
