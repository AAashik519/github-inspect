"use client";

import { useMemo, useState } from "react";
import { composeResolution, hasConflictMarkers, parseConflictMarkers, type ConflictChoice, type ConflictSegment } from "@/lib/conflicts/markers";
import type { ConflictContent, OperationResult } from "@/lib/types";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

const TYPE_EXPLANATION: Record<ConflictContent["type"], string> = {
  "both-modified": "Both sides changed the same part of this file.",
  "both-added": "Both sides added a file with this name but different content.",
  "deleted-by-us": "The current branch deleted this file, but the incoming side modified it.",
  "deleted-by-them": "The incoming side deleted this file, but the current branch modified it.",
  "both-deleted": "Both sides deleted this file.",
  other: "Unusual conflict type.",
};

type Tab = "blocks" | "result" | "three-way";

/** Resolves one conflicted file. Nothing is written to disk until "Mark as resolved" is pressed. */
export function ConflictResolver({ path, onResolved }: { path: string; onResolved: () => void }) {
  const { data, error, reload } = useGitQuery("conflicts.get", { path });
  if (error) return <div style={{ padding: 12 }}><ErrorNotice error={error} onRetry={reload} /></div>;
  if (!data) return <LoadingBlock label="Loading conflict…" />;
  return <ResolverBody key={path} content={data} onResolved={onResolved} />;
}

function ResolverBody({ content, onResolved }: { content: ConflictContent; onResolved: () => void }) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();
  const parsed = useMemo(() => parseConflictMarkers(content.working ?? ""), [content.working]);
  const conflicts = parsed.segments.filter((segment): segment is ConflictSegment => segment.kind === "conflict");

  const [choices, setChoices] = useState<Record<number, ConflictChoice | undefined>>({});
  const [manualText, setManualText] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("blocks");
  const [pendingDelete, setPendingDelete] = useState(false);

  const composed = composeResolution(parsed.segments, choices);
  const resultText = manualText ?? composed;
  const unresolved = hasConflictMarkers(resultText);
  const isWholeFileConflict = content.isBinary || content.working === null;

  function choose(id: number, choice: ConflictChoice) {
    setManualText(null);
    setChoices((current) => ({ ...current, [id]: choice }));
  }

  function chooseAll(choice: ConflictChoice) {
    setManualText(null);
    setChoices(Object.fromEntries(conflicts.map((conflict) => [conflict.id, choice])));
  }

  async function finish(label: string, task: () => Promise<OperationResult>) {
    const result = await runOperation(label, task);
    if (result) onResolved();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12 }}>
      <div className="toolbar">
        <h3 className="mono" style={{ fontSize: 14 }}>{content.path}</h3>
        <Badge tone="danger">conflict</Badge>
      </div>
      <Notice tone="warning">
        {TYPE_EXPLANATION[content.type]} <br />
        <span>
          <strong>Current</strong> = {content.oursLabel}. <strong>Incoming</strong> = {content.theirsLabel}.
        </span>
      </Notice>

      {isWholeFileConflict ? (
        <>
          <Notice>
            {content.isBinary ? "This file is binary or too large to merge line by line." : "The file does not exist on one side, so there is nothing to merge line by line."} Choose which version to keep.
          </Notice>
          <div className="row-actions">
            <Button disabled={content.type === "deleted-by-us" || content.type === "both-deleted"} onClick={() => void finish(`Use current version of ${content.path}`, () => call("conflicts.takeSide", { path: content.path, side: "ours" }))}>
              Keep current version
            </Button>
            <Button disabled={content.type === "deleted-by-them" || content.type === "both-deleted"} onClick={() => void finish(`Use incoming version of ${content.path}`, () => call("conflicts.takeSide", { path: content.path, side: "theirs" }))}>
              Keep incoming version
            </Button>
            <Button variant="danger" onClick={() => setPendingDelete(true)}>Delete the file</Button>
          </div>
        </>
      ) : (
        <>
          <div className="toolbar" role="tablist">
            {(["blocks", "result", "three-way"] as Tab[]).map((entry) => (
              <Button key={entry} role="tab" aria-selected={tab === entry} size="small" variant={tab === entry ? "primary" : "secondary"} onClick={() => setTab(entry)}>
                {entry === "blocks" ? `Conflicts (${conflicts.length})` : entry === "result" ? "Result" : "Side by side"}
              </Button>
            ))}
            <span className="spacer muted" style={{ marginLeft: "auto" }}>
              {conflicts.length === 0 ? "No conflict markers found in the file" : `${conflicts.filter((conflict) => choices[conflict.id]).length} of ${conflicts.length} decided`}
            </span>
          </div>

          {tab === "blocks" && (
            <>
              <div className="row-actions">
                <Button size="small" onClick={() => chooseAll("ours")}>Accept all current</Button>
                <Button size="small" onClick={() => chooseAll("theirs")}>Accept all incoming</Button>
                <Button size="small" onClick={() => chooseAll("both")}>Accept all both</Button>
              </div>
              {parsed.isMalformed && <Notice tone="danger">A conflict block in this file is incomplete. Edit the Result manually.</Notice>}
              {conflicts.map((conflict) => (
                <ConflictBlock key={conflict.id} conflict={conflict} choice={choices[conflict.id]} oursLabel={content.oursLabel} theirsLabel={content.theirsLabel} onChoose={(choice) => choose(conflict.id, choice)} />
              ))}
            </>
          )}

          {tab === "result" && (
            <>
              <p className="muted">This is exactly what will be saved. You can edit it freely; choosing a side in the Conflicts tab afterwards replaces manual edits.</p>
              <textarea className="mono" rows={18} value={resultText} onChange={(event) => setManualText(event.target.value)} spellCheck={false} aria-label="Resolved file content" />
            </>
          )}

          {tab === "three-way" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              {([["Current", content.ours], ["Common ancestor", content.base], ["Incoming", content.theirs]] as const).map(([title, text]) => (
                <div key={title}>
                  <strong>{title}</strong>
                  <pre className="output" style={{ maxHeight: 420 }}>{text ?? "(file does not exist in this version)"}</pre>
                </div>
              ))}
            </div>
          )}

          {unresolved && <Notice tone="warning">Conflict markers (<code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code>) remain. Decide every block before marking the file as resolved.</Notice>}
          <div className="row-actions">
            <Button variant="primary" disabled={unresolved} onClick={() => void finish(`Mark ${content.path} resolved`, () => call("conflicts.resolve", { path: content.path, content: resultText }))}>
              Mark as resolved
            </Button>
            <Button onClick={() => void runOperation(`Restore conflict in ${content.path}`, () => call("conflicts.restore", { path: content.path })).then(() => { setChoices({}); setManualText(null); })} title="Recreate the original conflict markers from Git's three stored versions">
              Restore original conflict
            </Button>
          </div>
        </>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${content.path}?`}
          description="Resolves the conflict by removing the file from the working tree and the index."
          confirmLabel="Delete file"
          isDangerous
          onCancel={() => setPendingDelete(false)}
          onConfirm={async () => {
            await finish(`Resolve ${content.path} by deleting it`, () => call("conflicts.takeSide", { path: content.path, side: "delete" }));
            setPendingDelete(false);
          }}
        />
      )}
    </div>
  );
}

function ConflictBlock({ conflict, choice, oursLabel, theirsLabel, onChoose }: { conflict: ConflictSegment; choice: ConflictChoice | undefined; oursLabel: string; theirsLabel: string; onChoose: (choice: ConflictChoice) => void }) {
  const columns = conflict.base === null ? 2 : 3;
  return (
    <div className="card">
      <div className="card-header">
        Conflict {conflict.id + 1} {choice && <Badge tone="success">{choice === "ours" ? "current" : choice === "theirs" ? "incoming" : choice}</Badge>}
        <span className="spacer row-actions">
          <Button size="small" variant={choice === "ours" ? "primary" : "secondary"} onClick={() => onChoose("ours")}>Accept current</Button>
          <Button size="small" variant={choice === "theirs" ? "primary" : "secondary"} onClick={() => onChoose("theirs")}>Accept incoming</Button>
          <Button size="small" variant={choice === "both" ? "primary" : "secondary"} onClick={() => onChoose("both")}>Accept both</Button>
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        <Side title={`Current · ${conflict.oursLabel || oursLabel}`} text={conflict.ours} isChosen={choice === "ours" || choice === "both"} />
        {conflict.base !== null && <Side title="Common ancestor" text={conflict.base} isChosen={false} />}
        <Side title={`Incoming · ${conflict.theirsLabel || theirsLabel}`} text={conflict.theirs} isChosen={choice === "theirs" || choice === "both"} />
      </div>
    </div>
  );
}

function Side({ title, text, isChosen }: { title: string; text: string; isChosen: boolean }) {
  return (
    <div style={{ borderRight: "1px solid var(--border)", minWidth: 0, background: isChosen ? "var(--add-bg)" : undefined }}>
      <div className="muted truncate" style={{ padding: "4px 8px", fontSize: 11 }}>{title}</div>
      <pre className="mono" style={{ margin: 0, padding: "0 8px 8px", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text === "" ? "(empty)" : text}</pre>
    </div>
  );
}
