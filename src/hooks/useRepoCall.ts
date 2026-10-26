"use client";

import { callGit } from "@/lib/api-client";
import type { ActionMap, ActionName } from "@/lib/contract";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

/** Returns a function that calls a backend action on the active repository. */
export function useRepoCall() {
  const { activeRepository } = useWorkspace();
  const repoId = activeRepository?.id;
  return <K extends ActionName>(action: K, params: ActionMap[K]["params"]): Promise<ActionMap[K]["result"]> => callGit(action, params, repoId);
}
