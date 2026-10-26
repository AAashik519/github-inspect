"use client";

import { useState } from "react";
import { plural } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { Button } from "@/components/ui/Button";
import { Badge, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import styles from "@/components/layout/layout.module.css";
import { CommitList } from "@/components/shared/CommitList";

/** Search by commit hash, message, author or branch/tag name across the whole history (done by Git on the server). */
export function CommitSearch() {
  const { select, setView } = useWorkspace();
  const [query, setQuery] = useState<string | null>(null);
  const { data, error, reload } = useGitQuery("graph.search", query ? { query } : null);

  function open(hash: string) {
    select({ kind: "commit", hash });
    setView("graph");
    setQuery(null);
  }

  return (
    <div className={styles.searchBox}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = String(new FormData(event.currentTarget).get("query")).trim();
          setQuery(value || null);
        }}
      >
        <input name="query" type="search" placeholder="Search commits: hash, message, author, branch" aria-label="Search commits" />
      </form>
      {query && (
        <div className={styles.searchResults} role="region" aria-label="Search results">
          <div className="toolbar" style={{ padding: "6px 12px" }}>
            <strong>“{query}”</strong>
            {data && <span className="muted">{plural(data.commits.length, "commit")}, {plural(data.refs.length, "branch/tag", "branches/tags")}</span>}
            <Button size="small" variant="ghost" onClick={() => setQuery(null)} style={{ marginLeft: "auto" }}>Close</Button>
          </div>
          {error && <ErrorNotice error={error} onRetry={reload} />}
          {!data && !error && <LoadingBlock label="Searching…" />}
          {data?.refs.map((ref) => (
            <button key={ref.fullName} type="button" className="list-item" onClick={() => open(ref.hash)}>
              <Badge tone={ref.kind === "tag" ? "warning" : "accent"}>{ref.kind}</Badge>
              <span>{ref.name}</span>
              <span className="muted">— latest commit</span>
            </button>
          ))}
          {data && <CommitList commits={data.commits} onSelect={open} emptyText="No commits match." />}
        </div>
      )}
    </div>
  );
}
