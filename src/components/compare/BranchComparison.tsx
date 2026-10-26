"use client";

import { useState } from "react";
import { describeDivergence, plural, shortHash } from "@/lib/format";
import type { ComparisonRelation, FileChange } from "@/lib/types";
import { useGitQuery } from "@/hooks/useGitQuery";
import { Button } from "@/components/ui/Button";
import { Badge, EmptyState, ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { MergeDialog } from "@/components/merge/MergeDialog";
import { CommitList } from "@/components/shared/CommitList";
import { DiffViewer } from "@/components/shared/DiffViewer";
import { DivergenceDiagram } from "@/components/shared/DivergenceDiagram";
import { FileChangeList } from "@/components/shared/FileChangeList";

const RELATION_LABEL: Record<ComparisonRelation, { text: string; tone: "success" | "accent" | "warning" | "danger" }> = {
  identical: { text: "identical", tone: "success" },
  ahead: { text: "ahead (can fast-forward)", tone: "accent" },
  behind: { text: "behind (already merged)", tone: "success" },
  diverged: { text: "diverged", tone: "warning" },
  unrelated: { text: "unrelated histories", tone: "danger" },
};

function countChanges(files: FileChange[]) {
  return {
    added: files.filter((file) => file.status === "A").length,
    modified: files.filter((file) => file.status === "M" || file.status === "T").length,
    deleted: files.filter((file) => file.status === "D").length,
    renamed: files.filter((file) => file.status === "R" || file.status === "C").length,
  };
}

export function BranchComparison() {
  const { comparisonPreset } = useWorkspace();
  const branches = useGitQuery("branches.list", {});
  const current = branches.data?.find((branch) => branch.isCurrent)?.name ?? "";
  const [chosenSource, setChosenSource] = useState<string | null>(null);
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  const source = chosenSource ?? comparisonPreset?.source ?? current;
  const target = chosenTarget ?? comparisonPreset?.target ?? "";
  const canCompare = source !== "" && target !== "" && source !== target;
  const { data, error, reload } = useGitQuery("compare.branches", canCompare ? { source, target } : null);
  const names = branches.data?.map((branch) => branch.name) ?? [];

  return (
    <div className="view">
      <div className="view-header">
        <h2>Branch comparison</h2>
        <label className="toolbar">
          <span className="muted">Source</span>
          <select value={source} onChange={(event) => setChosenSource(event.target.value)} aria-label="Source branch">
            <option value="">— choose —</option>
            {names.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <Button size="small" onClick={() => { setChosenSource(target); setChosenTarget(source); }} title="Swap source and target">⇄</Button>
        <label className="toolbar">
          <span className="muted">Target</span>
          <select value={target} onChange={(event) => setChosenTarget(event.target.value)} aria-label="Target branch">
            <option value="">— choose —</option>
            {names.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <Button variant="primary" disabled={!canCompare} onClick={() => setIsMerging(true)}>
          Merge {source || "source"} → {target || "target"}…
        </Button>
      </div>
      <div className="view-scroll">
        {!canCompare && <EmptyState title="Choose two different branches">Pick a source and a target to see how their histories relate.</EmptyState>}
        {canCompare && error && <ErrorNotice error={error} onRetry={reload} />}
        {canCompare && !data && !error && <LoadingBlock label="Comparing…" />}
        {canCompare && data && (
          <>
            <Notice tone={data.relation === "diverged" ? "warning" : "info"}>
              <strong>
                {data.relation === "unrelated" ? `${source} and ${target} share no common history.` : describeDivergence(source, target, data.ahead, data.behind)}
              </strong>
              <span className="muted">Calculated from Git ancestry (not from dates or messages).</span>
            </Notice>
            <div className="stat-grid">
              <div className="stat"><strong>{data.ahead}</strong>commits ahead</div>
              <div className="stat"><strong>{data.behind}</strong>commits behind</div>
              <div className="stat">
                <strong><Badge tone={RELATION_LABEL[data.relation].tone}>{RELATION_LABEL[data.relation].text}</Badge></strong>
                relation
              </div>
              <div className="stat">
                <strong>{data.mergeBase ? <code>{shortHash(data.mergeBase)}</code> : "—"}</strong>
                common ancestor
              </div>
            </div>
            <div className="card">
              <div className="card-header">Histories</div>
              <div className="card-body">
                <DivergenceDiagram
                  base={data.mergeBase ? shortHash(data.mergeBase) : null}
                  lines={[
                    { label: target, count: data.behind, colorIndex: 0 },
                    { label: source, count: data.ahead, colorIndex: 1 },
                  ]}
                />
              </div>
            </div>
            <div className="two-columns">
              <div className="card">
                <div className="card-header">In {source} only <Badge>{data.ahead}</Badge></div>
                <CommitList commits={data.sourceOnly} emptyText={`Nothing in ${source} is missing from ${target}.`} />
                {data.commitListTruncated && data.ahead > data.sourceOnly.length && <p className="muted" style={{ padding: 8 }}>Showing the newest {data.sourceOnly.length}.</p>}
              </div>
              <div className="card">
                <div className="card-header">In {target} only <Badge>{data.behind}</Badge></div>
                <CommitList commits={data.targetOnly} emptyText={`Nothing in ${target} is missing from ${source}.`} />
                {data.commitListTruncated && data.behind > data.targetOnly.length && <p className="muted" style={{ padding: 8 }}>Showing the newest {data.targetOnly.length}.</p>}
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                Files changed by {source}
                {(() => {
                  const counts = countChanges(data.files);
                  return (
                    <span className="muted spacer">
                      {plural(data.files.length, "file")}: {counts.added} added, {counts.modified} modified, {counts.deleted} deleted, {counts.renamed} renamed
                    </span>
                  );
                })()}
              </div>
              {data.mergeBase && <p className="muted" style={{ padding: "6px 12px" }}>Changes made on {source} since the common ancestor — what a merge would bring into {target}.</p>}
              {data.files.length === 0 ? (
                <EmptyState title="No file differences" />
              ) : (
                <FileChangeList
                  files={data.files}
                  renderDiff={(file) => <DiffViewer target={{ kind: "range", base: data.targetHash, head: data.sourceHash, path: file.path, oldPath: file.oldPath, fromMergeBase: Boolean(data.mergeBase) }} />}
                />
              )}
            </div>
          </>
        )}
      </div>
      {isMerging && <MergeDialog source={source} target={target} onClose={() => setIsMerging(false)} />}
    </div>
  );
}
