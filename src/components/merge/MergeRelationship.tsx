import { isReliableEvidence } from "@/lib/merge-message";
import { shortHash } from "@/lib/format";
import type { MergeEndpoint, RelationshipEvidence } from "@/lib/types";
import { Badge } from "@/components/ui/Feedback";

const EVIDENCE_TEXT: Record<RelationshipEvidence, string> = {
  "message-and-refs": "named in the merge message and confirmed by current branch ancestry",
  message: "only the merge message names it; no current branch confirms it",
  ancestry: "the only local branch whose first-parent line passes through this merge",
  none: "Git does not record branch names in merge commits",
};

function EndpointName({ endpoint }: { endpoint: MergeEndpoint }) {
  if (endpoint.name && isReliableEvidence(endpoint.evidence)) {
    return <code title={EVIDENCE_TEXT[endpoint.evidence]}>{endpoint.name}</code>;
  }
  return <span className="muted">Could not determine reliably</span>;
}

function EvidenceLine({ role, endpoint }: { role: string; endpoint: MergeEndpoint }) {
  let detail = EVIDENCE_TEXT[endpoint.evidence];
  if (endpoint.evidence === "message") detail = `the message says “${endpoint.name}”, but ${EVIDENCE_TEXT.message.split("; ")[1]}`;
  if (endpoint.evidence === "none" && endpoint.candidates.length > 1) detail = `several branches share the merge on their first-parent line: ${endpoint.candidates.join(", ")}`;
  return (
    <li>
      <strong>{role}:</strong> {detail}.{" "}
      <Badge tone={isReliableEvidence(endpoint.evidence) ? "success" : "warning"}>{endpoint.evidence === "ancestry" ? "inferred from ancestry" : isReliableEvidence(endpoint.evidence) ? "corroborated" : "unverified"}</Badge>
    </li>
  );
}

/** "source → target, merged at <hash>", with what each name is based on. */
export function MergeRelationship({ hash, relationship }: { hash: string; relationship: { source: MergeEndpoint; target: MergeEndpoint } }) {
  return (
    <div>
      <div style={{ fontSize: 15 }}>
        <EndpointName endpoint={relationship.source} /> <span aria-label="merged into">→</span> <EndpointName endpoint={relationship.target} />
      </div>
      <div className="muted">
        Merged at commit <code>{shortHash(hash)}</code>.
      </div>
      <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
        <EvidenceLine role="Source" endpoint={relationship.source} />
        <EvidenceLine role="Target" endpoint={relationship.target} />
      </ul>
    </div>
  );
}

/** Compact form for lists: names from the merge message are shown as unverified claims. */
export function InferredDirection({ source, target }: { source: string | null; target: string | null }) {
  if (!source) return <span className="muted">Could not determine reliably</span>;
  return (
    <span title="Read from the merge message; open the merge for a check against current branches">
      <code>{source}</code> → {target ? <code>{target}</code> : <span className="muted">?</span>} <Badge>per message</Badge>
    </span>
  );
}
