import type { OperationResult, TagInfo } from "@/lib/types";
import { currentBranch, currentHead, git, gitText, refExists, resolveCommit, verify, type RepoContext } from "./context";
import { GitError } from "./errors";
import { mutate, operationResult } from "./mutate";
import { NETWORK_TIMEOUT_MS } from "./run";
import { detectInProgress } from "./status";
import { assertRemoteName, assertTagName, optionalString } from "./validate";

const FIELD = "\u001f";
const TAG_FORMAT = [
  "%(refname:short)",
  "%(objecttype)",
  "%(objectname)",
  "%(*objectname)",
  "%(*objecttype)",
  "%(taggername)",
  "%(taggerdate:iso-strict)",
  "%(contents:subject)",
  "%(*contents:subject)",
  "%(creatordate:iso-strict)",
].join("%1f");

export async function listTags(ctx: RepoContext): Promise<TagInfo[]> {
  const { stdout } = await git(ctx, ["for-each-ref", `--format=${TAG_FORMAT}`, "--sort=-creatordate", "refs/tags"]);
  const tags: TagInfo[] = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [name, objectType, objectName, peeledName, peeledType, tagger, taggerDate, subject, peeledSubject, creatorDate] = line.split(FIELD);
    const isAnnotated = objectType === "tag";
    if (isAnnotated && peeledType !== "commit") continue;
    if (!isAnnotated && objectType !== "commit") continue;
    tags.push({
      name,
      hash: isAnnotated ? peeledName : objectName,
      type: isAnnotated ? "annotated" : "lightweight",
      tagger: isAnnotated ? tagger : null,
      date: isAnnotated ? taggerDate : creatorDate,
      message: isAnnotated ? subject : "",
      commitSubject: isAnnotated ? peeledSubject : subject,
    });
  }
  return tags;
}

export async function tagMessage(ctx: RepoContext, value: unknown): Promise<string> {
  const name = await assertTagName(value);
  return gitText(ctx, ["for-each-ref", "--format=%(contents)", `refs/tags/${name}`]);
}

export async function createTag(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const name = await assertTagName(params.name);
  const message = optionalString(params.message, "message", 10_000);
  const hash = await resolveCommit(ctx, params.revision ?? "HEAD", "commit");
  if (await refExists(ctx, `refs/tags/${name}`)) throw new GitError("ref-exists", `A tag named “${name}” already exists.`);

  const headBefore = await currentHead(ctx);
  const args = message ? ["tag", "--annotate", "--message", message, name, hash] : ["tag", name, hash];
  const result = await mutate(ctx, `Create ${message ? "annotated" : "lightweight"} tag ${name}`, args);
  verify(await refExists(ctx, `refs/tags/${name}`), `Tag “${name}” was not created.`);
  return operationResult(ctx, headBefore, "success", `Created ${message ? "annotated" : "lightweight"} tag ${name} at ${hash.slice(0, 8)}. It exists only locally until you push it.`, result);
}

export async function deleteTag(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const name = await assertTagName(params.name);
  if (!(await refExists(ctx, `refs/tags/${name}`))) throw new GitError("ref-not-found", `Tag “${name}” does not exist.`, { status: 404 });
  const target = await gitText(ctx, ["rev-parse", `refs/tags/${name}`]);
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Delete tag ${name}`, ["tag", "--delete", name]);
  verify(!(await refExists(ctx, `refs/tags/${name}`)), `Tag “${name}” still exists.`);
  return operationResult(ctx, headBefore, "success", `Deleted local tag ${name} (${target.slice(0, 8)}). A copy on a remote, if any, was not touched.`, result);
}

export async function pushTag(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const remote = assertRemoteName(params.remote);
  const name = await assertTagName(params.name);
  if (!(await refExists(ctx, `refs/tags/${name}`))) throw new GitError("ref-not-found", `Tag “${name}” does not exist.`, { status: 404 });
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Push tag ${name} to ${remote}`, ["push", remote, `refs/tags/${name}`], { timeoutMs: NETWORK_TIMEOUT_MS });
  return operationResult(ctx, headBefore, "success", `Pushed tag ${name} to ${remote}.`, result);
}

export async function deleteRemoteTag(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const remote = assertRemoteName(params.remote);
  const name = await assertTagName(params.name);
  if (params.confirmName !== name) throw new GitError("validation", "Type the tag name to confirm deleting it from the remote.");
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Delete tag ${name} from ${remote}`, ["push", remote, "--delete", `refs/tags/${name}`], { timeoutMs: NETWORK_TIMEOUT_MS });
  return operationResult(ctx, headBefore, "success", `Deleted tag ${name} from ${remote}. The local tag was not touched.`, result);
}

export async function checkoutTag(ctx: RepoContext, params: Record<string, unknown>): Promise<OperationResult> {
  const name = await assertTagName(params.name);
  if (!(await refExists(ctx, `refs/tags/${name}`))) throw new GitError("ref-not-found", `Tag “${name}” does not exist.`, { status: 404 });
  const inProgress = await detectInProgress(ctx);
  if (inProgress) throw new GitError("precondition", `A ${inProgress.kind} is in progress. Finish or abort it first.`);
  const hash = await resolveCommit(ctx, `refs/tags/${name}`, "tag");
  const headBefore = await currentHead(ctx);
  const result = await mutate(ctx, `Checkout tag ${name} (detached HEAD)`, ["switch", "--detach", `refs/tags/${name}`]);
  verify((await currentHead(ctx)) === hash && (await currentBranch(ctx)) === null, "HEAD is not detached at the tag.");
  return operationResult(ctx, headBefore, "success", `HEAD is detached at ${name}. Commits made now belong to no branch — create a branch to keep them.`, result);
}
