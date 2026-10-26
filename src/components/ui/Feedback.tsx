import type { ReactNode } from "react";
import type { ApiErrorPayload } from "@/lib/types";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state-block">
      <Spinner label={label} /> <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state-block state-empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

/** Shows what failed, why, and what to do next, plus the raw Git output when available. */
export function ErrorNotice({ error, onRetry }: { error: ApiErrorPayload; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <strong>{error.message}</strong>
      <p>{error.explanation}</p>
      {error.suggestions.length > 0 && (
        <ul>
          {error.suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      )}
      {error.output && (
        <details>
          <summary>Git output</summary>
          <pre className="output">{error.output}</pre>
        </details>
      )}
      {onRetry && (
        <button type="button" className="button button-secondary button-small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "danger" || tone === "warning" ? "alert" : "note"}>
      {children}
    </div>
  );
}

export function Badge({ tone = "neutral", title, children }: { tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "merge"; title?: string; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}
