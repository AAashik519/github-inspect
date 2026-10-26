import type { FileDiffResult } from "@/lib/contract";
import { parseUnifiedDiff } from "@/lib/diff/parse";
import { assertRelativePath, assertStashRef, optionalBoolean, requireEnum } from "./validate";
import { diffBaseFor, emptyTreeHash } from "./changes";
import { git, resolveCommit, type RepoContext } from "./context";

const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-textconv", "-M"];

type DiffRequest = Record<string, unknown>;

async function runDiff(ctx: RepoContext, args: string[], okCodes = [0]): Promise<FileDiffResult> {
  const { stdout, truncated } = await git(ctx, ["diff", ...DIFF_FLAGS, ...args], { maxBytes: MAX_DIFF_BYTES, okCodes, literalPaths: true });
  return { files: parseUnifiedDiff(stdout), truncated };
}

/** Returns the diff of one file for the requested comparison. Revisions are resolved to hashes first. */
export async function getFileDiff(ctx: RepoContext, request: DiffRequest): Promise<FileDiffResult> {
  const kind = requireEnum(request.kind, "kind", ["unstaged", "staged", "untracked", "commit", "range", "stash"] as const);
  const path = assertRelativePath(request.path);
  const oldPath = request.oldPath ? assertRelativePath(request.oldPath, "old path") : undefined;
  const paths = oldPath ? [oldPath, path] : [path];

  switch (kind) {
    case "unstaged":
      return runDiff(ctx, ["--", path]);
    case "staged":
      return runDiff(ctx, ["--cached", "--", ...paths]);
    case "untracked":
      // `--no-index` exits 1 when the files differ, which is the expected case.
      return runDiff(ctx, ["--no-index", "--", "/dev/null", path], [0, 1]);
    case "commit": {
      const hash = await resolveCommit(ctx, request.hash, "commit");
      const { base } = await diffBaseFor(ctx, hash);
      return runDiff(ctx, [base, hash, "--", ...paths]);
    }
    case "range": {
      const base = await resolveCommit(ctx, request.base, "base");
      const head = await resolveCommit(ctx, request.head, "head");
      const range = optionalBoolean(request.fromMergeBase) ? [`${base}...${head}`] : [base, head];
      return runDiff(ctx, [...range, "--", ...paths]);
    }
    case "stash": {
      const { ref } = assertStashRef(request.ref);
      const tracked = await runDiff(ctx, [`${ref}^1`, ref, "--", path]);
      if (tracked.files.length > 0) return tracked;
      // Untracked files live in the stash's third parent, when present.
      const { code } = await git(ctx, ["rev-parse", "--verify", "--quiet", `${ref}^3`], { okCodes: [0, 1] });
      return code === 0 ? runDiff(ctx, [await emptyTreeHash(ctx), `${ref}^3`, "--", path]) : tracked;
    }
  }
}