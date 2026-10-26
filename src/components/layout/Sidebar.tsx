"use client";

import { useGitQuery } from "@/hooks/useGitQuery";
import { RepositoryList } from "@/components/repositories/RepositoryList";
import { useWorkspace, type ViewId } from "@/components/workspace/WorkspaceProvider";
import styles from "./layout.module.css";

const LIMIT = 12;

function SidebarSection({ title, count, view, children }: { title: string; count: number; view: ViewId; children: React.ReactNode }) {
  const { setView } = useWorkspace();
  return (
    <details className={styles.sidebarSection} open={title === "Branches"}>
      <summary>
        {title} <span className="count">{count}</span>
      </summary>
      {children}
      {count > LIMIT && (
        <button type="button" className={styles.sidebarItem} onClick={() => setView(view)}>
          <span className="muted">View all {count} →</span>
        </button>
      )}
      {count === 0 && <p className="muted" style={{ padding: "2px 20px 8px" }}>None</p>}
    </details>
  );
}

export function Sidebar() {
  const { activeRepository, select, setView } = useWorkspace();
  const refs = useGitQuery("graph.refs", activeRepository ? {} : null);
  const stashes = useGitQuery("stash.list", activeRepository ? {} : null);
  const remotes = useGitQuery("remotes.list", activeRepository ? {} : null);

  const local = refs.data?.filter((ref) => ref.kind === "local") ?? [];
  const tags = refs.data?.filter((ref) => ref.kind === "tag") ?? [];

  const showCommit = (hash: string) => {
    select({ kind: "commit", hash });
    setView("graph");
  };

  return (
    <nav className={styles.sidebar} aria-label="Repository navigation">
      <RepositoryList />
      {activeRepository && (
        <>
          <SidebarSection title="Branches" count={local.length} view="branches">
            {local.slice(0, LIMIT).map((ref) => (
              <button key={ref.fullName} type="button" className={`${styles.sidebarItem} ${ref.isHead ? styles.sidebarItemActive : ""}`} onClick={() => showCommit(ref.hash)} title={`Show ${ref.name} in the graph`}>
                <span className="truncate">{ref.isHead ? "● " : ""}{ref.name}</span>
              </button>
            ))}
          </SidebarSection>
          <SidebarSection title="Remotes" count={remotes.data?.length ?? 0} view="remotes">
            {remotes.data?.slice(0, LIMIT).map((remote) => (
              <button key={remote.name} type="button" className={styles.sidebarItem} onClick={() => setView("remotes")} title={remote.fetchUrl}>
                <span className="truncate">{remote.name}</span>
                <span className="muted">{remote.branches.length}</span>
              </button>
            ))}
          </SidebarSection>
          <SidebarSection title="Tags" count={tags.length} view="tags">
            {tags.slice(0, LIMIT).map((ref) => (
              <button key={ref.fullName} type="button" className={styles.sidebarItem} onClick={() => showCommit(ref.hash)}>
                <span className="truncate">🏷 {ref.name}</span>
              </button>
            ))}
          </SidebarSection>
          <SidebarSection title="Stashes" count={stashes.data?.length ?? 0} view="stashes">
            {stashes.data?.slice(0, LIMIT).map((stash) => (
              <button key={stash.ref} type="button" className={styles.sidebarItem} onClick={() => setView("stashes")} title={stash.message}>
                <span className="truncate">{stash.message}</span>
              </button>
            ))}
          </SidebarSection>
        </>
      )}
    </nav>
  );
}
