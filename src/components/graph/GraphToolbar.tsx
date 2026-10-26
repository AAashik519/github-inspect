"use client";

import { useState } from "react";
import type { RefInfo } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { hasActiveFilters, NO_FILTERS, type CommitTypeFilter, type GraphFilters } from "./graph-model";
import styles from "./graph.module.css";

interface GraphToolbarProps {
  zoom: number;
  onZoomBy: (factor: number) => void;
  onFit: () => void;
  onReset: () => void;
  refs: RefInfo[];
  hiddenRefs: Set<string>;
  onHiddenRefsChange: (hidden: Set<string>) => void;
  highlightedRefs: string[];
  onHighlightedRefsChange: (fullNames: string[]) => void;
  onGoToRef: (ref: RefInfo) => void;
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
  authors: string[];
  matchCount: number | null;
  isLegendOpen: boolean;
  onToggleLegend: () => void;
}

const REF_GROUPS: { kind: RefInfo["kind"]; title: string }[] = [
  { kind: "local", title: "Local branches" },
  { kind: "remote", title: "Remote-tracking branches" },
  { kind: "tag", title: "Tags" },
];

export function GraphToolbar(props: GraphToolbarProps) {
  const { zoom, refs, hiddenRefs, filters, authors } = props;
  const branchRefs = refs.filter((ref) => ref.kind !== "tag");

  const [branchQuery, setBranchQuery] = useState("");

  function toggleHighlight(fullName: string) {
    const current = props.highlightedRefs;
    props.onHighlightedRefsChange(current.includes(fullName) ? current.filter((name) => name !== fullName) : [...current, fullName]);
  }

  function toggleRef(fullName: string) {
    const next = new Set(hiddenRefs);
    if (next.has(fullName)) next.delete(fullName);
    else next.add(fullName);
    props.onHiddenRefsChange(next);
  }

  return (
    <>
      <div className={styles.toolbar} role="toolbar" aria-label="Graph controls">
        <div className={styles.toolbarGroup} role="group" aria-label="Zoom">
          <Button size="small" onClick={() => props.onZoomBy(1 / 1.25)} aria-label="Zoom out">−</Button>
          <span className="mono muted" style={{ minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
          <Button size="small" onClick={() => props.onZoomBy(1.25)} aria-label="Zoom in">+</Button>
          <Button size="small" onClick={props.onFit} title="Fit the loaded history into the window">Fit</Button>
          <Button size="small" onClick={props.onReset} title="Reset zoom and scroll to HEAD">Reset</Button>
        </div>

        <details className="menu">
          <summary className="button button-secondary button-small">Branches ({refs.length - hiddenRefs.size}/{refs.length})</summary>
          <div className="menu-panel" style={{ maxHeight: 360, overflow: "auto", padding: 8, left: 0, right: "auto" }}>
            <div className="row-actions" style={{ marginBottom: 6 }}>
              <Button size="small" onClick={() => props.onHiddenRefsChange(new Set())}>Show all</Button>
              <Button size="small" onClick={() => props.onHiddenRefsChange(new Set(refs.filter((ref) => ref.kind === "remote").map((ref) => ref.fullName)))}>Local only</Button>
              <Button size="small" onClick={() => props.onHiddenRefsChange(new Set(refs.filter((ref) => ref.kind === "tag").map((ref) => ref.fullName)))}>Hide tags</Button>
            </div>
            {REF_GROUPS.map((group) => {
              const items = refs.filter((ref) => ref.kind === group.kind);
              if (items.length === 0) return null;
              return (
                <fieldset key={group.kind} style={{ border: 0, padding: 0, margin: "0 0 6px" }}>
                  <legend className="muted">{group.title}</legend>
                  {items.map((ref) => (
                    <label key={ref.fullName} className="field-inline" style={{ margin: "2px 0" }}>
                      <input type="checkbox" checked={!hiddenRefs.has(ref.fullName)} onChange={() => toggleRef(ref.fullName)} />
                      <span>{ref.name}</span>
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>
        </details>

        <details className="menu">
          <summary className={`button button-small ${props.highlightedRefs.length > 0 ? "button-primary" : "button-secondary"}`}>
            Highlight{props.highlightedRefs.length > 0 ? ` (${props.highlightedRefs.length})` : ""}
          </summary>
          <div className="menu-panel" style={{ maxHeight: 360, overflow: "auto", padding: 8, left: 0, right: "auto", minWidth: 240 }}>
            <p className="muted" style={{ margin: "0 0 6px" }}>Highlight the history of one or more branches. Pick exactly two to compare them.</p>
            <input
              type="search"
              placeholder="Filter branches…"
              value={branchQuery}
              onChange={(event) => setBranchQuery(event.target.value)}
              aria-label="Filter branch list"
              style={{ width: "100%", marginBottom: 6 }}
            />
            {props.highlightedRefs.length > 0 && (
              <Button size="small" onClick={() => props.onHighlightedRefsChange([])}>Clear highlight</Button>
            )}
            {branchRefs
              .filter((ref) => ref.name.toLowerCase().includes(branchQuery.trim().toLowerCase()))
              .map((ref) => (
                <label key={ref.fullName} className="field-inline" style={{ margin: "2px 0" }}>
                  <input type="checkbox" checked={props.highlightedRefs.includes(ref.fullName)} onChange={() => toggleHighlight(ref.fullName)} />
                  <span>{ref.name}</span>
                </label>
              ))}
          </div>
        </details>

        <label className={styles.toolbarGroup}>
          <span className="muted">Go to tip</span>
          <select
            value=""
            onChange={(event) => {
              const ref = refs.find((entry) => entry.fullName === event.target.value);
              if (ref) props.onGoToRef(ref);
            }}
            aria-label="Go to the latest commit of a branch"
          >
            <option value="">— branch —</option>
            {refs.map((ref) => (
              <option key={ref.fullName} value={ref.fullName}>{ref.name}</option>
            ))}
          </select>
        </label>

        <Button size="small" variant={props.isLegendOpen ? "primary" : "secondary"} onClick={props.onToggleLegend} aria-pressed={props.isLegendOpen}>Legend</Button>
      </div>

      <div className={styles.toolbar} role="group" aria-label="Filters">
        <span className="muted">Filter:</span>
        <select value={filters.author} onChange={(event) => props.onFiltersChange({ ...filters, author: event.target.value })} aria-label="Filter by author">
          <option value="">Any author</option>
          {authors.map((author) => <option key={author} value={author}>{author}</option>)}
        </select>
        <label className={styles.toolbarGroup}>
          <span className="muted">from</span>
          <input type="date" value={filters.since} onChange={(event) => props.onFiltersChange({ ...filters, since: event.target.value })} aria-label="Commits since" />
        </label>
        <label className={styles.toolbarGroup}>
          <span className="muted">to</span>
          <input type="date" value={filters.until} onChange={(event) => props.onFiltersChange({ ...filters, until: event.target.value })} aria-label="Commits until" />
        </label>
        <select value={filters.type} onChange={(event) => props.onFiltersChange({ ...filters, type: event.target.value as CommitTypeFilter })} aria-label="Filter by commit type">
          <option value="all">All commits</option>
          <option value="merge">Merge commits only</option>
          <option value="regular">Regular commits only</option>
        </select>
        {hasActiveFilters(filters) && (
          <>
            <span className="muted">{props.matchCount} match — others are dimmed</span>
            <Button size="small" onClick={() => props.onFiltersChange(NO_FILTERS)}>Clear</Button>
          </>
        )}
        <span className="muted" style={{ marginLeft: "auto" }}>Ctrl/⌘/Shift + click a second commit to compare</span>
      </div>
    </>
  );
}
