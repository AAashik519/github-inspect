import fs from "node:fs/promises";
import path from "node:path";
import type { HeadInfo, InProgressOperation, StatusFile, UpstreamInfo, WorkingTreeStatus } from "@/lib/types";
import { git, gitText, type RepoContext } from "./context";

interface ParsedStatus {
  head: HeadInfo;
  upstream: UpstreamInfo | null;
  files: StatusFile[];
}

/** Parses `git status --porcelain=v2 --branch -z`. Exported for tests. */
export function parseStatus(output: string): ParsedStatus {
  const tokens = output.split("\0");
  const head: HeadInfo = { branch: null, hash: null, detached: false, unborn: false };
  let upstreamName: string | null = null;
  let counts: { ahead: number; behind: number } | null = null;
  const files: StatusFile[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;

    if (token.startsWith("# branch.oid ")) {
      const oid = token.slice("# branch.oid ".length);
      head.unborn = oid === "(initial)";
      head.hash = head.unborn ? null : oid;
    } else if (token.startsWith("# branch.head ")) {
      const name = token.slice("# branch.head ".length);
      head.detached = name === "(detached)";
      head.branch = head.detached ? null : name;
    } else if (token.startsWith("# branch.upstream ")) {
      upstreamName = token.slice("# branch.upstream ".length);
    } else if (token.startsWith("# branch.ab ")) {
      const match = /\+(\d+) -(\d+)/.exec(token);
      if (match) counts = { ahead: Number(match[1]), behind: Number(match[2]) };
    } else if (token.startsWith("1 ")) {
      const fields = token.split(" ");
      files.push(toFile(fields[1], fields.slice(8).join(" ")));
    } else if (token.startsWith("2 ")) {
      const fields = token.split(" ");
      const originalPath = tokens[++index];
      files.push({ ...toFile(fields[1], fields.slice(9).join(" ")), originalPath });
    } else if (token.startsWith("u ")) {
      const fields = token.split(" ");
      files.push({ path: fields.slice(10).join(" "), index: fields[1][0], worktree: fields[1][1], isUntracked: false, isConflicted: true });
    } else if (token.startsWith("? ")) {
      files.push({ path: token.slice(2), index: " ", worktree: "?", isUntracked: true, isConflicted: false });
    }
  }

  const upstream = upstreamName
    ? { name: upstreamName, ahead: counts?.ahead ?? 0, behind: counts?.behind ?? 0, gone: counts === null }
    : null;
  return { head, upstream, files };
}

function toFile(xy: string, filePath: string): StatusFile {
  return {
    path: filePath,
    index: xy[0] === "." ? " " : xy[0],
    worktree: xy[1] === "." ? " " : xy[1],
    isUntracked: false,
    isConflicted: false,
  };
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Detects a paused merge, rebase, cherry-pick or revert from Git's own state files. */
export async function detectInProgress(ctx: RepoContext): Promise<InProgressOperation | null> {
  const gitDir = await gitText(ctx, ["rev-parse", "--absolute-git-dir"]);
  const at = (...segments: string[]) => path.join(gitDir, ...segments);

  for (const directory of ["rebase-merge", "rebase-apply"]) {
    if (!(await exists(at(directory)))) continue;
    const headName = await readOptional(at(directory, "head-name"));
    const current = Number(await readOptional(at(directory, directory === "rebase-merge" ? "msgnum" : "next")));
    const total = Number(await readOptional(at(directory, directory === "rebase-merge" ? "end" : "last")));
    return {
      kind: "rebase",
      detail: headName?.replace(/^refs\/heads\//, "") ?? null,
      step: current > 0 && total > 0 ? { current, total } : null,
    };
  }
  if (await exists(at("MERGE_HEAD"))) {
    const mergeHead = await readOptional(at("MERGE_HEAD"));
    return { kind: "merge", detail: mergeHead?.split("\n")[0]?.slice(0, 12) ?? null, step: null };
  }
  if (await exists(at("CHERRY_PICK_HEAD"))) {
    return { kind: "cherry-pick", detail: (await readOptional(at("CHERRY_PICK_HEAD")))?.slice(0, 12) ?? null, step: null };
  }
  if (await exists(at("REVERT_HEAD"))) {
    return { kind: "revert", detail: (await readOptional(at("REVERT_HEAD")))?.slice(0, 12) ?? null, step: null };
  }
  return null;
}

export async function readStatus(ctx: RepoContext): Promise<WorkingTreeStatus> {
  const { stdout } = await git(ctx, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]);
  const parsed = parseStatus(stdout);
  return { ...parsed, inProgress: await detectInProgress(ctx) };
}

export function stagedFiles(status: WorkingTreeStatus): StatusFile[] {
  return status.files.filter((file) => !file.isConflicted && !file.isUntracked && file.index !== " ");
}

/** Tracked files with local modifications (staged or not) plus conflicts — what a checkout/merge could clobber. */
export function dirtyTrackedFiles(status: WorkingTreeStatus): StatusFile[] {
  return status.files.filter((file) => !file.isUntracked);
}
