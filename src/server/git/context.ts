import type { GitResult, RunOptions } from "./run";
import { runGit } from "./run";
import { GitError } from "./errors";
import { requireRevision, isFullHash } from "./validate";

/** A registered repository. `root` always comes from the server-side registry, never from a request. */
export interface RepoContext {
  id: string;
  root: string;
}

export function git(ctx: RepoContext, args: string[], options: Omit<RunOptions, "cwd"> = {}): Promise<GitResult> {
  return runGit(args, { ...options, cwd: ctx.root });
}

export async function gitText(ctx: RepoContext, args: string[], options: Omit<RunOptions, "cwd"> = {}): Promise<string> {
  const { stdout } = await git(ctx, args, options);
  return stdout.replace(/\r?\n$/, "");
}

/** Resolves a user-supplied hash or ref name to a full commit hash, or throws a not-found error. */
export async function resolveCommit(ctx: RepoContext, revision: unknown, field = "revision"): Promise<string> {
  const value = requireRevision(revision, field);
  const { stdout, code } = await git(ctx, ["rev-parse", "--verify", "--quiet", `${value}^{commit}`], { okCodes: [0, 1] });
  const hash = stdout.trim();
  if (code !== 0 || !isFullHash(hash)) throw new GitError("ref-not-found", `“${value}” does not match any commit.`, { status: 404 });
  return hash;
}

export async function refExists(ctx: RepoContext, fullRef: string): Promise<boolean> {
  const { code } = await git(ctx, ["show-ref", "--verify", "--quiet", fullRef], { okCodes: [0, 1] });
  return code === 0;
}

export async function currentHead(ctx: RepoContext): Promise<string | null> {
  const { stdout, code } = await git(ctx, ["rev-parse", "--verify", "--quiet", "HEAD"], { okCodes: [0, 1] });
  return code === 0 ? stdout.trim() : null;
}

export async function currentBranch(ctx: RepoContext): Promise<string | null> {
  const { stdout, code } = await git(ctx, ["symbolic-ref", "--quiet", "--short", "HEAD"], { okCodes: [0, 1] });
  return code === 0 ? stdout.trim() : null;
}

/** Used after every mutation so we never report success without checking the repository state. */
export function verify(condition: boolean, message: string): void {
  if (!condition) {
    throw new GitError("verification-failed", message, {
      status: 500,
      suggestions: ["Refresh the repository and check Operation History for the raw Git output."],
    });
  }
}
