"use client";

import { describeDivergence, plural, shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { Button } from "@/components/ui/Button";
import { Badge, ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { DiffViewer } from "@/components/shared/DiffViewer";
import { FileChangeList } from "@/components/shared/FileChangeList";

/** Compares two commits chosen in the graph: what differs between them and how their histories relate. */
export function CompareCommitsPanel({ base, head }: { base: string; head: string }) {
  const { select } = useWorkspace();
  const files = useGitQuery("compare.revisions", { base, head });
  const relation = useGitQuery("compare.branches", { source: head, target: base });
  const baseDetails = useGitQuery("commit.details", { hash: base });
  const headDetails = useGitQuery("commit.details", { hash: head });

  const error = files.error ?? relation.error;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <div className="toolbar">
        <Button size="small" onClick={() => select({ kind: "compare", base: head, head: base })}>⇄ Swap</Button>
        <Button size="small" onClick={() => select({ kind: "commit", hash: head })}>Back to single commit</Button>
      </div>
      <div className="card">
        <div className="card-body">
          <div><Badge tone="accent">Base</Badge> <code>{shortHash(baseDetails.data?.hash ?? base)}</code> {baseDetails.data?.subject}</div>
          <div><Badge tone="accent">Compared</Badge> <code>{shortHash(headDetails.data?.hash ?? head)}</code> {headDetails.data?.subject}</div>
        </div>
      </div>
      {error && <ErrorNotice error={error} />}
      {relation.data && (
        <Notice>{describeDivergence(shortHash(relation.data.sourceHash), shortHash(relation.data.targetHash), relation.data.ahead, relation.data.behind)}</Notice>
      )}
      {!files.data && !error && <LoadingBlock label="Comparing…" />}
      {files.data && (
        <div className="card">
          <div className="card-header">{plural(files.data.files.length, "file")} differ between the two commits</div>
          <FileChangeList files={files.data.files} renderDiff={(file) => <DiffViewer target={{ kind: "range", base, head, path: file.path, oldPath: file.oldPath }} />} />
        </div>
      )}
    </div>
  );
}
