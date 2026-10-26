import fs from "node:fs/promises";
import path from "node:path";
import type { DiagnosticCheck, DiagnosticReport, ReflogEntry } from "@/lib/types";
import { git, gitText, type RepoContext } from "./context";
import { GitError } from "./errors";
import { listConflicts } from "./conflicts";
import { runGit } from "./run";
import { readStatus } from "./status";

const FIELD = "\u001f";
const MINIMUM_GIT_VERSION = [2, 23];
const MERGE_TREE_VERSION = [2, 38];

function isVersionAtLeast(version: string, minimum: number[]): boolean {
  const [major, minor] = version.split(".").map(Number);
  return major > minimum[0] || (major === minimum[0] && minor >= minimum[1]);
}

/** `git var` succeeds exactly when Git can determine an identity (config, environment or system defaults). */
async function hasIdentity(ctx: RepoContext): Promise<boolean> {
  const { code } = await git(ctx, ["var", "GIT_AUTHOR_IDENT"], { okCodes: [0, 128] });
  return code === 0;
}

export async function runDiagnostics(ctx: RepoContext): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [];
  const add = (check: DiagnosticCheck) => checks.push(check);

  let gitVersion: string | null = null;
  let gitPath: string | null = null;
  try {
    gitVersion = (await runGit(["--version"])).stdout.trim().replace(/^git version /, "");
    gitPath = (await runGit(["--exec-path"])).stdout.trim();
    add({
      id: "git-version",
      severity: isVersionAtLeast(gitVersion, MINIMUM_GIT_VERSION) ? "ok" : "error",
      title: `Git ${gitVersion}`,
      detail: `Found at ${gitPath}.`,
      suggestion: isVersionAtLeast(gitVersion, MINIMUM_GIT_VERSION) ? undefined : "Upgrade to Git 2.23 or newer (needed for switch/restore).",
    });
    if (!isVersionAtLeast(gitVersion, MERGE_TREE_VERSION)) {
      add({
        id: "merge-preview",
        severity: "info",
        title: "Conflict preview unavailable",
        detail: "Simulating merges requires Git 2.38 or newer. Merges still work; conflicts are discovered when you merge.",
      });
    }
  } catch (error) {
    add({
      id: "git-version",
      severity: "error",
      title: "Git executable not found",
      detail: error instanceof GitError ? error.message : "Git could not be started.",
      suggestion: "Install Git and make sure it is on the PATH of the process running this app.",
    });
    return { gitVersion, gitPath, checks };
  }

  const status = await readStatus(ctx);
  const remotes = (await git(ctx, ["remote"])).stdout.split("\n").filter(Boolean);

  if (status.head.unborn) add({ id: "unborn", severity: "info", title: "Repository has no commits", detail: "Create the first commit from Source Control." });
  if (status.head.detached) {
    add({
      id: "detached-head",
      severity: "warning",
      title: "Detached HEAD",
      detail: `HEAD is at ${status.head.hash?.slice(0, 8)}, not on a branch. New commits will not belong to any branch.`,
      suggestion: "Create a branch here (Branches → New branch) or switch back to a branch.",
    });
  }
  if (status.inProgress) {
    add({
      id: "in-progress",
      severity: "warning",
      title: `${status.inProgress.kind} in progress`,
      detail: "Git is paused in the middle of an operation.",
      suggestion: "Resolve conflicts and continue, or abort the operation.",
    });
  }
  const conflicts = await listConflicts(ctx);
  if (conflicts.length > 0) {
    add({ id: "conflicts", severity: "error", title: `${conflicts.length} conflicted file(s)`, detail: conflicts.map((file) => file.path).join(", "), suggestion: "Open Source Control → Conflicts." });
  }
  const changed = status.files.filter((file) => !file.isConflicted).length;
  if (changed > 0) {
    add({ id: "uncommitted", severity: "info", title: `${changed} uncommitted change(s)`, detail: "Merge, rebase and pull operations require a clean working tree.", suggestion: "Commit or stash your changes." });
  }

  if (remotes.length === 0) {
    add({ id: "no-remote", severity: "info", title: "No remotes configured", detail: "Fetch, pull and push are unavailable.", suggestion: "Add a remote in Remotes." });
  } else if (status.head.branch && !status.upstream) {
    add({ id: "no-upstream", severity: "info", title: `${status.head.branch} has no upstream`, detail: "Pull and the ahead/behind counters need a tracking branch.", suggestion: "Push with “set upstream” or choose an upstream in Branches." });
  } else if (status.upstream?.gone) {
    add({ id: "upstream-gone", severity: "warning", title: `Upstream ${status.upstream.name} no longer exists`, detail: "The remote branch was deleted or renamed.", suggestion: "Set a new upstream or push the branch again." });
  } else if (status.upstream && (status.upstream.ahead > 0 || status.upstream.behind > 0)) {
    add({ id: "sync", severity: "info", title: `${status.upstream.ahead} ahead, ${status.upstream.behind} behind ${status.upstream.name}`, detail: "Based on the last fetch." });
  }

  if (!(await hasIdentity(ctx))) {
    add({ id: "identity", severity: "warning", title: "Git identity missing", detail: "user.name and user.email are required to create commits.", suggestion: 'Run: git config --global user.name "Your Name" && git config --global user.email you@example.com' });
  }

  const gitDir = await gitText(ctx, ["rev-parse", "--absolute-git-dir"]);
  try {
    await fs.access(path.join(gitDir, "index.lock"));
    add({ id: "lock", severity: "warning", title: "index.lock exists", detail: "Another Git process may be running, or a crashed one left the lock file.", suggestion: "If no Git process is running, delete .git/index.lock." });
  } catch {
    // No lock file is the healthy case.
  }

  if (checks.every((check) => check.severity === "ok" || check.severity === "info")) {
    add({ id: "healthy", severity: "ok", title: "No problems detected", detail: "The repository is in a normal state." });
  }
  return { gitVersion, gitPath, checks };
}

export async function readReflog(ctx: RepoContext): Promise<ReflogEntry[]> {
  const { stdout } = await git(ctx, ["reflog", "show", "--max-count=100", "--format=%gd%x1f%H%x1f%gs%x1f%cI"], { okCodes: [0, 128] });
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [selector, hash, subject, date] = line.split(FIELD);
      return { selector, hash, subject, date };
    });
}
