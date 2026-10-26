"use client";

import { BranchExplorer } from "@/components/branches/BranchExplorer";
import { BranchComparison } from "@/components/compare/BranchComparison";
import { GitGraph } from "@/components/graph/GitGraph";
import { MergeHistory } from "@/components/merge/MergeHistory";
import { OperationsView } from "@/components/operations/OperationsView";
import { RemotesView } from "@/components/remotes/RemotesView";
import { RepositoryOverview } from "@/components/repositories/RepositoryOverview";
import { WelcomeScreen } from "@/components/repositories/WelcomeScreen";
import { SourceControl } from "@/components/source-control/SourceControl";
import { StashManager } from "@/components/stash/StashManager";
import { TagsView } from "@/components/tags/TagsView";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { BottomPanel } from "./BottomPanel";
import { RightPanel } from "./RightPanel";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ViewTabs } from "./ViewTabs";
import styles from "./layout.module.css";

function ActiveView() {
  const { view } = useWorkspace();
  switch (view) {
    case "overview":
      return <RepositoryOverview />;
    case "graph":
      return <GitGraph />;
    case "source-control":
      return <SourceControl />;
    case "branches":
      return <BranchExplorer />;
    case "comparison":
      return <BranchComparison />;
    case "merges":
      return <MergeHistory />;
    case "remotes":
      return <RemotesView />;
    case "stashes":
      return <StashManager />;
    case "tags":
      return <TagsView />;
    case "operations":
      return <OperationsView />;
  }
}

export function WorkspaceShell() {
  const { activeRepository } = useWorkspace();

  return (
    <div className={styles.shell}>
      <TopBar />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.main}>
          {activeRepository ? (
            <>
              <ViewTabs />
              {/* Remount per repository so view-local state (filters, selections) never leaks between repositories. */}
              <div className={styles.content} key={activeRepository.id}>
                <ActiveView />
              </div>
            </>
          ) : (
            <WelcomeScreen />
          )}
        </main>
        {activeRepository && <RightPanel />}
      </div>
      <BottomPanel />
    </div>
  );
}
