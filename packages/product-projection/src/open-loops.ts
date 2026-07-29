import type { CanonicalEvent } from "@carpeos/schema";

export type OpenLoopKind =
  | "draft_claim"
  | "needs_review"
  | "conflict"
  | "unresolved_supersession"
  | "verification_gap";

export type OpenLoopItem = {
  loop_id: string;
  kind: OpenLoopKind;
  subject_ref: string;
  title: string;
  source_event_ids: string[];
  status: "open";
  canonical_effect: "none";
};

/**
 * Derive open loops from canonical events. Non-authoritative product view.
 */
export function buildOpenLoops(events: readonly CanonicalEvent[]): OpenLoopItem[] {
  const claims = events.filter(
    (event): event is CanonicalEvent<"Claim"> => event.event_type === "Claim",
  );
  const decisions = events.filter(
    (event): event is CanonicalEvent<"AcceptanceDecision"> =>
      event.event_type === "AcceptanceDecision",
  );
  const supersessions = events.filter(
    (event): event is CanonicalEvent<"Supersession"> => event.event_type === "Supersession",
  );

  const accepted = new Set<string>();
  const rejected = new Set<string>();
  const needsReview = new Set<string>();
  for (const decision of decisions) {
    for (const claimRef of decision.payload.claim_refs) {
      if (decision.payload.decision === "accepted") {
        accepted.add(claimRef);
      } else if (decision.payload.decision === "rejected") {
        rejected.add(claimRef);
      } else {
        needsReview.add(claimRef);
      }
    }
  }

  const loops: OpenLoopItem[] = [];

  for (const claim of claims) {
    const claimId = claim.payload.claim_id;
    if (claim.lifecycle_status === "draft" && !accepted.has(claimId) && !rejected.has(claimId)) {
      loops.push({
        loop_id: `loop_draft_${claim.event_id}`,
        kind: "draft_claim",
        subject_ref: claim.subject_ref,
        title: claim.payload.statement.slice(0, 160),
        source_event_ids: [claim.event_id],
        status: "open",
        canonical_effect: "none",
      });
    }
    if (needsReview.has(claimId)) {
      loops.push({
        loop_id: `loop_review_${claim.event_id}`,
        kind: "needs_review",
        subject_ref: claim.subject_ref,
        title: claim.payload.statement.slice(0, 160),
        source_event_ids: [claim.event_id],
        status: "open",
        canonical_effect: "none",
      });
    }
    if (accepted.has(claimId) && rejected.has(claimId)) {
      loops.push({
        loop_id: `loop_conflict_${claim.event_id}`,
        kind: "conflict",
        subject_ref: claim.subject_ref,
        title: claim.payload.statement.slice(0, 160),
        source_event_ids: [claim.event_id],
        status: "open",
        canonical_effect: "none",
      });
    }
  }

  for (const supersession of supersessions) {
    if (supersession.payload.replacement_event_id === undefined) {
      loops.push({
        loop_id: `loop_super_${supersession.event_id}`,
        kind: "unresolved_supersession",
        subject_ref: supersession.subject_ref,
        title: supersession.payload.reason.slice(0, 160),
        source_event_ids: [supersession.event_id, supersession.payload.supersedes_event_id],
        status: "open",
        canonical_effect: "none",
      });
    }
  }

  return loops.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.loop_id.localeCompare(right.loop_id),
  );
}
