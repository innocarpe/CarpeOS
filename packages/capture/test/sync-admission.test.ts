import { describe, expect, it } from "vitest";
import { evaluateSyncAdmission, resolveSyncAdmissionPolicy } from "../src/sync-admission.js";

describe("evaluateSyncAdmission thin policy", () => {
  it("skips raw EvidenceArtifact", () => {
    const r = evaluateSyncAdmission({ event_type: "EvidenceArtifact" });
    expect(r.decision).toBe("skip");
    expect(r.reason_codes).toContain("thin_skip_raw_evidence");
  });

  it("admits active Observation/Claim even without disposition on same id", () => {
    expect(
      evaluateSyncAdmission({
        event_type: "Observation",
        lifecycle_status: "active",
      }).decision,
    ).toBe("admit");
    expect(
      evaluateSyncAdmission({
        event_type: "Claim",
        lifecycle_status: "active",
      }).reason_codes,
    ).toContain("thin_admit_active_unit");
  });

  it("admits promote disposition when lifecycle missing", () => {
    expect(
      evaluateSyncAdmission({
        event_type: "Observation",
        disposition: "promote",
      }).decision,
    ).toBe("admit");
  });

  it("skips draft units", () => {
    expect(
      evaluateSyncAdmission({ event_type: "Observation", lifecycle_status: "draft" }).decision,
    ).toBe("skip");
    expect(
      evaluateSyncAdmission({
        event_type: "Claim",
        disposition: "hold",
        lifecycle_status: "draft",
      }).decision,
    ).toBe("skip");
  });

  it("full_log admits evidence", () => {
    expect(evaluateSyncAdmission({ event_type: "EvidenceArtifact" }, "full_log").decision).toBe(
      "admit",
    );
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
