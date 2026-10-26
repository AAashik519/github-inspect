import type { ActionMap, ActionName, ApiResponse } from "./contract";
import type { ApiErrorPayload } from "./types";

export class ApiError extends Error {
  readonly payload: ApiErrorPayload;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.payload = payload;
  }
}

const BACKEND_UNREACHABLE: ApiErrorPayload = {
  kind: "network",
  message: "Cannot reach the local Git backend.",
  explanation: "The browser could not talk to the server that runs Git on your computer.",
  suggestions: ["Make sure the app server (npm run dev / npm start) is still running, then reload this page."],
};

/** The only way the UI reaches Git: a typed call to a named backend action. */
export async function callGit<K extends ActionName>(
  action: K,
  params: ActionMap[K]["params"],
  repoId?: string,
): Promise<ActionMap[K]["result"]> {
  let response: Response;
  try {
    response = await fetch("/api/git", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, repoId, params }),
    });
  } catch {
    throw new ApiError(BACKEND_UNREACHABLE);
  }

  const body = (await response.json().catch(() => null)) as ApiResponse<ActionMap[K]["result"]> | null;
  if (!body) throw new ApiError({ ...BACKEND_UNREACHABLE, message: `The backend returned an unreadable response (HTTP ${response.status}).` });
  if (!body.ok) throw new ApiError(body.error);
  return body.data;
}

export function toErrorPayload(error: unknown): ApiErrorPayload {
  if (error instanceof ApiError) return error.payload;
  return {
    kind: "unknown",
    message: error instanceof Error ? error.message : String(error),
    explanation: "An unexpected error occurred in the interface.",
    suggestions: ["Reload the page and try again."],
  };
}
