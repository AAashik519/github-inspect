import type { CommitDetails, RepositoryInfo } from "@/lib/types";
import { commitFileChanges } from "./changes";
import { git, gitText, resolveCommit, type RepoContext } from "./context";
import { readCommits } from "./history";
import { listRefs } from "./refs";
import { getRepositoryLocation } from "./repositories";
import { runGit } from "./run";
import { readStatus } from "./status";

const FIELD = "\u001f";

export async function getCommitDetails(ctx: RepoContext, revision: unknown): Promise<CommitDetails> {
  const hash = await resolveCommit(ctx, revision, "commit");
  const { stdout } = await git(ctx, ["show", "-s", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%s%x1f%b", hash]);
  const [fullHash, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, subject, ...body] = stdout.split(FIELD);
  const parentHashes = parents ? parents.split(" ") : [];

  const [files, containing, tags, parentSummaries] = await Promise.all([
    commitFileChanges(ctx, hash),
    git(ctx, ["for-each-ref", "--contains", hash, "--format=%(refname:short)", "refs/heads", "refs/remotes"]),
    git(ctx, ["for-each-ref", "--points-at", hash, "--format=%(refname:short)", "refs/tags"]),
    parentHashes.length === 0
      ? Promise.resolve([])
      : git(ctx, ["show", "-s", "--format=%H%x1f%s", ...parentHashes]).then(({ stdout: out }) =>
          out
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [parentHash, ...rest] = line.split(FIELD);
              return { hash: parentHash, subject: rest.join(FIELD) };
            }),
        ),
  ]);

  const names = (text: string) => text.split("\n").filter((line) => line && !line.endsWith("/HEAD"));
  return {
    hash: fullHash,
    parents: parentHashes,
    authorName,
    authorEmail,
    authorDate,
    committerName,
    committerEmail,
    committerDate,
    subject,
    body: body.join(FIELD).trim(),
    isMerge: parentHashes.length > 1,
    parentSummaries,
    branches: names(containing.stdout),
    tags: names(tags.stdout),
    files,
    totalAdditions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    totalDeletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
    diffBase: parentHashes.length === 0 ? "root" : "first-parent",
  };
}

function lineCount(text: string): number {
  return text.split("\n").filter(Boolean).length;
}

async function readSubmodules(ctx: RepoContext): Promise<string[]> {
  const { stdout } = await git(ctx, ["config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"], { okCodes: [0, 1, 128] });
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" ").slice(1).join(" "));
}

export async function getRepositoryInfo(ctx: RepoContext, name: string): Promise<RepositoryInfo> {
  const [location, status, version, shallow, refs, stashes, remotes, submodules, lastCommit] = await Promise.all([
    getRepositoryLocation(ctx),
    readStatus(ctx),
    runGit(["--version"]).then(({ stdout }) => stdout.trim().replace(/^git version /, "")),
    gitText(ctx, ["rev-parse", "--is-shallow-repository"]),
    listRefs(ctx),
    git(ctx, ["stash", "list", "--format=%gd"]).then(({ stdout }) => lineCount(stdout)),
    git(ctx, ["remote"]).then(({ stdout }) => lineCount(stdout)),
    readSubmodules(ctx),
    readCommits(ctx, { limit: 1, skip: 0 }).then(({ commits }) => commits[0] ?? null),
  ]);

  const commitCount = status.head.unborn ? 0 : Number(await gitText(ctx, ["rev-list", "--count", "--branches", "--remotes", "--tags", "HEAD"]));

  return {
    id: ctx.id,
    name,
    path: ctx.root,
    gitDir: location.gitDir,
    isLinkedWorktree: location.isLinkedWorktree,
    isShallow: shallow === "true",
    superproject: location.superproject,
    submodules,
    head: status.head,
    hasCommits: !status.head.unborn,
    commitCount,
    localBranchCount: refs.filter((ref) => ref.kind === "local").length,
    remoteBranchCount: refs.filter((ref) => ref.kind === "remote").length,
    tagCount: refs.filter((ref) => ref.kind === "tag").length,
    stashCount: stashes,
    remoteCount: remotes,
    gitVersion: version,
    lastCommit,
  };
}
