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

/**
 * Resolve a body-free 4.0 seam reference from a known artifact path.
 * Does not invent acceptance: `accepted` must be supplied from independent 4.0 gates.
 */
export function resolveFourZeroSeamRef(input: {
  path: string;
  digest: string | null;
  /** Only true when independent Product 4 verification accepted the receipt. */
  accepted: boolean;
}): BodyFreeReceiptRef {
  return {
    schema: "carpeos.v5.m8-body-free-receipt-ref/v1",
    path: input.path,
    digest: input.digest,
    accepted: input.accepted,
  };
}

/**
 * Final V5 product readiness when M8 4.0 seam is still deferred:
 * V5 draft lane can be complete offline without gating 4.0.
 */
export function v5DraftLaneReadiness(input: {
  m0_pass: boolean;
  pipeline_offline_pass: boolean;
  deepseek_primary: boolean;
  telemetry_local_store_pass: boolean;
  v5_off_path_pass: boolean;
  m8: V5M8Decision;
}): {
  schema: "carpeos.v5.draft-lane-readiness/v1";
  ready: boolean;
  m8_status: V5M8Decision["status"];
  blockers: string[];
  canonical_effect: "none";
} {
  const blockers: string[] = [];
  if (!input.m0_pass) blockers.push("M0 not green");
  if (!input.pipeline_offline_pass) blockers.push("draft pipeline offline not green");
  if (!input.deepseek_primary) blockers.push("DeepSeek Direct is not primary extract route");
  if (!input.telemetry_local_store_pass) blockers.push("local TELEMETRY_DB store not green");
  if (!input.v5_off_path_pass) blockers.push("V5-off path not verified");
  // M8 deferred is allowed for draft-lane readiness; blocked is not.
  if (input.m8.status === "blocked") blockers.push(...input.m8.blockers.map((b) => `m8: ${b}`));
  return {
    schema: "carpeos.v5.draft-lane-readiness/v1",
    ready: blockers.length === 0,
    m8_status: input.m8.status,
    blockers,
    canonical_effect: "none",
  };
}
