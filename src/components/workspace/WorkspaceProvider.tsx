"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { callGit, toErrorPayload } from "@/lib/api-client";
import type { ApiErrorPayload, OperationResult, RepositoryEntry } from "@/lib/types";

export type ViewId = "overview" | "graph" | "source-control" | "branches" | "comparison" | "merges" | "remotes" | "stashes" | "tags" | "operations";

export type Selection = { kind: "commit"; hash: string } | { kind: "compare"; base: string; head: string } | null;

export interface OperationOutcome {
  label: string;
  at: number;
  result?: OperationResult;
  error?: ApiErrorPayload;
}

export interface ComparisonPreset {
  source: string;
  target: string;
}

interface WorkspaceValue {
  repositories: RepositoryEntry[];
  repositoriesError: ApiErrorPayload | null;
  isLoadingRepositories: boolean;
  activeRepository: RepositoryEntry | null;
  openRepository: (id: string) => Promise<void>;
  addRepository: (path: string) => Promise<RepositoryEntry>;
  removeRepository: (id: string) => Promise<void>;
  reloadRepositories: () => Promise<void>;

  /** Increments after every operation; data hooks refetch when it changes. */
  revision: number;
  refresh: () => void;

  view: ViewId;
  setView: (view: ViewId) => void;
  selection: Selection;
  select: (selection: Selection) => void;
  comparisonPreset: ComparisonPreset | null;
  openComparison: (preset: ComparisonPreset) => void;

  runningOperation: string | null;
  lastOutcome: OperationOutcome | null;
  dismissOutcome: () => void;
  /** Runs a state-changing call, reports its real outcome and refreshes data. Returns null on failure. */
  runOperation: <T extends OperationResult>(label: string, task: () => Promise<T>) => Promise<T | null>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [repositories, setRepositories] = useState<RepositoryEntry[]>([]);
  const [repositoriesError, setRepositoriesError] = useState<ApiErrorPayload | null>(null);
  const [isLoadingRepositories, setIsLoadingRepositories] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [view, setViewState] = useState<ViewId>("graph");
  const [selection, setSelection] = useState<Selection>(null);
  const [comparisonPreset, setComparisonPreset] = useState<ComparisonPreset | null>(null);
  const [runningOperation, setRunningOperation] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<OperationOutcome | null>(null);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);

  const applyRepositoryList = useCallback((list: RepositoryEntry[]) => {
    setRepositories(list);
    setRepositoriesError(null);
    setIsLoadingRepositories(false);
    setActiveId((current) => (current && list.some((entry) => entry.id === current) ? current : (list.find((entry) => entry.state === "ok")?.id ?? null)));
  }, []);

  const failRepositoryLoad = useCallback((error: unknown) => {
    setRepositoriesError(toErrorPayload(error));
    setIsLoadingRepositories(false);
  }, []);

  const reloadRepositories = useCallback(() => callGit("repos.list", {}).then(applyRepositoryList, failRepositoryLoad), [applyRepositoryList, failRepositoryLoad]);

  useEffect(() => {
    // Initial load of the repository registry from the local backend.
    callGit("repos.list", {}).then(applyRepositoryList, failRepositoryLoad);
  }, [applyRepositoryList, failRepositoryLoad]);

  const resetContext = useCallback((id: string | null) => {
    setActiveId(id);
    setSelection(null);
    setLastOutcome(null);
    setRevision((current) => current + 1);
  }, []);

  const openRepository = useCallback(
    async (id: string) => {
      const opened = await callGit("repos.open", { id });
      setRepositories((list) => list.map((entry) => (entry.id === id ? opened : entry)));
      resetContext(id);
    },
    [resetContext],
  );

  const addRepository = useCallback(
    async (path: string) => {
      const added = await callGit("repos.add", { path });
      await reloadRepositories();
      resetContext(added.id);
      return added;
    },
    [reloadRepositories, resetContext],
  );

  const removeRepository = useCallback(
    async (id: string) => {
      await callGit("repos.remove", { id });
      const list = await callGit("repos.list", {});
      setRepositories(list);
      if (id === activeId) resetContext(list.find((entry) => entry.state === "ok")?.id ?? null);
    },
    [activeId, resetContext],
  );

  const runOperation = useCallback(
    async <T extends OperationResult>(label: string, task: () => Promise<T>): Promise<T | null> => {
      setRunningOperation(label);
      try {
        const result = await task();
        setLastOutcome({ label, at: Date.now(), result });
        // Conflicts are resolved in Source Control; take the user there instead of leaving them guessing.
        if (result.outcome === "conflict") setViewState("source-control");
        return result;
      } catch (error) {
        setLastOutcome({ label, at: Date.now(), error: toErrorPayload(error) });
        return null;
      } finally {
        setRunningOperation(null);
        refresh();
      }
    },
    [refresh],
  );

  const value = useMemo<WorkspaceValue>(
    () => ({
      repositories,
      repositoriesError,
      isLoadingRepositories,
      activeRepository: repositories.find((entry) => entry.id === activeId) ?? null,
      openRepository,
      addRepository,
      removeRepository,
      reloadRepositories,
      revision,
      refresh,
      view,
      setView: setViewState,
      selection,
      select: setSelection,
      comparisonPreset,
      openComparison: (preset) => {
        setComparisonPreset(preset);
        setViewState("comparison");
      },
      runningOperation,
      lastOutcome,
      dismissOutcome: () => setLastOutcome(null),
      runOperation,
    }),
    [repositories, repositoriesError, isLoadingRepositories, activeId, openRepository, addRepository, removeRepository, reloadRepositories, revision, refresh, view, selection, comparisonPreset, runningOperation, lastOutcome, runOperation],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
