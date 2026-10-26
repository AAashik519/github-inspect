"use client";

import { useState } from "react";
import { plural, relativeTime, shortHash } from "@/lib/format";
import type { BranchInfo, CommitSummary } from "@/lib/types";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Badge, EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { RebaseDialog } from "@/components/history-operations/RebaseDialog";
import { MergeDialog } from "@/components/merge/MergeDialog";
import { CommitList } from "@/components/shared/CommitList";
import { CreateBranchDialog } from "./CreateBranchDialog";
import { DeleteBranchDialog, DeleteRemoteBranchDialog, RenameBranchDialog, SetUpstreamDialog } from "./BranchDialogs";

type Filter = "all" | "local" | "remote" | "merged" | "unmerged" | "ahead" | "behind" | "diverged";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "local", label: "Local" },
  { id: "remote", label: "Remote-tracking" },
  { id: "merged", label: "Merged into target" },
  { id: "unmerged", label: "Not merged" },
  { id: "ahead", label: "Ahead of target" },
  { id: "behind", label: "Behind target" },
  { id: "diverged", label: "Diverged" },
];

const DEFAULT_TARGETS = ["main", "master", "develop", "dev"];

type Dialog =
  | { kind: "create"; startPoint?: string }
  | { kind: "rename" | "delete" | "delete-remote" | "upstream"; branch: BranchInfo }
  | { kind: "merge"; source: string }
  | { kind: "rebase"; onto: string };

function matchesFilter(branch: BranchInfo, filter: Filter): boolean {
  const relative = branch.relative;
  switch (filter) {
    case "all":
      return true;
    case "local":
    case "remote":
      return branch.kind === filter;
    case "merged":
      return relative?.merged === true;
    case "unmerged":
      return relative?.merged === false;
    case "ahead":
      return (relative?.ahead ?? 0) > 0;
    case "behind":
      return (relative?.behind ?? 0) > 0;
    case "diverged":
      return (relative?.ahead ?? 0) > 0 && (relative?.behind ?? 0) > 0;
  }
}

export function BranchExplorer() {
  const { runOperation, openComparison, select, setView } = useWorkspace();
  const call = useRepoCall();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const initial = useGitQuery("branches.list", {});
  const defaultTarget = DEFAULT_TARGETS.find((name) => initial.data?.some((branch) => branch.kind === "local" && branch.name === name)) ?? initial.data?.find((branch) => branch.isCurrent)?.name;
  const target = chosenTarget ?? defaultTarget ?? null;
  const { data: branches, error, reload } = useGitQuery("branches.list", target ? { target } : null);
  const list = branches ?? initial.data;

  const current = list?.find((branch) => branch.isCurrent);
  const visible = (list ?? []).filter((branch) => matchesFilter(branch, filter) && branch.name.toLowerCase().includes(search.toLowerCase()));
  const remoteNames = (list ?? []).filter((branch) => branch.kind === "remote").map((branch) => branch.name);

  const unique = useGitQuery("branches.unique", expanded && target ? { branch: expanded, target } : null);

  async function switchTo(branch: BranchInfo) {
    await runOperation(`Switch to ${branch.name}`, () => call("branches.checkout", { name: branch.name }));
  }

  return (
    <div className="view">
      <div className="view-header">
        <h2>Branches</h2>
        <label className="toolbar">
          <span className="muted">Compare against</span>
          <select value={target ?? ""} onChange={(event) => setChosenTarget(event.target.value)} aria-label="Target branch for merge status">
            {(list ?? []).filter((branch) => branch.kind === "local").map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" onClick={() => setDialog({ kind: "create" })}>
          New branch…
        </Button>
      </div>
      <div className="view-header">
        <div className="toolbar" role="group" aria-label="Branch filters">
          {FILTERS.map((entry) => (
            <Button key={entry.id} size="small" variant={filter === entry.id ? "primary" : "secondary"} onClick={() => setFilter(entry.id)} aria-pressed={filter === entry.id}>
              {entry.label}
            </Button>
          ))}
        </div>
        <input type="search" placeholder="Filter by name" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Filter branches by name" />
      </div>
      <div className="view-scroll" style={{ padding: 0 }}>
        {error && <div style={{ padding: 14 }}><ErrorNotice error={error} onRetry={reload} /></div>}
        {!list && !error && <LoadingBlock label="Reading branches…" />}
        {list && visible.length === 0 && <EmptyState title="No branches match">Change the filter or the target branch.</EmptyState>}
        {list && visible.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Branch</th>
                <th>Latest commit</th>
                <th>Upstream</th>
                <th>Vs {target ?? "target"}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((branch) => (
                <BranchRow
                  key={branch.fullName}
                  branch={branch}
                  target={target}
                  isExpanded={expanded === branch.name}
                  onToggle={() => setExpanded(expanded === branch.name ? null : branch.name)}
                  uniqueCommits={expanded === branch.name ? unique.data : undefined}
                  actions={[
                    ...(branch.kind === "local" && !branch.isCurrent ? [{ label: "Switch to this branch", run: () => switchTo(branch) }] : []),
                    ...(branch.kind === "remote" ? [{ label: "Check out as local branch", run: () => switchTo(branch) }] : []),
                    { label: "Show tip in graph", run: () => { select({ kind: "commit", hash: branch.hash }); setView("graph"); } },
                    ...(target && target !== branch.name ? [{ label: `Compare with ${target}`, run: () => openComparison({ source: branch.name, target }) }] : []),
                    ...(!branch.isCurrent ? [{ label: `Merge ${branch.name} into…`, run: () => setDialog({ kind: "merge", source: branch.name }) }] : []),
                    ...(current && !branch.isCurrent ? [{ label: `Rebase ${current.name} onto this`, run: () => setDialog({ kind: "rebase", onto: branch.name }) }] : []),
                    { label: "New branch from here…", run: () => setDialog({ kind: "create", startPoint: branch.name }) },
                    ...(branch.kind === "local" ? [{ label: "Rename…", run: () => setDialog({ kind: "rename", branch }) }, { label: "Set upstream…", run: () => setDialog({ kind: "upstream", branch }) }] : []),
                    branch.kind === "local"
                      ? {
                          label: branch.isCurrent ? "Delete (unavailable: this is the checked-out branch)" : "Delete…",
                          disabled: branch.isCurrent,
                          title: branch.isCurrent ? "Git cannot delete the branch you are on. Switch to another branch first." : undefined,
                          run: () => setDialog({ kind: "delete", branch }),
                        }
                      : { label: "Delete on remote…", run: () => setDialog({ kind: "delete-remote", branch }) },
                  ]}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {dialog?.kind === "create" && <CreateBranchDialog startPoint={dialog.startPoint} onClose={() => setDialog(null)} />}
      {dialog?.kind === "rename" && <RenameBranchDialog branch={dialog.branch} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && <DeleteBranchDialog branch={dialog.branch} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete-remote" && <DeleteRemoteBranchDialog branch={dialog.branch} onClose={() => setDialog(null)} />}
      {dialog?.kind === "upstream" && <SetUpstreamDialog branch={dialog.branch} remoteBranches={remoteNames} onClose={() => setDialog(null)} />}
      {dialog?.kind === "merge" && <MergeDialog source={dialog.source} target={current?.name} onClose={() => setDialog(null)} />}
      {dialog?.kind === "rebase" && <RebaseDialog onto={dialog.onto} onClose={() => setDialog(null)} />}
    </div>
  );
}

interface RowAction {
  label: string;
  run: () => void | Promise<void>;
  disabled?: boolean;
  title?: string;
}

interface BranchRowProps {
  branch: BranchInfo;
  target: string | null;
  isExpanded: boolean;
  onToggle: () => void;
  uniqueCommits?: CommitSummary[];
  actions: RowAction[];
}

function BranchRow({ branch, target, isExpanded, onToggle, uniqueCommits, actions }: BranchRowProps) {
  const relative = branch.relative;
  return (
    <>
      <tr>
        <td>
          <button type="button" className="plain-button" onClick={onToggle} aria-expanded={isExpanded} title="Show commits unique to this branch">
            {isExpanded ? "▾" : "▸"} <strong>{branch.name}</strong>
          </button>{" "}
          {branch.isCurrent && <Badge tone="accent">HEAD</Badge>} <Badge>{branch.kind === "local" ? "local" : "remote"}</Badge>
        </td>
        <td style={{ maxWidth: 260 }}>
          <div className="truncate" title={branch.subject}>
            <code>{shortHash(branch.hash)}</code> {branch.subject}
          </div>
          <div className="muted">{branch.authorName} · {relativeTime(branch.date)}</div>
        </td>
        <td>
          {branch.kind === "remote" ? (
            <span className="muted">—</span>
          ) : branch.upstream ? (
            <>
              <code>{branch.upstream}</code>{" "}
              {branch.upstreamGone ? <Badge tone="danger">gone</Badge> : <Badge tone={branch.trackingAhead || branch.trackingBehind ? "warning" : "success"}>↑{branch.trackingAhead} ↓{branch.trackingBehind}</Badge>}
            </>
          ) : (
            <Badge title="This branch does not track a remote branch">no upstream</Badge>
          )}
        </td>
        <td>
          {relative && target && branch.name !== target ? (
            <>
              <Badge tone={relative.merged ? "success" : "warning"}>{relative.merged ? "merged" : "not merged"}</Badge>{" "}
              <span title={`${plural(relative.ahead, "commit")} not in ${target}; missing ${plural(relative.behind, "commit")} from ${target}`}>
                ↑{relative.ahead} ↓{relative.behind}
              </span>
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td>
          <details className="menu">
            <summary aria-label={`Actions for ${branch.name}`}>⋯</summary>
            <div className="menu-panel">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  disabled={action.disabled}
                  title={action.title}
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    void action.run();
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </details>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={5} style={{ padding: 0, background: "var(--bg-subtle)" }}>
            <div style={{ padding: "6px 12px" }} className="muted">
              Commits in {branch.name} that are not in {target ?? "the target"}:
            </div>
            {uniqueCommits ? <CommitList commits={uniqueCommits} emptyText={`Every commit of ${branch.name} is already in ${target}.`} /> : <LoadingBlock label="Loading…" />}
          </td>
        </tr>
      )}
    </>
  );
}
