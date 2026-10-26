"use client";

import { useEffect, useState } from "react";
import { formatDate, plural, shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { Button } from "@/components/ui/Button";
import { Badge, EmptyState, ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { MergeDialog } from "./MergeDialog";
import { InferredDirection } from "./MergeRelationship";

const PAGE_SIZE = 100;
const MAX_LIMIT = 500;
const SEARCH_DELAY_MS = 250;

interface MergeFilters {
  ref: string;
  since: string;
  until: string;
  query: string;
  order: "newest" | "oldest";
}

const NO_FILTERS: MergeFilters = { ref: "", since: "", until: "", query: "", order: "newest" };

export function MergeHistory() {
  const { selection, select, setView } = useWorkspace();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [isMerging, setIsMerging] = useState(false);
  const [filters, setFilters] = useState<MergeFilters>(NO_FILTERS);
  const [searchText, setSearchText] = useState("");
  const refsQuery = useGitQuery("graph.refs", {});
  const branchRefs = (refsQuery.data ?? []).filter((ref) => ref.kind !== "tag");

  // Debounce typing so each keystroke does not rescan the history.
  useEffect(() => {
    const timer = setTimeout(() => setFilters((current) => (current.query === searchText ? current : { ...current, query: searchText })), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { data, error, reload } = useGitQuery("merge.history", {
    limit,
    skip: 0,
    order: filters.order,
    ...(filters.ref && { ref: filters.ref }),
    ...(filters.since && { since: filters.since }),
    ...(filters.until && { until: filters.until }),
    ...(filters.query && { query: filters.query }),
  });

  const isFiltered = filters.ref !== "" || filters.since !== "" || filters.until !== "" || filters.query !== "";
  const filterRefName = branchRefs.find((ref) => ref.fullName === filters.ref)?.name;

  function updateFilters(change: Partial<MergeFilters>) {
    setFilters((current) => ({ ...current, ...change }));
    setLimit(PAGE_SIZE);
  }

  function locate(hash: string) {
    select({ kind: "commit", hash });
    setView("graph");
  }

  return (
    <div className="view">
      <div className="view-header">
        <h2>Merge History</h2>
        <Button variant="primary" onClick={() => setIsMerging(true)}>
          New merge…
        </Button>
      </div>
      <div className="toolbar" role="group" aria-label="Merge history filters" style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <input type="search" placeholder="Search message, hash or branch…" value={searchText} onChange={(event) => setSearchText(event.target.value)} aria-label="Search merges" style={{ minWidth: 240 }} />
        <select value={filters.ref} onChange={(event) => updateFilters({ ref: event.target.value })} aria-label="Filter by branch">
          <option value="">All branches</option>
          {branchRefs.map((ref) => (
            <option key={ref.fullName} value={ref.fullName}>{ref.name}</option>
          ))}
        </select>
        <label className="field-inline">
          <span className="muted">from</span>
          <input type="date" value={filters.since} onChange={(event) => updateFilters({ since: event.target.value })} aria-label="Merged on or after" />
        </label>
        <label className="field-inline">
          <span className="muted">to</span>
          <input type="date" value={filters.until} onChange={(event) => updateFilters({ until: event.target.value })} aria-label="Merged on or before" />
        </label>
        <select value={filters.order} onChange={(event) => updateFilters({ order: event.target.value as MergeFilters["order"] })} aria-label="Order">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first (chronological)</option>
        </select>
        {isFiltered && (
          <Button
            size="small"
            onClick={() => {
              setSearchText("");
              updateFilters({ ...NO_FILTERS, order: filters.order });
            }}
          >
            Clear filters
          </Button>
        )}
        {data && <span className="muted">{plural(data.total, "merge")}</span>}
      </div>
      <div className="view-scroll">
        <Notice>
          Only merges that created a <strong>merge commit</strong> appear here. Fast-forward merges and squash merges leave no merge commit, and rebased branches get new commit hashes — none of those can be listed as merges. Branch names under “Direction” come from the merge message and are unverified; select a merge to see whether current branches confirm them.
        </Notice>
        {filterRefName && (
          <Notice>
            Showing merges related to <code>{filterRefName}</code> by ancestry: merges it <strong>contains</strong>, and merges elsewhere that <strong>brought its commits in</strong>.
          </Notice>
        )}
        {data?.scanTruncated && <Notice tone="warning">This repository has more than 20,000 merge commits; only the newest 20,000 were searched.</Notice>}
        {error && <ErrorNotice error={error} onRetry={reload} />}
        {!data && !error && <LoadingBlock label="Reading merge commits…" />}
        {data && data.events.length === 0 && (
          <EmptyState title={isFiltered ? "No merges match the filters" : "No merge commits"}>
            {isFiltered ? "Try a wider date range or another branch." : "This repository has no merge commits yet (its history may be linear or merged by fast-forward)."}
          </EmptyState>
        )}
        {data && data.events.length > 0 && (
          <div className="card" style={{ overflow: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Merge commit</th>
                  <th>Message</th>
                  <th>Direction</th>
                  <th>Parents (what it joined)</th>
                  <th>Related branches</th>
                  <th>Files</th>
                  <th>Date</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((event) => (
                  <tr
                    key={event.hash}
                    className={selection?.kind === "commit" && selection.hash === event.hash ? "is-selected" : ""}
                    onClick={() => select({ kind: "commit", hash: event.hash })}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === "Enter") locate(event.hash);
                    }}
                    tabIndex={0}
                    aria-label={`Merge ${shortHash(event.hash)}: ${event.subject}`}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <code>{shortHash(event.hash)}</code>
                      {event.parents.length > 2 && <Badge tone="merge">octopus</Badge>}
                      {event.involvement === "merged-from" && <Badge tone="accent" title={`This merge brought commits from ${filterRefName} into another line of history`}>brought {filterRefName} in</Badge>}
                    </td>
                    <td style={{ maxWidth: 280 }} className="truncate" title={event.subject}>{event.subject}</td>
                    <td>
                      <InferredDirection source={event.inferredSource} target={event.inferredTarget} />
                    </td>
                    <td>
                      {event.parents.map((parent, index) => (
                        <div key={parent}>
                          <span className="muted">{index === 0 ? "parent 1 (received)" : `parent ${index + 1} (merged in)`}:</span> <code>{shortHash(parent)}</code>
                          {event.parentRefs[index].slice(0, 2).map((name) => (
                            <Badge key={name} tone="accent" title="Ref currently pointing at this parent">{name}</Badge>
                          ))}
                        </div>
                      ))}
                    </td>
                    <td>
                      {event.relatedBranches.length === 0 ? <span className="muted">none known</span> : event.relatedBranches.slice(0, 4).map((name) => <Badge key={name}>{name}</Badge>)}
                      {event.relatedBranches.length > 4 && <span className="muted" title={event.relatedBranches.slice(4).join(", ")}> +{event.relatedBranches.length - 4}</span>}
                    </td>
                    <td title="Files changed relative to the first parent">{event.filesChanged ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {formatDate(event.committerDate)}
                      <div className="muted">{event.authorName}</div>
                    </td>
                    <td>
                      <Button
                        size="small"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          locate(event.hash);
                        }}
                      >
                        Locate in graph
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.hasMore && (
          <div>
            <Button onClick={() => setLimit((current) => Math.min(current + PAGE_SIZE, MAX_LIMIT))} disabled={limit >= MAX_LIMIT}>
              Load more ({data.events.length} of {data.total} shown)
            </Button>
            {limit >= MAX_LIMIT && <span className="muted"> Limit of {MAX_LIMIT} reached — narrow the filters to see older merges.</span>}
          </div>
        )}
      </div>
      {isMerging && <MergeDialog onClose={() => setIsMerging(false)} />}
    </div>
  );
}
