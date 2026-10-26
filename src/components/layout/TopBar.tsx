"use client";

import { plural, shortHash } from "@/lib/format";
import { useGitQuery } from "@/hooks/useGitQuery";
import { useRepoCall } from "@/hooks/useRepoCall";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Feedback";
import { CommitSearch } from "@/components/commits/CommitSearch";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import styles from "./layout.module.css";

const THEME_KEY = "git-history-theme";

function toggleTheme() {
  const root = document.documentElement;
  const isLight = root.dataset.theme ? root.dataset.theme === "light" : window.matchMedia("(prefers-color-scheme: light)").matches;
  const next = isLight ? "dark" : "light";
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this session.
  }
}

export function TopBar() {
  const { activeRepository, refresh, setView, runOperation, runningOperation } = useWorkspace();
  const call = useRepoCall();
  const status = useGitQuery("repo.status", activeRepository ? {} : null);
  const head = status.data?.head;
  const upstream = status.data?.upstream;
  const changed = status.data?.files.length ?? 0;

  return (
    <header className={styles.topBar}>
      {activeRepository ? (
        <>
          <div className={styles.repoTitle}>
            <strong className="truncate">{activeRepository.name}</strong>
            <span className="muted mono truncate" title={activeRepository.path}>{activeRepository.path}</span>
          </div>
          {head && (
            <div className="toolbar">
              {head.detached ? <Badge tone="warning" title="HEAD is not on a branch">detached at {head.hash ? shortHash(head.hash) : "?"}</Badge> : <Badge tone="accent" title="Current branch">⎇ {head.branch}{head.unborn ? " (no commits)" : ""}</Badge>}
              {upstream && !upstream.gone && (upstream.ahead > 0 || upstream.behind > 0) && <Badge tone="warning" title={`Relative to ${upstream.name}`}>↑{upstream.ahead} ↓{upstream.behind}</Badge>}
              <button type="button" className="plain-button" onClick={() => setView("source-control")} title="Open source control">
                <Badge tone={changed > 0 ? "warning" : "success"}>{changed > 0 ? plural(changed, "change") : "clean"}</Badge>
              </button>
              {status.data?.inProgress && <Badge tone="danger">{status.data.inProgress.kind} in progress</Badge>}
            </div>
          )}
          <CommitSearch />
          <div className="toolbar" style={{ marginLeft: "auto" }}>
            <Button size="small" disabled={runningOperation !== null} onClick={() => void runOperation("Fetch all remotes", () => call("remotes.fetch", { remote: null }))} title="Download new commits from every remote (changes nothing locally)">
              Fetch
            </Button>
            <Button size="small" onClick={() => setView("remotes")}>Pull / Push</Button>
            <Button size="small" onClick={refresh} title="Re-read the repository">Refresh</Button>
            <Button size="small" variant="ghost" onClick={toggleTheme} aria-label="Toggle light and dark theme" title="Toggle light/dark theme">◐</Button>
          </div>
        </>
      ) : (
        <>
          <strong>Git History</strong>
          <span className="muted">No repository selected</span>
          <Button size="small" variant="ghost" style={{ marginLeft: "auto" }} onClick={toggleTheme} aria-label="Toggle light and dark theme">◐</Button>
        </>
      )}
    </header>
  );
}
