import type { MergeEndpoint, RelationshipEvidence } from "./types";

// Names parsed from Git's default merge messages. They are inferred from text, not recorded by Git.

// "Merge branch 'a' into b", "Merge remote-tracking branch 'origin/a'", "Merge pull request #1 from owner/a" ...
const MERGE_SUBJECT = /^Merge (?:remote-tracking branch|branch|tag|commit) '([^']+)'(?: of \S+)?(?: into (.+))?$/;
const PULL_REQUEST_SUBJECT = /^Merge pull request #\d+ from (\S+)/;

export function inferMergeNames(subject: string): { source: string | null; target: string | null } {
  const standard = MERGE_SUBJECT.exec(subject);
  if (standard) return { source: standard[1], target: standard[2] ?? null };
  const pullRequest = PULL_REQUEST_SUBJECT.exec(subject);
  if (pullRequest) return { source: pullRequest[1], target: null };
  return { source: null, target: null };
}


export function resolveEndpoint(messageName: string | null, isConfirmedByRefs: boolean, ancestryCandidates: string[] = []): MergeEndpoint {
  if (messageName) return { name: messageName, evidence: isConfirmedByRefs ? "message-and-refs" : "message", candidates: [] };
  if (ancestryCandidates.length === 1) return { name: ancestryCandidates[0], evidence: "ancestry", candidates: [] };
  return { name: null, evidence: "none", candidates: ancestryCandidates };
}

/** Only these are trustworthy enough to present as the relationship; the rest show "Could not determine reliably". */
export const isReliableEvidence = (evidence: RelationshipEvidence) => evidence === "message-and-refs" || evidence === "ancestry";
