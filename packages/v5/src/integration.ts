/**
 * V5-M8 shared integration seam — body-free 4.0 receipt references only.
 * No canonical authority expansion. No V5 gate on PRD-v4 M0–M5.
 */

export type BodyFreeReceiptRef = {
  schema: "carpeos.v5.m8-body-free-receipt-ref/v1";
  /** Path relative to repo root; must not embed bodies or credentials. */
  path: string;
  /** Optional digest of the referenced receipt bytes if available. */
  digest: string | null;
  accepted: boolean;
};

export type V5M8Decision = {
  schema: "carpeos.v5.m8-decision/v1";
  opt_in: boolean;
  draft_only: true;
  canonical_effect: "none";
  v5_off_release_path_verified: boolean;
  four_zero_seam: BodyFreeReceiptRef | null;
  blockers: string[];
  status: "accepted" | "deferred" | "blocked";
};

/**
 * Integrate only a compatible body-free 4.0 receipt/read-oracle reference.
 * If accepted 4.0 evidence is missing, status is deferred/blocked — never invented.
 */
export function decideM8(input: {
  opt_in: boolean;
  v5_off_release_path_verified: boolean;
  four_zero_seam: BodyFreeReceiptRef | null;
}): V5M8Decision {
  const blockers: string[] = [];
  if (!input.v5_off_release_path_verified) {
    blockers.push("V5-off release path not verified");
  }
  if (!input.four_zero_seam) {
    blockers.push("no accepted body-free 4.0 evidence seam");
  } else if (!input.four_zero_seam.accepted) {
    blockers.push("4.0 evidence seam present but not accepted");
  }

  let status: V5M8Decision["status"];
  if (blockers.length > 0) {
    status = input.four_zero_seam ? "blocked" : "deferred";
  } else if (!input.opt_in) {
    status = "accepted"; // explicit opt-out still a valid draft-only decision
  } else {
    status = "accepted";
  }

  return {
    schema: "carpeos.v5.m8-decision/v1",
    opt_in: input.opt_in,
    draft_only: true,
    canonical_effect: "none",
    v5_off_release_path_verified: input.v5_off_release_path_verified,
    four_zero_seam: input.four_zero_seam,
    blockers,
    status: blockers.length > 0 ? status : "accepted",
  };
}

/** Repeatable V5-off release path check (local offline). */
export function verifyV5OffReleasePath(input: {
  v5_enabled: boolean;
  provider_network_used: boolean;
  canonical_writes: number;
  telemetry_db_only: boolean;
}): { pass: boolean; errors: string[] } {
  const errors: string[] = [];
  if (input.v5_enabled) errors.push("V5 must be off for V5-off release path");
  if (input.provider_network_used) errors.push("provider network used while V5-off");
  if (input.canonical_writes !== 0) errors.push("canonical writes must be zero on V5 path");
  // telemetry_db_only is informational when telemetry unused
  void input.telemetry_db_only;
  return { pass: errors.length === 0, errors };
}
