"use client";

import { useState } from "react";
import type { MergeStrategy, OperationResult } from "@/lib/types";
import { plural } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { CommitList } from "@/components/shared/CommitList";

const STRATEGIES: { id: MergeStrategy; title: string; description: string }[] = [
  { id: "default", title: "Default", description: "Fast-forward when possible, otherwise create a merge commit." },
  { id: "no-ff", title: "Always create a merge commit", description: "Keeps a visible merge point in the history even if a fast-forward is possible." },
  { id: "ff-only", title: "Fast-forward only", description: "Fails instead of creating a merge commit if the branches have diverged." },
  { id: "squash", title: "Squash", description: "Stages all changes as one set without committing; you commit them yourself. The source history is not linked." },
];

interface MergeDialogProps {
  source?: string;
  target?: string;
  onClose: () => void;
}

/** The merge workflow: pick direction, review what is introduced, preview conflicts, confirm, inspect the result. */
export function MergeDialog({ source: initialSource, target: initialTarget, onClose }: MergeDialogProps) {
  const { runOperation, select, setView } = useWorkspace();
  const call = useRepoCall();
  const branches = useGitQuery("branches.list", {});
  const status = useGitQuery("repo.status", {});
  const currentBranch = status.data?.head.branch ?? null;

  const [source, setSource] = useState(initialSource ?? "");
  const [target, setTarget] = useState(initialTarget ?? "");
  const [strategy, setStrategy] = useState<MergeStrategy>("default");
  const [message, setMessage] = useState("");
  const [isSwitchAcknowledged, setIsSwitchAcknowledged] = useState(false);
  const [result, setResult] = useState<OperationResult | null>(null);

  const effectiveTarget = target || currentBranch || "";
  const localBranches = branches.data?.filter((branch) => branch.kind === "local") ?? [];
  const canPreview = source !== "" && effectiveTarget !== "" && source !== effectiveTarget;
  const preview = useGitQuery("merge.preview", canPreview ? { source, target: effectiveTarget } : null);
  const data = preview.data;

  const needsSwitch = Boolean(data) && !data!.targetIsCurrent;
  const blockers: string[] = [];
  if (data?.alreadyMerged) blockers.push(`${effectiveTarget} already contains everything in ${source}.`);
  if (data && data.dirtyFileCount > 0) blockers.push(`${plural(data.dirtyFileCount, "file")} with uncommitted changes. Commit or stash them first.`);
  if (data && !data.canFastForward && strategy === "ff-only") blockers.push("A fast-forward is not possible: the branches have diverged.");
  if (needsSwitch && !isSwitchAcknowledged) blockers.push(`Confirm that ${effectiveTarget} may be checked out first.`);

  async function run() {
    if (!data) return;
    if (needsSwitch) {
      const switched = await runOperation(`Switch to ${effectiveTarget}`, () => call("branches.checkout", { name: effectiveTarget }));
      if (!switched) return;
    }
    const merged = await runOperation(`Merge ${source} into ${effectiveTarget}`, () =>
      call("merge.run", { source, target: effectiveTarget, strategy, message: message.trim() || undefined }),
    );
    if (merged) setResult(merged);
  }

  if (result) {
    return (
      <Dialog title={`${source} → ${effectiveTarget}`} onClose={onClose}>
        <Notice tone={result.outcome === "conflict" ? "warning" : "success"}>
          <strong>{result.outcome === "conflict" ? "Merge stopped with conflicts" : result.outcome === "noop" ? "Nothing to merge" : "Merge finished"}</strong>
          <span>{result.summary}</span>
        </Notice>
        <div className="dialog-actions">
          {result.headAfter && result.outcome !== "conflict" && (
            <Button
              onClick={() => {
                select({ kind: "commit", hash: result.headAfter! });
                setView("graph");
                onClose();
              }}
            >
              Inspect result in graph
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            {result.outcome === "conflict" ? "Resolve conflicts" : "Done"}
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Merge branches" description="The target branch receives the changes. Nothing happens until you press the merge button." onClose={onClose} wide>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <label className="field" style={{ flex: 1, marginTop: 0 }}>
          <span>Source — contains the changes to bring in</span>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">— choose branch —</option>
            {branches.data?.filter((branch) => branch.name !== effectiveTarget).map((branch) => (
              <option key={branch.fullName} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <strong style={{ fontSize: 18, alignSelf: "flex-end" }} aria-hidden>
          →
        </strong>
        <label className="field" style={{ flex: 1, marginTop: 0 }}>
          <span>Target — receives the changes</span>
          <select value={effectiveTarget} onChange={(event) => setTarget(event.target.value)}>
            {localBranches.map((branch) => (
              <option key={branch.fullName} value={branch.name}>
                {branch.name}
                {branch.isCurrent ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {source && effectiveTarget && (
        <p style={{ margin: "10px 0", fontSize: 14 }}>
          <code>{source}</code> → <code>{effectiveTarget}</code>: <strong>{effectiveTarget}</strong> will receive the changes of <strong>{source}</strong>.
        </p>
      )}

      {preview.error && <ErrorNotice error={preview.error} onRetry={preview.reload} />}
      {canPreview && !data && !preview.error && <LoadingBlock label="Comparing the branches…" />}
      {data && (
        <>
          {data.alreadyMerged ? (
            <Notice tone="success">{effectiveTarget} already contains all commits of {source}. There is nothing to merge.</Notice>
          ) : (
            <>
              <Notice tone="info">
                {data.canFastForward
                  ? `${effectiveTarget} has no commits that ${source} lacks, so Git can simply move ${effectiveTarget} forward (fast-forward).`
                  : `The branches have diverged: ${effectiveTarget} has ${plural(data.targetOnlyCount, "commit")} that ${source} lacks. A merge commit will combine them.`}
              </Notice>
              {data.conflicts.supported ? (
                data.conflicts.hasConflicts ? (
                  <Notice tone="warning">
                    <strong>Conflicts expected</strong> in {plural(data.conflicts.files.length, "file")}: {data.conflicts.files.join(", ")}. The merge will pause so you can resolve them or abort.
                  </Notice>
                ) : (
                  <Notice tone="success">Simulated merge: no conflicts expected.</Notice>
                )
              ) : (
                <Notice>Conflict preview needs Git 2.38 or newer (or the histories are unrelated). Conflicts, if any, will appear when the merge runs.</Notice>
              )}
              <h3 style={{ marginTop: 10 }}>
                {plural(data.commitsToIntroduceTotal, "commit")} will be introduced into {effectiveTarget}
              </h3>
              <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
                <CommitList commits={data.commitsToIntroduce} />
              </div>
              {data.commitsToIntroduceTotal > data.commitsToIntroduce.length && <p className="muted">Showing the newest {data.commitsToIntroduce.length}.</p>}
            </>
          )}
          <div className="card" style={{ marginTop: 10 }}>
            <div className="card-body">
              <strong>Current state of {effectiveTarget}</strong>
              <span className="muted">
                {data.targetIsCurrent ? "Checked out now." : `Not checked out — you are on ${currentBranch ?? "a detached HEAD"}.`} Merge base: {data.mergeBase ? <code>{data.mergeBase.slice(0, 8)}</code> : "none (unrelated histories)"}.
              </span>
            </div>
          </div>
          {needsSwitch && !data.alreadyMerged && (
            <Notice tone="warning">
              <label className="field-inline" style={{ marginTop: 0 }}>
                <input type="checkbox" checked={isSwitchAcknowledged} onChange={(event) => setIsSwitchAcknowledged(event.target.checked)} />
                <span>
                  Git merges into the checked-out branch. I allow switching from <strong>{currentBranch ?? "HEAD"}</strong> to <strong>{effectiveTarget}</strong> first.
                </span>
              </label>
            </Notice>
          )}
          {!data.alreadyMerged && (
            <>
              <label className="field">
                <span>Strategy</span>
                <select value={strategy} onChange={(event) => setStrategy(event.target.value as MergeStrategy)}>
                  {STRATEGIES.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </select>
                <span className="field-hint">{STRATEGIES.find((entry) => entry.id === strategy)?.description}</span>
              </label>
              {strategy === "no-ff" || (strategy === "default" && !data.canFastForward) ? (
                <label className="field">
                  <span>Merge commit message (optional)</span>
                  <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={`Merge branch '${source}' into ${effectiveTarget}`} />
                </label>
              ) : null}
            </>
          )}
          {blockers.length > 0 && !data.alreadyMerged && (
            <ul className="muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!data || blockers.length > 0} onClick={run}>
          Merge {source || "…"} into {effectiveTarget || "…"}
        </Button>
      </div>
    </Dialog>
  );
}
