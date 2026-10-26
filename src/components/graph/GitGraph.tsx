"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeBranchFocus } from "@/lib/graph/focus";
import { layoutGraph, type LayoutCommit } from "@/lib/graph/layout";
import { shortHash } from "@/lib/format";
import type { CommitSummary, RefInfo } from "@/lib/types";
import { useGitQuery } from "@/hooks/useGitQuery";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { BASE_LANE_WIDTH, BASE_ROW_HEIGHT, describeRelationships, hasActiveFilters, matchesFilters, MAX_ZOOM, MIN_TEXT_ZOOM, MIN_ZOOM, NO_FILTERS, WORKTREE_HASH, type GraphFilters } from "./graph-model";
import { GraphLegend } from "./GraphLegend";
import { GraphRowView } from "./GraphRowView";
import { GraphToolbar } from "./GraphToolbar";
import { useGraphCommits } from "./useGraphCommits";
import styles from "./graph.module.css";

const HEADER_HEIGHT = 26;
const OVERSCAN_ROWS = 8;
const TEXT_COLUMNS_WIDTH = [320, 150, 110, 80];
const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

export function GitGraph() {
  const { selection, select, setView, openComparison } = useWorkspace();
  const refsQuery = useGitQuery("graph.refs", {});
  const statusQuery = useGitQuery("repo.status", {});
  const refs = useMemo(() => refsQuery.data ?? [], [refsQuery.data]);

  const [hiddenRefs, setHiddenRefs] = useState<Set<string>>(new Set());
  const [highlightedRefs, setHighlightedRefs] = useState<string[]>([]);
  const [filters, setFilters] = useState<GraphFilters>(NO_FILTERS);
  const [zoom, setZoom] = useState(1);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600, width: 900 });
  const [revealNonce, setRevealNonce] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);

  const visibleRefNames = hiddenRefs.size > 0 ? refs.filter((ref) => !hiddenRefs.has(ref.fullName)).map((ref) => ref.fullName) : undefined;
  const history = useGraphCommits(visibleRefNames);
  const { commits } = history;

  const head = statusQuery.data?.head;
  const headHash = head?.hash;
  const uncommittedCount = statusQuery.data?.files.length ?? 0;

  const commitsByHash = useMemo(() => new Map(commits.map((commit) => [commit.hash, commit])), [commits]);
  const refsByHash = useMemo(() => {
    const map = new Map<string, RefInfo[]>();
    for (const ref of refs) map.set(ref.hash, [...(map.get(ref.hash) ?? []), ref]);
    return map;
  }, [refs]);
  const authors = useMemo(() => [...new Set(commits.map((commit) => commit.authorName))].sort((a, b) => a.localeCompare(b)), [commits]);

  const layout = useMemo(() => {
    const input: LayoutCommit[] = commits.map((commit) => ({ hash: commit.hash, parents: commit.parents }));
    if (uncommittedCount > 0 && headHash && commitsByHash.has(headHash)) input.unshift({ hash: WORKTREE_HASH, parents: [headHash] });
    return layoutGraph(input);
  }, [commits, commitsByHash, uncommittedCount, headHash]);

  const focus = useMemo(() => {
    // Keep the order in which branches were picked: the first is "A" in a comparison.
    const tips = highlightedRefs.map((fullName) => refs.find((ref) => ref.fullName === fullName)).filter((ref): ref is RefInfo => Boolean(ref));
    return computeBranchFocus(tips, commits);
  }, [highlightedRefs, refs, commits]);
  const comparison = focus?.comparison ?? null;

  const selectedHash = selection?.kind === "commit" ? selection.hash : selection?.kind === "compare" ? selection.head : null;
  const compareBaseHash = selection?.kind === "compare" ? selection.base : null;
  const selectedCommit = selectedHash ? commitsByHash.get(selectedHash) : undefined;
  const selectedParents = useMemo(() => new Set(selectedCommit?.parents ?? []), [selectedCommit]);
  const matchCount = hasActiveFilters(filters) ? commits.filter((commit) => matchesFilters(commit, filters)).length : null;

  const rowHeight = BASE_ROW_HEIGHT * zoom;
  const graphWidth = (layout.laneCount * BASE_LANE_WIDTH + 20) * zoom;
  const showText = zoom >= MIN_TEXT_ZOOM;
  const gridTemplate = showText ? `${graphWidth}px ${TEXT_COLUMNS_WIDTH.map((width, index) => (index === 0 ? `minmax(${width}px, 1fr)` : `${width}px`)).join(" ")}` : `${graphWidth}px`;
  const minWidth = graphWidth + (showText ? TEXT_COLUMNS_WIDTH.reduce((sum, width) => sum + width, 0) : 0);
  const totalHeight = layout.rows.length * rowHeight;

  const firstVisible = Math.max(0, Math.floor((viewport.scrollTop - HEADER_HEIGHT) / rowHeight) - OVERSCAN_ROWS);
  const lastVisible = Math.min(layout.rows.length, Math.ceil((viewport.scrollTop + viewport.height) / rowHeight) + OVERSCAN_ROWS);

  function revealIndex(index: number) {
    const element = viewportRef.current;
    if (!element) return;
    const top = index * rowHeight;
    const isVisible = top >= element.scrollTop && top + rowHeight <= element.scrollTop + element.clientHeight - HEADER_HEIGHT - rowHeight;
    if (!isVisible) element.scrollTo({ top: Math.max(0, top - element.clientHeight / 3) });
  }

  // Track the viewport size, and allow Ctrl/⌘ + wheel zoom (needs a non-passive listener to cancel browser zoom).
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport((current) => ({ ...current, height: element.clientHeight, width: element.clientWidth })));
    observer.observe(element);
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((current) => clampZoom(current * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  // Scroll to a commit that was selected elsewhere (search, merge history, branch list), loading more history if needed.
  const pendingReveal = useRef<string | null>(selectedHash);
  const lastSelectedHash = useRef(selectedHash);
  useEffect(() => {
    if (selectedHash !== lastSelectedHash.current) {
      lastSelectedHash.current = selectedHash;
      pendingReveal.current = selectedHash;
    }
    const target = pendingReveal.current;
    if (!target) return;
    const index = layout.indexByHash.get(target);
    if (index !== undefined) {
      revealIndex(index);
      pendingReveal.current = null;
    } else if (history.hasMore) void history.loadMore();
    else if (!history.isLoading) pendingReveal.current = null;
    // revealIndex/loadMore are recreated each render; the inputs that matter are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHash, layout, history.hasMore, history.isLoading, revealNonce, zoom]);

  function goToCommit(hash: string) {
    pendingReveal.current = hash;
    select({ kind: "commit", hash });
    setRevealNonce((current) => current + 1);
  }

  function goToRef(ref: RefInfo) {
    if (hiddenRefs.has(ref.fullName)) {
      const next = new Set(hiddenRefs);
      next.delete(ref.fullName);
      setHiddenRefs(next);
    }
    goToCommit(ref.hash);
  }

  function selectRow(hash: string, isCompareClick: boolean) {
    if (hash === WORKTREE_HASH) return setView("source-control");
    if (isCompareClick && selectedHash && selectedHash !== hash) return select({ kind: "compare", base: selection?.kind === "compare" ? selection.base : selectedHash, head: hash });
    select({ kind: "commit", hash });
  }

  function moveSelection(step: number) {
    const rows = layout.rows.filter((row) => row.hash !== WORKTREE_HASH);
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row.hash === selectedHash);
    const next = Math.min(rows.length - 1, Math.max(0, current === -1 ? 0 : current + step));
    goToCommit(rows[next].hash);
  }

  function fitToScreen() {
    const available = viewport.height - HEADER_HEIGHT;
    setZoom(clampZoom(available / Math.max(1, layout.rows.length * BASE_ROW_HEIGHT)));
    viewportRef.current?.scrollTo({ top: 0 });
  }

  function resetView() {
    setZoom(1);
    const headIndex = headHash ? layout.indexByHash.get(headHash) : undefined;
    viewportRef.current?.scrollTo({ top: headIndex !== undefined ? Math.max(0, headIndex * BASE_ROW_HEIGHT - 120) : 0 });
  }

  const selectedRow = selectedHash ? layout.rows[layout.indexByHash.get(selectedHash) ?? -1] : undefined;
  const isDimmed = (commit: CommitSummary | undefined) => {
    if (!commit) return false;
    if (focus && !focus.inHistory.has(commit.hash) && !focus.relatedMerges.has(commit.hash)) return true;
    return hasActiveFilters(filters) && !matchesFilters(commit, filters);
  };

  return (
    <div className={styles.wrapper}>
      <GraphToolbar
        zoom={zoom}
        onZoomBy={(factor) => setZoom((current) => clampZoom(current * factor))}
        onFit={fitToScreen}
        onReset={resetView}
        refs={refs}
        hiddenRefs={hiddenRefs}
        onHiddenRefsChange={setHiddenRefs}
        highlightedRefs={highlightedRefs}
        onHighlightedRefsChange={setHighlightedRefs}
        onGoToRef={goToRef}
        filters={filters}
        onFiltersChange={setFilters}
        authors={authors}
        matchCount={matchCount}
        isLegendOpen={isLegendOpen}
        onToggleLegend={() => setIsLegendOpen((open) => !open)}
      />
      {isLegendOpen && <GraphLegend />}
      {comparison && (
        <div className={styles.comparisonBar} role="status">
          <span className={styles.compareKeyA}>A</span> <strong>{comparison.a}</strong>: {comparison.onlyA} only here
          <span className={styles.compareKeyB}>B</span> <strong>{comparison.b}</strong>: {comparison.onlyB} only here
          <span className="muted">· {comparison.shared} shared</span>
          <span>
            {comparison.divergedAt ? (
              <>
                · diverged at{" "}
                <button type="button" className="button button-ghost button-small" onClick={() => goToCommit(comparison.divergedAt!)}>
                  <code>{shortHash(comparison.divergedAt)}</code>
                </button>
              </>
            ) : (
              <span className="muted">· no shared commit in the loaded history</span>
            )}
          </span>
          {history.hasMore && <span className="muted">(counts cover loaded commits only)</span>}
          <Button size="small" onClick={() => openComparison({ source: comparison.a, target: comparison.b })}>Full comparison</Button>
        </div>
      )}
      {focus && !comparison && focus.relatedMerges.size > 0 && (
        <div className={styles.explanation}>
          {focus.relatedMerges.size} merge{focus.relatedMerges.size === 1 ? "" : "s"} outside the highlighted history brought its commits into other lines; they stay visible with a dashed ring.
        </div>
      )}
      {selectedRow && selectedCommit && (
        <div className={styles.explanation}>
          <strong>{selectedCommit.subject}</strong> — {describeRelationships(selectedRow, selectedCommit, 0).split("\n").join(" ")}
        </div>
      )}

      <div
        ref={viewportRef}
        className={styles.viewport}
        tabIndex={0}
        role="listbox"
        aria-label="Commit graph"
        aria-activedescendant={selectedHash ? `graph-row-${selectedHash}` : undefined}
        onScroll={(event) => {
          // Read before queuing the update: currentTarget is cleared once the event handler returns.
          const { scrollTop } = event.currentTarget;
          setViewport((current) => ({ ...current, scrollTop }));
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") moveSelection(1);
          else if (event.key === "ArrowUp") moveSelection(-1);
          else if (event.key === "PageDown") moveSelection(10);
          else if (event.key === "PageUp") moveSelection(-10);
          else return;
          event.preventDefault();
        }}
      >
        {history.error && <div style={{ padding: 14 }}><ErrorNotice error={history.error} /></div>}
        {history.isLoading && <LoadingBlock label="Reading history…" />}
        {!history.isLoading && !history.error && commits.length === 0 && (
          <EmptyState title={visibleRefNames ? "No commits for the selected branches" : "No commits yet"}>
            {visibleRefNames ? "Show more branches using the Branches menu." : "Create the first commit in Source Control to start the graph."}
          </EmptyState>
        )}
        {commits.length > 0 && (
          <>
            <div className={styles.header} style={{ gridTemplateColumns: gridTemplate, minWidth }}>
              <span style={{ paddingLeft: 8 }}>Graph</span>
              {showText && (
                <>
                  <span style={{ paddingLeft: 6 }}>Branches / message</span>
                  <span style={{ padding: "0 8px" }}>Author</span>
                  <span style={{ padding: "0 8px" }}>Date</span>
                  <span style={{ padding: "0 8px" }}>Hash</span>
                </>
              )}
            </div>
            <div className={styles.canvas} style={{ height: totalHeight, minWidth }}>
              {layout.rows.slice(firstVisible, lastVisible).map((row, offset) => {
                const index = firstVisible + offset;
                const commit = row.hash === WORKTREE_HASH ? null : (commitsByHash.get(row.hash) ?? null);
                return (
                  <GraphRowView
                    key={row.hash}
                    row={row}
                    commit={commit}
                    refs={refsByHash.get(row.hash) ?? []}
                    top={index * rowHeight}
                    zoom={zoom}
                    laneCount={layout.laneCount}
                    gridTemplate={gridTemplate}
                    showText={showText}
                    isSelected={row.hash === selectedHash}
                    isParentOfSelected={selectedParents.has(row.hash)}
                    isCompareBase={row.hash === compareBaseHash}
                    isDimmed={isDimmed(commit ?? undefined)}
                    comparisonSide={comparison?.sideByHash.get(row.hash) ?? null}
                    isRelatedMerge={focus?.relatedMerges.has(row.hash) ?? false}
                    isHead={row.hash === headHash}
                    uncommittedCount={uncommittedCount}
                    onSelect={selectRow}
                  />
                );
              })}
            </div>
            {history.hasMore && (
              <div className={styles.loadMore}>
                <Button onClick={() => void history.loadMore()} disabled={history.isLoadingMore}>
                  {history.isLoadingMore ? "Loading…" : `Load older commits (${commits.length} loaded)`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
