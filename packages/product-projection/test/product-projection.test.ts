import type { CanonicalEvent } from "@carpeos/schema";
import { describe, expect, it } from "vitest";
import { buildDashboardProjection, isClosedDashboardCategory } from "../src/dashboard.js";
import { buildOpenLoops } from "../src/open-loops.js";

const trustZone = {
  trust_zone_id: "tz_local_default",
  isolation: "local_device" as const,
};

function claim(eventId: string, claimId: string, lifecycle: "draft" | "active"): CanonicalEvent {
  return {
    schema_version: "v1",
    event_id: eventId,
    event_type: "Claim",
    subject_ref: "subject_synthetic_project",
    valid_time: { start: "2026-01-01T00:00:00Z", end: null },
    recorded_time: { start: "2026-01-01T00:00:00Z", end: null },
    lifecycle_status: lifecycle,
    epistemic_authority: "derived",
    trust_zone: trustZone,
    provenance: [{ ref_type: "external", ref_id: "external_synthetic_source" }],
    idempotency_key: `idem_${eventId.slice(4).padEnd(16, "0").slice(0, 32)}`,
    request_fingerprint: `sha-256:${"a".repeat(64)}`,
    payload: {
      claim_id: claimId,
      statement: "Synthetic open claim for product projection.",
      claim_type: "factual",
      support: [{ ref_type: "external", ref_id: "external_support_ref" }],
    },
  };
}

describe("product projections", () => {
  it("builds open loops for draft claims and a non-authoritative dashboard", () => {
    const events = [
      claim("evt_claim_draft_000000000000000001", "clm_draft_alpha_000000000001", "draft"),
    ];
    const loops = buildOpenLoops(events);
    expect(loops).toEqual([
      expect.objectContaining({
        kind: "draft_claim",
        status: "open",
        canonical_effect: "none",
      }),
    ]);

    const dashboard = buildDashboardProjection({
      title: "Synthetic Project Dashboard",
      generatedAt: "2026-01-01T00:00:00Z",
      openLoops: loops,
    });
    expect(dashboard.canonical_effect).toBe("none");
    expect(dashboard.open_loop_count).toBe(1);
    expect(dashboard.markdown).toContain("draft_claim");
    expect(dashboard.paths[0]).toBe("dashboard/index.md");
    expect(isClosedDashboardCategory("dashboard_index")).toBe(true);
    expect(isClosedDashboardCategory("arbitrary")).toBe(false);
  });
});
