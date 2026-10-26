"use client";

import { formatDate, plural, relativeTime, shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { Badge, ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

export function RepositoryOverview() {
  const { activeRepository, repositories, openRepository, setView, select } = useWorkspace();
  const info = useGitQuery("repo.info", {});
  const status = useGitQuery("repo.status", {});

  if (info.error) return <div className="view-scroll"><ErrorNotice error={info.error} onRetry={info.reload} /></div>;
  if (!info.data || !status.data) return <LoadingBlock label="Reading repository…" />;

  const repo = info.data;
  const changed = status.data.files.length;
  const conflicted = status.data.files.filter((file) => file.isConflicted).length;
  const upstream = status.data.upstream;
  const recent = repositories.filter((entry) => entry.id !== activeRepository?.id).slice(0, 5);

  return (
    <div className="view">
      <div className="view-header">
        <h2>Repository overview</h2>
      </div>
      <div className="view-scroll">
        <div className="card">
          <div className="card-header">
            {repo.name}
            {repo.head.detached && <Badge tone="warning">detached HEAD</Badge>}
            {repo.isLinkedWorktree && <Badge>linked worktree</Badge>}
            {repo.isShallow && <Badge title="History is truncated (shallow clone)">shallow</Badge>}
            {!repo.hasCommits && <Badge tone="accent">no commits yet</Badge>}
          </div>
          <div className="card-body">
            <div className="mono muted">{repo.path}</div>
            <div className="toolbar">
              <span>
                Current branch: <strong>{repo.head.branch ?? `detached at ${repo.head.hash ? shortHash(repo.head.hash) : "?"}`}</strong>
              </span>
              {upstream && !upstream.gone && (
                <Badge tone={upstream.ahead || upstream.behind ? "warning" : "success"}>
                  {upstream.name}: {upstream.ahead} ahead, {upstream.behind} behind
                </Badge>
              )}
              {upstream?.gone && <Badge tone="danger">upstream {upstream.name} is gone</Badge>}
              {!upstream && repo.head.branch && <Badge>no upstream</Badge>}
            </div>
            <div>
              Working tree:{" "}
              {changed === 0 ? <strong>clean</strong> : <strong>{plural(changed, "changed file")}</strong>}
              {conflicted > 0 && <Badge tone="danger">{plural(conflicted, "conflict")}</Badge>}
              {status.data.inProgress && <Badge tone="warning">{status.data.inProgress.kind} in progress</Badge>}
            </div>
            {repo.lastCommit && (
              <div className="muted">
                Newest commit (on any branch) <code>{shortHash(repo.lastCommit.hash)}</code> “{repo.lastCommit.subject}” by {repo.lastCommit.authorName}, {relativeTime(repo.lastCommit.committerDate)} ({formatDate(repo.lastCommit.committerDate)})
              </div>
            )}
            <div className="toolbar">
              {repo.lastCommit && (
                <button type="button" className="button button-secondary button-small" onClick={() => { select({ kind: "commit", hash: repo.lastCommit!.hash }); setView("graph"); }}>
                  Show latest commit in graph
                </button>
              )}
              <button type="button" className="button button-secondary button-small" onClick={() => setView("source-control")}>Open source control</button>
            </div>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat"><strong>{repo.commitCount ?? "—"}</strong>commits</div>
          <div className="stat"><strong>{repo.localBranchCount}</strong>local branches</div>
          <div className="stat"><strong>{repo.remoteBranchCount}</strong>remote branches</div>
          <div className="stat"><strong>{repo.tagCount}</strong>tags</div>
          <div className="stat"><strong>{repo.stashCount}</strong>stashes</div>
          <div className="stat"><strong>{repo.remoteCount}</strong>remotes</div>
        </div>

        {repo.superproject && <Notice>This repository is a submodule of <code>{repo.superproject}</code>.</Notice>}
        {repo.submodules.length > 0 && (
          <Notice>
            Contains {plural(repo.submodules.length, "submodule")} ({repo.submodules.join(", ")}). Submodules are listed in status as ordinary paths; manage them inside their own repositories.
          </Notice>
        )}
        {repo.isLinkedWorktree && <Notice>This is a linked worktree. Its branch cannot be checked out in the main worktree at the same time.</Notice>}
        {!repo.hasCommits && <Notice tone="warning">This repository has no commits yet. Stage files in Source Control and create the first commit.</Notice>}

        <div className="card">
          <div className="card-header">Details</div>
          <div className="card-body">
            <div>Git directory: <code>{repo.gitDir}</code></div>
            <div>Git version: <code>{repo.gitVersion}</code></div>
          </div>
        </div>

        {recent.length > 0 && (
          <div className="card">
            <div className="card-header">Recent repositories</div>
            <ul className="list">
              {recent.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className="list-item" onClick={() => void openRepository(entry.id)}>
                    <span className="list-item-main">
                      <span>{entry.name}</span>
                      <span className="muted mono truncate">{entry.path}</span>
                    </span>
                    <span className="muted">{relativeTime(entry.lastOpenedAt)}</span>
                    {entry.state !== "ok" && <Badge tone="danger" title={entry.stateMessage}>{entry.state}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
