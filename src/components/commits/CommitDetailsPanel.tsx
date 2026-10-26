"use client";

import { formatDate, plural, shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { Badge, ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { MergeAnatomy } from "@/components/merge/MergeAnatomy";
import { DiffViewer } from "@/components/shared/DiffViewer";
import { FileChangeList } from "@/components/shared/FileChangeList";
import { CommitActions } from "./CommitActions";

export function CommitDetailsPanel({ hash }: { hash: string }) {
  const { select } = useWorkspace();
  const { data: commit, error, reload } = useGitQuery("commit.details", { hash });

  if (error) return <div style={{ padding: 12 }}><ErrorNotice error={error} onRetry={reload} /></div>;
  if (!commit) return <LoadingBlock label="Loading commit…" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <div>
        <h3 style={{ fontSize: 15 }}>{commit.subject}</h3>
        {commit.body && <pre className="output" style={{ maxHeight: 180 }}>{commit.body}</pre>}
      </div>

      <div className="toolbar">
        {commit.isMerge && <Badge tone="merge">merge commit · {commit.parents.length} parents</Badge>}
        {commit.parents.length === 0 && <Badge>root commit</Badge>}
        {commit.tags.map((tag) => <Badge key={tag} tone="warning">🏷 {tag}</Badge>)}
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0 }}>
        <dt className="muted">Hash</dt>
        <dd style={{ margin: 0 }}>
          <code style={{ wordBreak: "break-all" }}>{commit.hash}</code>{" "}
          <button type="button" className="button button-ghost button-small" onClick={() => void navigator.clipboard?.writeText(commit.hash)}>Copy</button>
        </dd>
        <dt className="muted">Author</dt>
        <dd style={{ margin: 0 }}>{commit.authorName} &lt;{commit.authorEmail}&gt;<br /><span className="muted">{formatDate(commit.authorDate)}</span></dd>
        {(commit.committerName !== commit.authorName || commit.committerDate !== commit.authorDate) && (
          <>
            <dt className="muted">Committer</dt>
            <dd style={{ margin: 0 }}>{commit.committerName} &lt;{commit.committerEmail}&gt;<br /><span className="muted">{formatDate(commit.committerDate)}</span></dd>
          </>
        )}
        <dt className="muted">{commit.parents.length === 1 ? "Parent" : "Parents"}</dt>
        <dd style={{ margin: 0 }}>
          {commit.parentSummaries.length === 0 ? <span className="muted">none</span> : commit.parentSummaries.map((parent, index) => (
            <div key={parent.hash}>
              <button type="button" className="button button-ghost button-small" onClick={() => select({ kind: "commit", hash: parent.hash })} title="Open parent commit">
                <code>{shortHash(parent.hash)}</code>
              </button>{" "}
              {commit.isMerge && <span className="muted">{index === 0 ? "(received the merge) " : "(merged in) "}</span>}
              {parent.subject}
            </div>
          ))}
        </dd>
        <dt className="muted">On branches</dt>
        <dd style={{ margin: 0 }}>
          {commit.branches.length === 0 ? <span className="muted">no branch contains this commit</span> : commit.branches.map((branch) => <Badge key={branch} tone="accent">{branch}</Badge>)}
        </dd>
      </dl>

      <CommitActions hash={commit.hash} />

      {commit.isMerge && <MergeAnatomy hash={commit.hash} />}

      <div className="card">
        <div className="card-header">
          {plural(commit.files.length, "changed file")}
          <span className="spacer mono">
            <span className="additions">+{commit.totalAdditions}</span> <span className="deletions">−{commit.totalDeletions}</span>
          </span>
        </div>
        {commit.isMerge && <div style={{ padding: "6px 12px" }}><Notice>Changes are shown relative to the first parent: what this merge brought into the receiving branch.</Notice></div>}
        <FileChangeList
          files={commit.files}
          renderDiff={(file) => <DiffViewer target={{ kind: "commit", hash: commit.hash, path: file.path, oldPath: file.oldPath }} />}
        />
      </div>
    </div>
  );
}
