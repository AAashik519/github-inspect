"use client";

import { useState } from "react";
import type { RemoteInfo, WorkingTreeStatus } from "@/lib/types";
import { plural } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Badge, ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { CommitList } from "@/components/shared/CommitList";

type PullMode = "ff-only" | "merge" | "rebase";

const PULL_MODE_TEXT: Record<PullMode, string> = {
  "ff-only": "Fast-forward only — fails safely if the histories have diverged.",
  merge: "Merge — creates a merge commit when both sides have new commits.",
  rebase: "Rebase — replays your local commits on top of the remote ones (rewrites your local commits).",
};

function splitUpstream(upstream: string | undefined): { remote: string; branch: string } | null {
  if (!upstream) return null;
  const slash = upstream.indexOf("/");
  return { remote: upstream.slice(0, slash), branch: upstream.slice(slash + 1) };
}

/** Pull and push for the checked-out branch, with the remote, branch and incoming/outgoing commits always visible. */
export function SyncPanel({ remotes, status }: { remotes: RemoteInfo[]; status: WorkingTreeStatus }) {
  const { runOperation, runningOperation } = useWorkspace();
  const call = useRepoCall();
  const currentBranch = status.head.branch;
  const upstream = status.upstream && !status.upstream.gone ? splitUpstream(status.upstream.name) : null;

  const [remote, setRemote] = useState<string | null>(null);
  const [pullBranch, setPullBranch] = useState<string | null>(null);
  const [pullMode, setPullMode] = useState<PullMode>("ff-only");
  const [setUpstream, setSetUpstream] = useState<boolean | null>(null);
  const [isForce, setIsForce] = useState(false);
  const [forceText, setForceText] = useState("");

  const activeRemote = remote ?? upstream?.remote ?? remotes[0]?.name ?? "";
  const remoteInfo = remotes.find((entry) => entry.name === activeRemote);
  const remoteBranches = (remoteInfo?.branches ?? []).map((name) => name.slice(activeRemote.length + 1));
  const activePullBranch = pullBranch ?? (upstream?.remote === activeRemote ? upstream.branch : undefined) ?? (currentBranch && remoteBranches.includes(currentBranch) ? currentBranch : remoteBranches[0]) ?? "";
  const shouldSetUpstream = setUpstream ?? !status.upstream;

  const sync = useGitQuery("remotes.sync", activeRemote && activePullBranch ? { remote: activeRemote, branch: activePullBranch } : null);
  const isBusy = runningOperation !== null;
  const hasDirtyFiles = status.files.some((file) => !file.isUntracked);

  const pullBlocked = !currentBranch ? "You are on a detached HEAD. Check out a branch first." : status.inProgress ? `A ${status.inProgress.kind} is in progress.` : pullMode !== "ff-only" && hasDirtyFiles ? "Commit or stash your changes before a merge/rebase pull." : !activePullBranch ? "The remote has no known branches. Fetch it first." : null;
  const pushBlocked = !currentBranch ? "Check out a branch to push." : !activeRemote ? "Choose a remote." : isForce && forceText !== currentBranch ? "Type the branch name to confirm the force push." : null;

  return (
    <div className="two-columns">
      <div className="card">
        <div className="card-header">Pull (download and integrate)</div>
        <div className="card-body">
          <div className="toolbar">
            <label className="toolbar"><span className="muted">Remote</span>
              <select value={activeRemote} onChange={(event) => { setRemote(event.target.value); setPullBranch(null); }}>
                {remotes.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
              </select>
            </label>
            <label className="toolbar"><span className="muted">Branch</span>
              <select value={activePullBranch} onChange={(event) => setPullBranch(event.target.value)}>
                {remoteBranches.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          </div>
          <p>
            This will bring <strong>{activeRemote}/{activePullBranch || "…"}</strong> into <strong>{currentBranch ?? "HEAD"}</strong>.
          </p>
          <label className="field">
            <span>Method</span>
            <select value={pullMode} onChange={(event) => setPullMode(event.target.value as PullMode)}>
              <option value="ff-only">Fast-forward only</option>
              <option value="merge">Merge</option>
              <option value="rebase">Rebase</option>
            </select>
            <span className="field-hint">{PULL_MODE_TEXT[pullMode]}</span>
          </label>
          {sync.error && <ErrorNotice error={sync.error} onRetry={sync.reload} />}
          {!sync.data && !sync.error && activePullBranch && <LoadingBlock label="Comparing with the last fetched state…" />}
          {sync.data && sync.data.upstream && (
            <>
              <p className="muted">Based on the last fetch. Press Fetch to refresh remote information first.</p>
              <h4>{plural(sync.data.incoming.length, "incoming commit")}</h4>
              <div style={{ maxHeight: 180, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}><CommitList commits={sync.data.incoming} emptyText="Nothing to pull." /></div>
              {sync.data.incoming.length > 0 && sync.data.outgoing.length > 0 && <Notice tone="warning">Both sides have new commits: the histories have diverged. Fast-forward will fail; choose merge or rebase.</Notice>}
              {sync.data.conflicts?.hasConflicts && sync.data.incoming.length > 0 && <Notice tone="warning">Potential conflicts in: {sync.data.conflicts.files.join(", ")}.</Notice>}
            </>
          )}
          {pullBlocked && <Notice tone="warning">{pullBlocked}</Notice>}
          <div>
            <Button variant="primary" disabled={isBusy || pullBlocked !== null} onClick={() => void runOperation(`Pull ${activeRemote}/${activePullBranch}`, () => call("remotes.pull", { remote: activeRemote, branch: activePullBranch, mode: pullMode }))}>
              Pull {activeRemote}/{activePullBranch || "…"} ({pullMode})
            </Button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Push (upload)</div>
        <div className="card-body">
          <p>
            This will upload <strong>{currentBranch ?? "HEAD"}</strong> to <strong>{activeRemote}/{currentBranch ?? "…"}</strong>.
          </p>
          {status.upstream ? <Badge tone="accent">tracks {status.upstream.name}</Badge> : <Badge>no upstream configured</Badge>}
          {sync.data && sync.data.upstream === `${activeRemote}/${currentBranch}` && (
            <>
              <h4>{plural(sync.data.outgoing.length, "outgoing commit")}</h4>
              <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}><CommitList commits={sync.data.outgoing} emptyText="Everything is already on the remote." /></div>
            </>
          )}
          <label className="field-inline">
            <input type="checkbox" checked={shouldSetUpstream} onChange={(event) => setSetUpstream(event.target.checked)} />
            <span>Set {activeRemote}/{currentBranch ?? "branch"} as the upstream (needed for the first push of a new branch)</span>
          </label>
          <label className="field-inline">
            <input type="checkbox" checked={isForce} onChange={(event) => setIsForce(event.target.checked)} />
            <span>Force push (with lease)</span>
          </label>
          {isForce && (
            <>
              <Notice tone="danger">
                <strong>A force push overwrites the remote branch.</strong> Commits that exist only on the remote are discarded for everyone. “With lease” refuses if the remote changed since your last fetch, but it is still destructive.
              </Notice>
              <label className="field">
                <span>Type <code>{currentBranch}</code> to confirm</span>
                <input value={forceText} onChange={(event) => setForceText(event.target.value)} autoComplete="off" />
              </label>
            </>
          )}
          {pushBlocked && <Notice tone="warning">{pushBlocked}</Notice>}
          <div>
            <Button
              variant={isForce ? "danger" : "primary"}
              disabled={isBusy || pushBlocked !== null || !currentBranch}
              onClick={() => currentBranch && void runOperation(`Push ${currentBranch} to ${activeRemote}`, () => call("remotes.push", { remote: activeRemote, branch: currentBranch, setUpstream: shouldSetUpstream, force: isForce, forceConfirm: isForce ? forceText : undefined }))}
            >
              {isForce ? "Force push" : "Push"} {currentBranch ?? ""} → {activeRemote}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
