import type { OperationResult } from "@/lib/types";
import { currentHead, git, type RepoContext } from "./context";
import { describeError } from "./errors";
import { recordOperation } from "./operations-log";
import { redact } from "./redact";
import type { GitResult, RunOptions } from "./run";

/**
 * Runs a state-changing git command and records it in Operation History.
 * A non-zero exit code listed in `okCodes` (e.g. 1 for merge conflicts) is logged as a conflict.
 */
export async function mutate(
  ctx: RepoContext,
  label: string,
  args: string[],
  options: Omit<RunOptions, "cwd"> = {},
): Promise<GitResult> {
  const started = Date.now();
  const command = redact(`git ${args.join(" ")}`);
  try {
    const result = await git(ctx, args, options);
    recordOperation({
      repoId: ctx.id,
      label,
      command,
      outcome: result.code === 0 ? "success" : "conflict",
      durationMs: Date.now() - started,
      output: redact(`${result.stdout}${result.stderr}`).trim(),
    });
    return result;
  } catch (error) {
    const payload = describeError(error);
    recordOperation({
      repoId: ctx.id,
      label,
      command,
      outcome: "failed",
      durationMs: Date.now() - started,
      output: payload.output ?? "",
      error: payload,
    });
    throw error;
  }
}

export function combinedOutput(result: GitResult): string {
  return redact(`${result.stdout}${result.stderr}`).trim();
}

/** Builds the standard result after verifying HEAD with a fresh read. */
export async function operationResult(
  ctx: RepoContext,
  headBefore: string | null,
  outcome: OperationResult["outcome"],
  summary: string,
  result: GitResult,
): Promise<OperationResult> {
  return { outcome, summary, output: combinedOutput(result), headBefore, headAfter: await currentHead(ctx) };
}
