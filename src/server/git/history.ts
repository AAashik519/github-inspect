import type { CommitSummary, RefInfo } from "@/lib/types";
import { git, type RepoContext } from "./context";
import { listRefs } from "./refs";
import { GitError } from "./errors";

const FIELD = "\u001f";
const RECORD = "\u001e";
export const COMMIT_FORMAT = "--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cI%x1f%s";

export function parseCommits(output: string): CommitSummary[] {
  return output
    .split(RECORD)
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const [hash, parents, authorName, authorEmail, authorDate, committerDate, ...subject] = record.replace(/\n$/, "").split(FIELD);
      return {
        hash,
        parents: parents ? parents.split(" ") : [],
        authorName,
        authorEmail,
        authorDate,
        committerDate,
        subject: subject.join(FIELD),
      };
    });
}

function isEmptyRepositoryError(error: unknown): boolean {
  return error instanceof GitError && /does not have any commits yet|unknown revision|bad (default )?revision/i.test(`${error.message}\n${error.output}`);
}

/** Selects what `git log` walks: explicit refs (validated against real refs) or everything. */
function revisionArguments(requested: string[] | undefined, refs: RefInfo[], includeHead: boolean): string[] {
  if (!requested) return ["--branches", "--remotes", "--tags", ...(includeHead ? ["HEAD"] : [])];
  const known = new Set(refs.map((ref) => ref.fullName));
  return requested.filter((name) => known.has(name));
}

export async function readCommits(
  ctx: RepoContext,
  options: { limit: number; skip: number; refs?: string[] },
): Promise<{ commits: CommitSummary[]; hasMore: boolean }> {
  const refs = await listRefs(ctx);
  const revisions = revisionArguments(options.refs, refs, true);
  if (options.refs && revisions.length === 0) return { commits: [], hasMore: false };

  try {
    const { stdout } = await git(ctx, [
      "log",
      "--topo-order",
      COMMIT_FORMAT,
      `--max-count=${options.limit + 1}`,
      `--skip=${options.skip}`,
      ...revisions,
      "--",
    ]);
    const commits = parseCommits(stdout);
    return { commits: commits.slice(0, options.limit), hasMore: commits.length > options.limit };
  } catch (error) {
    if (isEmptyRepositoryError(error)) return { commits: [], hasMore: false };
    throw error;
  }
}

/** Commits reachable from `include` but not from `exclude` (hashes only), newest first. */
export async function readRangeCommits(
  ctx: RepoContext,
  include: string,
  exclude: string[],
  limit: number,
): Promise<{ commits: CommitSummary[]; total: number }> {
  const notArguments = exclude.length > 0 ? ["--not", ...exclude] : [];
  const [log, count] = await Promise.all([
    git(ctx, ["log", "--topo-order", COMMIT_FORMAT, `--max-count=${limit}`, include, ...notArguments, "--"]),
    git(ctx, ["rev-list", "--count", include, ...notArguments, "--"]),
  ]);
  return { commits: parseCommits(log.stdout), total: Number(count.stdout.trim()) };
}

const SEARCH_LIMIT = 60;

/** Searches by hash prefix, message, author and branch/tag name across all refs. */
export async function searchCommits(ctx: RepoContext, query: string): Promise<{ commits: CommitSummary[]; refs: RefInfo[] }> {
  const needle = query.trim();
  const refs = (await listRefs(ctx)).filter((ref) => ref.name.toLowerCase().includes(needle.toLowerCase())).slice(0, 20);

  const base = ["log", "--topo-order", COMMIT_FORMAT, `--max-count=${SEARCH_LIMIT}`, "--regexp-ignore-case", "--fixed-strings", "--branches", "--remotes", "--tags"];
  const searches: Promise<CommitSummary[]>[] = [
    git(ctx, [...base, `--grep=${needle}`, "--"]).then(({ stdout }) => parseCommits(stdout)),
    git(ctx, [...base, `--author=${needle}`, "--"]).then(({ stdout }) => parseCommits(stdout)),
  ];
  if (/^[0-9a-f]{4,40}$/i.test(needle)) {
    searches.push(
      git(ctx, ["log", COMMIT_FORMAT, "--max-count=1", `${needle}^{commit}`, "--"], { okCodes: [0, 128] }).then(({ stdout }) => parseCommits(stdout)),
    );
  }

  try {
    const matched = (await Promise.all(searches)).flat();
    const unique = new Map(matched.map((commit) => [commit.hash, commit]));
    const commits = [...unique.values()].sort((a, b) => b.committerDate.localeCompare(a.committerDate)).slice(0, SEARCH_LIMIT);
    return { commits, refs };
  } catch (error) {
    if (isEmptyRepositoryError(error)) return { commits: [], refs };
    throw error;
  }
}
