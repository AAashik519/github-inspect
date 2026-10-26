import { spawn } from "node:child_process";
import { GitError, classifyGitFailure } from "./errors";
import { redact } from "./redact";

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
  /** True when output exceeded `maxBytes` and was cut off. */
  truncated: boolean;
}

export interface RunOptions {
  cwd?: string;
  /** Written to the process' stdin (commit messages, patches). */
  input?: string;
  timeoutMs?: number;
  /** Exit codes treated as success (default: [0]). */
  okCodes?: number[];
  /** Stop reading after this many stdout bytes. */
  maxBytes?: number;
  /**
   * Treat file arguments literally (no globs or ":(magic)"). Only for commands that receive user-supplied paths:
   * the setting is inherited by Git's internal sub-commands and breaks e.g. `stash --include-untracked`.
   */
  literalPaths?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
export const NETWORK_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

// Never prompt: a GUI backend has no terminal, so hanging on a password prompt would freeze the operation.
const NON_INTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
  GIT_SEQUENCE_EDITOR: "true",
  GIT_MERGE_AUTOEDIT: "no",
  GIT_PAGER: "cat",
  GIT_OPTIONAL_LOCKS: "0",
  // Block exotic transports such as `ext::` that execute arbitrary commands.
  GIT_ALLOW_PROTOCOL: "file:git:http:https:ssh",
  LC_ALL: "C",
  LANGUAGE: "C",
};

function buildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...NON_INTERACTIVE_ENV };
  env.GIT_SSH_COMMAND ??= "ssh -o BatchMode=yes";
  return env;
}

/** Runs git without a shell. Arguments are passed as an array and never interpolated. */
export function runGit(args: string[], options: RunOptions = {}): Promise<GitResult> {
  const okCodes = options.okCodes ?? [0];
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    // core.fsmonitor can name a program that a repository's own config makes Git run on `status`; never allow that.
    const globalFlags = ["-c", "core.quotepath=off", "-c", "core.fsmonitor=false", ...(options.literalPaths ? ["--literal-pathspecs"] : [])];
    const child = spawn("git", [...globalFlags, ...args], {
      cwd: options.cwd,
      env: buildEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let truncated = false;
    let didTimeout = false;
    let hasSettled = false;

    const timer = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const settle = (action: () => void) => {
      if (hasSettled) return;
      hasSettled = true;
      clearTimeout(timer);
      action();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) {
        truncated = true;
        child.kill("SIGKILL");
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.concat(stderrChunks).length < 1024 * 1024) stderrChunks.push(chunk);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      settle(() =>
        reject(
          error.code === "ENOENT"
            ? new GitError("git-missing", "The git executable was not found.", {
                status: 500,
                suggestions: ["Install Git and make sure `git` is on the PATH of the process running this app."],
              })
            : new GitError("unknown", redact(error.message), { status: 500 }),
        ),
      );
    });

    child.on("close", (code) => {
      settle(() => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        if (didTimeout) {
          reject(new GitError("timeout", `git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s.`, { output: stderr, status: 504 }));
          return;
        }
        const exitCode = truncated ? 0 : (code ?? -1);
        if (!okCodes.includes(exitCode)) {
          reject(classifyGitFailure(stderr, stdout, `git ${args[0]} failed (exit code ${exitCode}).`));
          return;
        }
        resolve({ stdout, stderr, code: exitCode, truncated });
      });
    });

    child.stdin.on("error", () => undefined); // Process may exit before reading stdin.
    child.stdin.end(options.input ?? "");
  });
}

/** Convenience: stdout with the trailing newline removed. */
export async function gitOutput(cwd: string, args: string[], options: Omit<RunOptions, "cwd"> = {}): Promise<string> {
  const { stdout } = await runGit(args, { ...options, cwd });
  return stdout.replace(/\r?\n$/, "");
}
