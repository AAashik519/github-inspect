"use client";

import { useEffect, useRef, useState } from "react";
import { callGit, toErrorPayload } from "@/lib/api-client";
import type { ApiErrorPayload, CommitSummary } from "@/lib/types";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

const PAGE_SIZE = 300;

interface GraphCommitsState {
  key: string;
  commits: CommitSummary[];
  hasMore: boolean;
  error: ApiErrorPayload | null;
}

/**
 * Loads the commit history page by page. A refresh (after any operation) reloads everything
 * that was already loaded so the user's scroll depth is kept.
 */
export function useGraphCommits(refs: string[] | undefined) {
  const { activeRepository, revision } = useWorkspace();
  const repoId = activeRepository?.id;
  const key = `${repoId}|${JSON.stringify(refs ?? null)}`;
  const [state, setState] = useState<GraphCommitsState>({ key: "", commits: [], hasMore: false, error: null });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadedCount = useRef(0);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    if (!repoId) return;
    let isCurrent = true;
    callGit("graph.commits", { skip: 0, limit: Math.max(PAGE_SIZE, loadedCount.current), refs }, repoId).then(
      (page) => {
        if (!isCurrent) return;
        loadedCount.current = page.commits.length;
        setState({ key, commits: page.commits, hasMore: page.hasMore, error: null });
      },
      (error) => isCurrent && setState({ key, commits: [], hasMore: false, error: toErrorPayload(error) }),
    );
    return () => {
      isCurrent = false;
    };
    // `refs` is represented by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, key, revision]);

  const isCurrentKey = state.key === key;
  const commits = isCurrentKey ? state.commits : [];

  /** Loads one more page. Returns when the page is merged into state. */
  async function loadMore(): Promise<void> {
    if (!repoId || isLoadingRef.current || !isCurrentKey || !state.hasMore) return;
    isLoadingRef.current = true;
    setIsLoadingMore(true);
    try {
      const page = await callGit("graph.commits", { skip: commits.length, limit: PAGE_SIZE, refs }, repoId);
      loadedCount.current = commits.length + page.commits.length;
      setState({ key, commits: [...commits, ...page.commits], hasMore: page.hasMore, error: null });
    } catch (error) {
      setState((previous) => ({ ...previous, error: toErrorPayload(error) }));
    } finally {
      isLoadingRef.current = false;
      setIsLoadingMore(false);
    }
  }

  return {
    commits,
    hasMore: isCurrentKey && state.hasMore,
    error: isCurrentKey ? state.error : null,
    isLoading: Boolean(repoId) && !isCurrentKey,
    isLoadingMore,
    loadMore,
  };
}
