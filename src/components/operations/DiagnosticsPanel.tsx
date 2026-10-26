"use client";

import type { DiagnosticSeverity } from "@/lib/types";
import { useGitQuery } from "@/hooks/useGitQuery";
import { Badge, ErrorNotice, LoadingBlock } from "@/components/ui/Feedback";

const SEVERITY_TONE: Record<DiagnosticSeverity, "success" | "neutral" | "warning" | "danger"> = { ok: "success", info: "neutral", warning: "warning", error: "danger" };

export function DiagnosticsPanel() {
  const { data, error, reload } = useGitQuery("repo.diagnostics", {});
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return <LoadingBlock label="Checking Git and the repository…" />;

  return (
    <div className="card">
      <div className="card-header">
        Environment and repository checks
        {data.gitVersion && <span className="muted spacer">Git {data.gitVersion}</span>}
      </div>
      <ul className="list">
        {data.checks.map((check) => (
          <li key={check.id} className="list-item" style={{ alignItems: "flex-start" }}>
            <Badge tone={SEVERITY_TONE[check.severity]}>{check.severity}</Badge>
            <div className="list-item-main">
              <strong>{check.title}</strong>
              <span className="muted">{check.detail}</span>
              {check.suggestion && <span>→ {check.suggestion}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
