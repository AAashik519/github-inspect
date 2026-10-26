"use client";

import { useState } from "react";
import { shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

type Mode = "soft" | "mixed" | "hard";

const MODES: { id: Mode; title: string; description: string }[] = [
  { id: "soft", title: "Soft", description: "Move the branch only. All changes since that commit stay staged." },
  { id: "mixed", title: "Mixed", description: "Move the branch and unstage changes. Your files are untouched." },
  { id: "hard", title: "Hard", description: "Move the branch and make the working tree match that commit. Uncommitted work is lost." },
];

const HARD_CONFIRMATION = "hard reset";

export function ResetDialog({ hash, onClose }: { hash: string; onClose: () => void }) {
  const { runOperation } = useWorkspace();
  const call = useRepoCall();
  const status = useGitQuery("repo.status", {});
  const [mode, setMode] = useState<Mode>("mixed");
  const [typedText, setTypedText] = useState("");

  const branch = status.data?.head.branch;
  const dirtyCount = status.data?.files.filter((file) => !file.isUntracked).length ?? 0;
  const upstream = status.data?.upstream;
  const canRun = Boolean(status.data) && (mode !== "hard" || typedText === HARD_CONFIRMATION);

  async function run() {
    const result = await runOperation(`Reset (${mode}) to ${shortHash(hash)}`, () => call("reset.run", { target: hash, mode, confirmHard: mode === "hard" }));
    if (result) onClose();
  }

  return (
    <Dialog title={`Reset ${branch ?? "HEAD"} to ${shortHash(hash)}`} description="Moves the current branch pointer to this commit. Commits after it become unreachable from the branch." onClose={onClose}>
      <div role="radiogroup" aria-label="Reset mode" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {MODES.map((entry) => (
          <label key={entry.id} className="field-inline" style={{ alignItems: "flex-start" }}>
            <input type="radio" name="reset-mode" checked={mode === entry.id} onChange={() => setMode(entry.id)} />
            <span>
              <strong>{entry.title}</strong>
              <br />
              <span className="muted">{entry.description}</span>
            </span>
          </label>
        ))}
      </div>
      <Notice tone="warning">
        This rewrites the branch history. The previous commit remains available in the reflog (Operations → Reflog) and its hash is shown after the reset.
        {upstream && !upstream.gone && ` ${branch} tracks ${upstream.name}; pushing a rewound branch later needs a force push.`}
      </Notice>
      {mode === "hard" && (
        <>
          <Notice tone="danger">
            <strong>Hard reset is destructive.</strong> {dirtyCount > 0 ? `${dirtyCount} file(s) with uncommitted changes will be overwritten and cannot be recovered.` : "Any uncommitted changes would be overwritten and cannot be recovered."}
          </Notice>
          <label className="field">
            <span>
              Type <code>{HARD_CONFIRMATION}</code> to confirm
            </span>
            <input value={typedText} onChange={(event) => setTypedText(event.target.value)} autoComplete="off" />
          </label>
        </>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={mode === "hard" ? "danger" : "primary"} disabled={!canRun} onClick={run}>
          Reset ({mode})
        </Button>
      </div>
    </Dialog>
  );
}
