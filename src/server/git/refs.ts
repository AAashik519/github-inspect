import type { RefInfo } from "@/lib/types";
import { git, type RepoContext } from "./context";

const FIELD = "\u001f";
const REF_FORMAT = ["%(refname)", "%(objectname)", "%(*objectname)", "%(*objecttype)", "%(HEAD)", "%(upstream:short)"].join("%1f");

export async function listRefs(ctx: RepoContext): Promise<RefInfo[]> {
  const { stdout } = await git(ctx, ["for-each-ref", `--format=${REF_FORMAT}`, "refs/heads", "refs/remotes", "refs/tags"]);
  const refs: RefInfo[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const [fullName, objectName, peeledName, peeledType, headMarker, upstream] = line.split(FIELD);

    if (fullName.startsWith("refs/remotes/") && fullName.endsWith("/HEAD")) continue; // symbolic pointer, not a branch
    const isTag = fullName.startsWith("refs/tags/");
    if (isTag && peeledName && peeledType !== "commit") continue; // tags on trees/blobs have no place in the graph

    refs.push({
      name: fullName.replace(/^refs\/(heads|remotes|tags)\//, ""),
      fullName,
      kind: isTag ? "tag" : fullName.startsWith("refs/remotes/") ? "remote" : "local",
      hash: isTag && peeledName ? peeledName : objectName,
      isHead: headMarker === "*",
      upstream: upstream || null,
    });
  }
  return refs;
}
