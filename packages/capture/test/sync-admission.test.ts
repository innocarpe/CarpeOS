import { describe, expect, it } from "vitest";
import {
  evaluateSyncAdmission,
  resolveSyncAdmissionPolicy,
} from "../src/sync-admission.js";

describe("evaluateSyncAdmission thin policy", () => {
  it("skips raw EvidenceArtifact", () => {
    const r = evaluateSyncAdmission({ event_type: "EvidenceArtifact" });
    expect(r.decision).toBe("skip");
    expect(r.reason_codes).toContain("thin_skip_raw_evidence");
  });

  it("admits promoted Observation/Claim", () => {
    expect(
      evaluateSyncAdmission({
        event_type: "Observation",
        disposition: "promote",
        lifecycle_status: "active",
      }).decision,
    ).toBe("admit");
    expect(
      evaluateSyncAdmission({
        event_type: "Claim",
        disposition: "promote",
      }).decision,
    ).toBe("admit");
  });

  it("skips held/reject units", () => {
    expect(
      evaluateSyncAdmission({ event_type: "Observation", disposition: "hold" }).decision,
    ).toBe("skip");
    expect(
      evaluateSyncAdmission({ event_type: "Claim", disposition: "reject" }).decision,
    ).toBe("skip");
  });

  it("full_log admits evidence", () => {
    expect(
      evaluateSyncAdmission({ event_type: "EvidenceArtifact" }, "full_log").decision,
    ).toBe("admit");
  });
});

describe("resolveSyncAdmissionPolicy", () => {
  it("defaults to thin", () => {
    expect(resolveSyncAdmissionPolicy(undefined, {})).toBe("remote_thin_promoted_v1");
  });
  it("honors env full_log", () => {
    expect(resolveSyncAdmissionPolicy(null, { CARPEOS_SYNC_ADMISSION: "full_log" })).toBe(
      "full_log",
    );
  });
});
