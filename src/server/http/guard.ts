import { GitError } from "../git/errors";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * The backend runs Git on the user's machine, so only same-origin requests to a loopback address
 * are accepted. This blocks other websites (CSRF) and DNS-rebinding attacks.
 */
export function assertLocalRequest(request: Request): void {
  const host = request.headers.get("host") ?? "";
  if (!LOCAL_HOST.test(host)) throw forbidden("The Git backend only answers on localhost.");

  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== host) throw forbidden("Cross-origin requests are not allowed.");

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw forbidden("Cross-site requests are not allowed.");

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new GitError("validation", "Requests must be JSON.", { status: 415 });
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new GitError("validation", "The request is too large.", { status: 413 });
  try {
    return JSON.parse(text);
  } catch {
    throw new GitError("validation", "The request body is not valid JSON.");
  }
}

function forbidden(message: string): GitError {
  return new GitError("forbidden-origin", message, { status: 403 });
}
