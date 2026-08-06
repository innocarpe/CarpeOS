/**
 * V5-M8 seam resolution — body-free Product 4 receipt references only.
 * Never invents acceptance. Never expands canonical authority.
 * At most one primary seam is selected for the final decision.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideM8,
  type BodyFreeReceiptRef,
  type V5M8Decision,
  verifyV5OffReleasePath,
} from "./integration.js";

/** Known in-repo body-free Product 4 / release-related receipts (relative paths). */
export const KNOWN_FOUR_ZERO_RECEIPT_PATHS = [
  "artifacts/g008/product4-exact-install-receipt.json",
  "artifacts/g008/product4-release-gate-defer-receipt.json",
] as const;

export type ClassifiedFourZeroReceipt = {
  path: string;
  exists: boolean;
  body_free: boolean;
  receipt_type: string | null;
  status: string | null;
  /** True only when the receipt itself records an independent accepted/passed outcome
   * that is eligible as the M8 *release* seam (not install-smoke alone). */
  accepted_as_release_seam: boolean;
  /** True when receipt is a passed body-free install/smoke reference (not full M8). */
  accepted_as_install_smoke: boolean;
  digest: string | null;
  blockers: string[];
  notes: string[];
};

/** Keys that indicate non-body-free payload material (not metadata enumerations). */
const FORBIDDEN_BODY_KEYS = new Set([
  "body",
  "prompt",
  "completion",
  "transcript",
  "raw",
  "private_key",
  "cookie",
  "authorization",
]);

/** Metadata keys allowed when values are explicit non-secret enumerations. */
const SAFE_METADATA_ENUM_VALUES = new Set([
  "not_requested",
  "not_attempted",
  "none",
  "passed",
  "blocked",
  "deferred",
  "missing",
]);

function sha256File(bytes: Buffer): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function collectKeys(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    into.add(k.toLowerCase());
    collectKeys(v, into, depth + 1);
  }
}

/**
 * Classify a single on-disk receipt without inventing acceptance.
 */
export function classifyFourZeroReceipt(
  repoRoot: string,
  relativePath: string,
): ClassifiedFourZeroReceipt {
  const abs = join(repoRoot, relativePath);
  if (!existsSync(abs)) {
    return {
      path: relativePath,
      exists: false,
      body_free: false,
      receipt_type: null,
      status: null,
      accepted_as_release_seam: false,
      accepted_as_install_smoke: false,
      digest: null,
      blockers: ["receipt_missing"],
      notes: [],
    };
  }

  const bytes = readFileSync(abs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return {
      path: relativePath,
      exists: true,
      body_free: false,
      receipt_type: null,
      status: null,
      accepted_as_release_seam: false,
      accepted_as_install_smoke: false,
      digest: sha256File(bytes),
      blockers: ["receipt_not_json"],
      notes: [],
    };
  }

  const rec = parsed as Record<string, unknown>;
  const keys = new Set<string>();
  collectKeys(parsed, keys);
  const bodyHits = [...FORBIDDEN_BODY_KEYS].filter((k) => keys.has(k));
  // "credentials"/"token" keys are allowed only with safe enum metadata values
  for (const soft of ["credentials", "credential", "token", "password"] as const) {
    if (keys.has(soft)) {
      const val = rec[soft];
      if (typeof val === "string" && SAFE_METADATA_ENUM_VALUES.has(val)) {
        continue;
      }
      if (
        val !== undefined &&
        val !== null &&
        !(typeof val === "string" && SAFE_METADATA_ENUM_VALUES.has(val))
      ) {
        bodyHits.push(soft);
      }
    }
  }
  const body_free = bodyHits.length === 0;

  const receipt_type = typeof rec.receipt_type === "string" ? rec.receipt_type : null;
  const status = typeof rec.status === "string" ? rec.status : null;
  const blockers: string[] = [];
  const notes: string[] = [];

  if (!body_free) {
    blockers.push(`not_body_free:${bodyHits.join(",")}`);
  }

  // Install smoke: product4_exact_install with status passed and authority not required
  let accepted_as_install_smoke = false;
  if (
    body_free &&
    receipt_type === "product4_exact_install" &&
    status === "passed" &&
    rec.authority === "not_attempted"
  ) {
    accepted_as_install_smoke = true;
    notes.push("install_smoke_passed_authority_not_attempted");
  }

  // Full release seam: requires release authority / release gate verified or accepted
  let accepted_as_release_seam = false;
  const statusOk = status === "passed" || status === "verified" || status === "accepted";
  if (
    body_free &&
    statusOk &&
    (receipt_type === "release_authority" ||
      receipt_type === "product4_release_authority" ||
      (typeof receipt_type === "string" && receipt_type.includes("release_authority")))
  ) {
    accepted_as_release_seam = true;
    notes.push("release_authority_passed");
  }
  if (receipt_type === "product4_release_gate") {
    if (status === "blocked" || status === "defer" || rec.decision === "defer") {
      blockers.push("release_gate_deferred_or_blocked");
      if (Array.isArray(rec.blockers)) {
        for (const b of rec.blockers) {
          if (typeof b === "string") blockers.push(`gate:${b}`);
        }
      }
    } else if (statusOk && body_free) {
      accepted_as_release_seam = true;
      notes.push("release_gate_passed");
    }
  }

  if (!accepted_as_release_seam && !accepted_as_install_smoke && blockers.length === 0) {
    blockers.push("not_accepted_as_m8_release_seam");
  }

  return {
    path: relativePath,
    exists: true,
    body_free,
    receipt_type,
    status,
    accepted_as_release_seam,
    accepted_as_install_smoke,
    digest: sha256File(bytes),
    blockers,
    notes,
  };
}

export function scanKnownFourZeroReceipts(repoRoot: string): ClassifiedFourZeroReceipt[] {
  return KNOWN_FOUR_ZERO_RECEIPT_PATHS.map((p) => classifyFourZeroReceipt(repoRoot, p));
}

/**
 * Select at most one primary seam for M8.
 * Preference: accepted release seam → otherwise null (defer), never promote install-smoke alone to release acceptance.
 */
export function selectPrimaryFourZeroSeam(classified: ClassifiedFourZeroReceipt[]): {
  four_zero_seam: BodyFreeReceiptRef | null;
  install_smoke_ref: BodyFreeReceiptRef | null;
  selection_notes: string[];
} {
  const selection_notes: string[] = [];
  const release = classified.find((c) => c.accepted_as_release_seam && c.body_free);
  if (release) {
    selection_notes.push(`selected_release_seam:${release.path}`);
    return {
      four_zero_seam: {
        schema: "carpeos.v5.m8-body-free-receipt-ref/v1",
        path: release.path,
        digest: release.digest,
        accepted: true,
      },
      install_smoke_ref: null,
      selection_notes,
    };
  }

  const install = classified.find((c) => c.accepted_as_install_smoke && c.body_free);
  const install_smoke_ref = install
    ? {
        schema: "carpeos.v5.m8-body-free-receipt-ref/v1" as const,
        path: install.path,
        digest: install.digest,
        accepted: false, // install smoke is not full M8 release acceptance
      }
    : null;
  if (install) {
    selection_notes.push(`install_smoke_only:${install.path};release_seam_absent`);
  } else {
    selection_notes.push("no_compatible_body_free_release_seam");
  }

  // Present but unaccepted seam (e.g. blocked gate) for transparency — still not accepted
  const blockedPresent = classified.find(
    (c) =>
      c.exists &&
      c.body_free &&
      !c.accepted_as_release_seam &&
      c.receipt_type === "product4_release_gate",
  );
  if (blockedPresent) {
    selection_notes.push(`observed_blocked_gate:${blockedPresent.path}`);
    return {
      four_zero_seam: {
        schema: "carpeos.v5.m8-body-free-receipt-ref/v1",
        path: blockedPresent.path,
        digest: blockedPresent.digest,
        accepted: false,
      },
      install_smoke_ref,
      selection_notes,
    };
  }

  return {
    four_zero_seam: null,
    install_smoke_ref,
    selection_notes,
  };
}

export type FinalV5DecisionReceipt = {
  schema: "carpeos.v5.final-decision-receipt/v1";
  timestamp: string;
  opt_in: boolean;
  draft_only: true;
  canonical_effect: "none";
  primary_provider: "deepseek_direct";
  primary_model: "deepseek-v4-flash";
  openrouter_required: false;
  capture_hot_path_wired: false;
  v5_off_release_path: ReturnType<typeof verifyV5OffReleasePath>;
  m8: V5M8Decision;
  classified_receipts: ClassifiedFourZeroReceipt[];
  install_smoke_ref: BodyFreeReceiptRef | null;
  selection_notes: string[];
  /** Draft lane may ship with m8 deferred; full M8 accept requires release seam. */
  draft_lane_shippable: boolean;
  m8_complete: boolean;
  notes: string[];
};

/**
 * Build the explicit final V5 decision (opt-in draft-only) for M8 close-out.
 * Does not invent 4.0 acceptance.
 */
export function buildFinalV5Decision(input: {
  repoRoot: string;
  opt_in?: boolean;
  timestamp?: string;
}): FinalV5DecisionReceipt {
  const classified = scanKnownFourZeroReceipts(input.repoRoot);
  const selected = selectPrimaryFourZeroSeam(classified);
  const v5_off = verifyV5OffReleasePath({
    v5_enabled: false,
    provider_network_used: false,
    canonical_writes: 0,
    telemetry_db_only: true,
  });
  // Prefer deferred when no accepted release seam (do not invent green).
  // A present-but-unaccepted seam would force blocked; for product close-out we
  // pass null so M8 status is deferred until real accepted release evidence exists.
  const m8 = decideM8({
    opt_in: input.opt_in !== false,
    v5_off_release_path_verified: v5_off.pass,
    four_zero_seam: selected.four_zero_seam?.accepted === true ? selected.four_zero_seam : null,
  });

  const m8_complete = m8.status === "accepted" && selected.four_zero_seam?.accepted === true;
  const draft_lane_shippable =
    v5_off.pass && (m8.status === "deferred" || m8.status === "accepted") && m8.draft_only;

  return {
    schema: "carpeos.v5.final-decision-receipt/v1",
    timestamp: input.timestamp ?? new Date().toISOString(),
    opt_in: input.opt_in !== false,
    draft_only: true,
    canonical_effect: "none",
    primary_provider: "deepseek_direct",
    primary_model: "deepseek-v4-flash",
    openrouter_required: false,
    capture_hot_path_wired: false,
    v5_off_release_path: v5_off,
    m8,
    classified_receipts: classified,
    install_smoke_ref: selected.install_smoke_ref,
    selection_notes: selected.selection_notes,
    draft_lane_shippable,
    m8_complete,
    notes: [
      "M8 full accept requires body-free accepted 4.0 release evidence; install-smoke alone is insufficient.",
      "Draft-lane shippability does not require M8 complete.",
      "No canonical authority expansion.",
      "PRD-v4 remains independently releasable.",
    ],
  };
}
