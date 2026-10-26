"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorNotice, LoadingBlock, Notice } from "@/components/ui/Feedback";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import styles from "@/components/layout/layout.module.css";
import { AddRepositoryDialog } from "./AddRepositoryDialog";

/** Shown until a usable repository is selected. */
export function WelcomeScreen() {
  const { repositories, repositoriesError, isLoadingRepositories, reloadRepositories } = useWorkspace();
  const [isAdding, setIsAdding] = useState(false);

  if (isLoadingRepositories) return <LoadingBlock label="Loading your repositories…" />;

  return (
    <div className={styles.welcome}>
      <h1>Git History</h1>
      <p className="muted">
        Add a local Git repository to inspect its history, understand how branches diverge and merge, and run your everyday Git workflow without the terminal. Everything runs on your machine against your real repository.
      </p>
      {repositoriesError && <ErrorNotice error={repositoriesError} onRetry={() => void reloadRepositories()} />}
      {repositories.length > 0 && <Notice tone="warning">None of your saved repositories is currently usable. Pick one from the sidebar or add another.</Notice>}
      <div>
        <Button variant="primary" onClick={() => setIsAdding(true)}>
          Add a repository
        </Button>
      </div>
      {isAdding && <AddRepositoryDialog onClose={() => setIsAdding(false)} />}
    </div>
  );
}
