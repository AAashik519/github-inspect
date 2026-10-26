"use client";

import { Fragment, useState } from "react";
import type { TagInfo } from "@/lib/types";
import { formatDate, shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, EmptyState, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { CreateTagDialog } from "./CreateTagDialog";
import { TagRemoteDialog } from "./TagDialogs";

type Dialog = { kind: "create" } | { kind: "delete" | "checkout" | "push" | "delete-remote"; tag: TagInfo };

function TagMessage({ name }: { name: string }) {
  const { data } = useGitQuery("tags.message", { name });
  return <pre className="output">{data ?? "Loading…"}</pre>;
}

export function TagsView() {
  const { runOperation, select, setView } = useWorkspace();
  const call = useRepoCall();
  const { data: tags, error, reload } = useGitQuery("tags.list", {});
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const needle = search.trim().toLowerCase();
  const visible = (tags ?? []).filter((tag) => !needle || [tag.name, tag.hash, tag.commitSubject, tag.message].some((text) => text.toLowerCase().includes(needle)));

  return (
    <div className="view">
      <div className="view-header">
        <h2>Tags and releases</h2>
        <input type="search" placeholder="Search tag, commit message or hash" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search tags" style={{ width: 280 }} />
        <Button variant="primary" onClick={() => setDialog({ kind: "create" })}>New tag…</Button>
      </div>
      <div className="view-scroll" style={{ padding: 0 }}>
        {error && <div style={{ padding: 14 }}><ErrorNotice error={error} onRetry={reload} /></div>}
        {!tags && !error && <LoadingBlock label="Reading tags…" />}
        {tags && visible.length === 0 && <EmptyState title={tags.length === 0 ? "No tags" : "No tag matches"}>{tags.length === 0 ? "Tag a commit to mark a release." : "Try another search."}</EmptyState>}
        {visible.length > 0 && (
          <table className="table">
            <thead>
              <tr><th>Tag</th><th>Points to</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {visible.map((tag) => (
                <Fragment key={tag.name}>
                  <tr>
                    <td>
                      <button type="button" className="plain-button" onClick={() => setExpanded(expanded === tag.name ? null : tag.name)} aria-expanded={expanded === tag.name}>
                        {expanded === tag.name ? "▾" : "▸"} <strong>{tag.name}</strong>
                      </button>{" "}
                      <Badge tone={tag.type === "annotated" ? "accent" : "neutral"}>{tag.type}</Badge>
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <button type="button" className="plain-button truncate" style={{ maxWidth: "100%" }} onClick={() => { select({ kind: "commit", hash: tag.hash }); setView("graph"); }} title="Show this commit in the graph">
                        <code>{shortHash(tag.hash)}</code> {tag.commitSubject}
                      </button>
                    </td>
                    <td>{tag.date ? formatDate(tag.date) : "—"}{tag.tagger && <div className="muted">{tag.tagger}</div>}</td>
                    <td>
                      <details className="menu">
                        <summary aria-label={`Actions for ${tag.name}`}>⋯</summary>
                        <div className="menu-panel">
                          <button type="button" onClick={() => { select({ kind: "commit", hash: tag.hash }); setView("graph"); }}>Show commit in graph</button>
                          <button type="button" onClick={() => setDialog({ kind: "checkout", tag })}>Check out (detached HEAD)…</button>
                          <button type="button" onClick={() => setDialog({ kind: "push", tag })}>Push to remote…</button>
                          <button type="button" onClick={() => setDialog({ kind: "delete", tag })}>Delete local tag…</button>
                          <button type="button" onClick={() => setDialog({ kind: "delete-remote", tag })}>Delete from remote…</button>
                        </div>
                      </details>
                    </td>
                  </tr>
                  {expanded === tag.name && (
                    <tr>
                      <td colSpan={4} style={{ background: "var(--bg-subtle)" }}>
                        <div>Full commit hash: <code>{tag.hash}</code></div>
                        {tag.type === "annotated" ? <TagMessage name={tag.name} /> : <p className="muted">Lightweight tag: just a name for the commit, with no message or tagger.</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {dialog?.kind === "create" && <CreateTagDialog onClose={() => setDialog(null)} />}
      {(dialog?.kind === "push" || dialog?.kind === "delete-remote") && <TagRemoteDialog tag={dialog.tag} mode={dialog.kind === "push" ? "push" : "delete"} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete local tag ${dialog.tag.name}?`}
          description={`The tag pointing at ${shortHash(dialog.tag.hash)} is removed from this repository only. A copy on a remote is not touched. Recreate it with: git tag ${dialog.tag.name} ${dialog.tag.hash}`}
          confirmLabel="Delete tag"
          isDangerous
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const result = await runOperation(`Delete tag ${dialog.tag.name}`, () => call("tags.delete", { name: dialog.tag.name }));
            if (result) setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "checkout" && (
        <ConfirmDialog
          title={`Check out tag ${dialog.tag.name}?`}
          description="HEAD will be detached at the tagged commit. Commits you make there belong to no branch unless you create one."
          confirmLabel="Check out detached"
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const result = await runOperation(`Checkout tag ${dialog.tag.name}`, () => call("tags.checkout", { name: dialog.tag.name }));
            if (result) setDialog(null);
          }}
        />
      )}
    </div>
  );
}
