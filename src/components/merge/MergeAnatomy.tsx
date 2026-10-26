"use client";

import { plural, shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { Badge, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { DivergenceDiagram } from "@/components/shared/DivergenceDiagram";
import { MergeRelationship } from "./MergeRelationship";

/** Explains a merge commit: which histories it joins, where they diverged, and what is confirmed vs inferred. */
export function MergeAnatomy({ hash }: { hash: string }) {
  const { select } = useWorkspace();
  const { data, error, reload } = useGitQuery("merge.anatomy", { hash });
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return <LoadingBlock label="Analysing merge…" />;

  const lines = data.parents.map((parent, index) => ({
    label: parent.refs[0] ?? `${index === 0 ? "first" : "parent " + (index + 1)} · ${shortHash(parent.hash)}`,
    count: parent.uniqueCommits,
    colorIndex: index === 0 ? 0 : index + 1,
  }));

  return (
    <div className="card">
      <div className="card-header">
        Merge anatomy <Badge tone="merge">{data.parents.length} parents</Badge>
      </div>
      <div className="card-body">
        <MergeRelationship hash={data.hash} relationship={data.relationship} />
        <DivergenceDiagram base={data.mergeBase ? shortHash(data.mergeBase) : null} lines={lines} mergeLabel={shortHash(data.hash)} />
        <div>
          <strong>Confirmed from Git history</strong>
          <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
            <li>
              <strong>First parent</strong> <code>{shortHash(data.parents[0].hash)}</code> is the line of history that received the merge (it was checked out when the merge ran). {data.parents[0].refs.length > 0 && <>Currently at: {data.parents[0].refs.join(", ")}.</>}
            </li>
            {data.parents.slice(1).map((parent, index) => (
              <li key={parent.hash}>
                <strong>Parent {index + 2}</strong> <code>{shortHash(parent.hash)}</code> “{parent.subject}” was merged in — it brought {plural(parent.uniqueCommits, "commit")} that were not on the other parent
                {parent.refs.length > 0 && <>; branch/tag now pointing there: {parent.refs.join(", ")}</>}.
              </li>
            ))}
            <li>
              {data.mergeBase ? (
                <>
                  The histories diverged at <button type="button" className="button button-ghost button-small" onClick={() => select({ kind: "commit", hash: data.mergeBase! })}>{shortHash(data.mergeBase)}</button> “{data.mergeBaseSubject}”.
                </>
              ) : (
                "The parents share no common ancestor (unrelated histories)."
              )}
            </li>
            {data.branchesContaining.length > 0 && <li>Contained in: {data.branchesContaining.join(", ")}.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
