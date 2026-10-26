"use client";

import { useCallback, useEffect, useState } from "react";
import { callGit, toErrorPayload } from "@/lib/api-client";
import type { ActionMap, ActionName } from "@/lib/contract";
import type { ApiErrorPayload } from "@/lib/types";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

interface QueryState<T> {
  data: T | undefined;
  error: ApiErrorPayload | null;
  isLoading: boolean;
  reload: () => void;
}

/**
 * Reads data from the active repository. Refetches when the repository, the parameters
 * or the workspace revision (bumped after every operation) change. Stale data stays visible while reloading.
 * Pass `params = null` to skip the request.
 */
export function useGitQuery<K extends ActionName>(action: K, params: ActionMap[K]["params"] | null): QueryState<ActionMap[K]["result"]> {
  const { activeRepository, revision } = useWorkspace();
  const repoId = activeRepository?.id;
  const paramsKey = JSON.stringify(params);
  const [localRevision, setLocalRevision] = useState(0);
  const [state, setState] = useState<{ key: string; data?: ActionMap[K]["result"]; error: ApiErrorPayload | null }>({ key: "", error: null });

  const requestKey = `${repoId}|${action}|${paramsKey}`;

  useEffect(() => {
    if (!repoId || params === null) return;
    let isCurrent = true;
    callGit(action, params, repoId).then(
      (data) => isCurrent && setState({ key: requestKey, data, error: null }),
      (error) => isCurrent && setState((previous) => ({ key: requestKey, data: previous.key === requestKey ? previous.data : undefined, error: toErrorPayload(error) })),
    );
    return () => {
      isCurrent = false;
    };
    // `params` is represented by `paramsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, action, paramsKey, revision, localRevision, requestKey]);

  const isEnabled = Boolean(repoId) && params !== null;
  const isCurrentKey = state.key === requestKey;
  return {
    data: isCurrentKey ? state.data : undefined,
    error: isCurrentKey ? state.error : null,
    isLoading: isEnabled && !isCurrentKey,
    reload: useCallback(() => setLocalRevision((current) => current + 1), []),
  };
}
