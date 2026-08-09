/**
 * Thin remote sync admission (ultragoal DF4).
 * Deterministic: which local outbox/canonical rows may leave the machine.
 * No LLM. Default policy prefers promoted knowledge over raw Evidence.
 */

export const SYNC_ADMISSION_POLICY_VERSION = "remote_thin_promoted_v1" as const;

export type SyncAdmissionPolicyId = typeof SYNC_ADMISSION_POLICY_VERSION | "full_log" | "off";

export type SyncAdmissionInput = {
  event_type: string;
  /** Latest disposition for knowledge units (promote|hold|reject|…); omit for raw evidence. */
  disposition?: string | null;
  lifecycle_status?: string | null;
};

export type SyncAdmissionResult = {
  schema: "carpeos.sync-admission-result/v1";
  policy_version: SyncAdmissionPolicyId;
  decision: "admit" | "skip";
  reason_codes: string[];
};

/**
 * Resolve policy from env or explicit id. Default thin when unset.
 */
export function resolveSyncAdmissionPolicy(
  explicit?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): SyncAdmissionPolicyId {
  const raw = (explicit ?? env.CARPEOS_SYNC_ADMISSION ?? SYNC_ADMISSION_POLICY_VERSION).trim();
  if (raw === "full_log" || raw === "off" || raw === SYNC_ADMISSION_POLICY_VERSION) {
    return raw;
  }
  return SYNC_ADMISSION_POLICY_VERSION;
}

/**
 * Whether a local event is eligible for remote push under the active policy.
 */
export function evaluateSyncAdmission(
  input: SyncAdmissionInput,
  policy: SyncAdmissionPolicyId = SYNC_ADMISSION_POLICY_VERSION,
): SyncAdmissionResult {
  const base = {
    schema: "carpeos.sync-admission-result/v1" as const,
    policy_version: policy,
  };

  if (policy === "off") {
    return { ...base, decision: "skip", reason_codes: ["admission_off"] };
  }
  if (policy === "full_log") {
    return { ...base, decision: "admit", reason_codes: ["full_log"] };
  }

  // remote_thin_promoted_v1
  const eventType = input.event_type;
  if (eventType === "EvidenceArtifact") {
    return { ...base, decision: "skip", reason_codes: ["thin_skip_raw_evidence"] };
  }

  if (eventType === "Observation" || eventType === "Claim") {
    const life = (input.lifecycle_status ?? "").toLowerCase();
    const disp = (input.disposition ?? "").toLowerCase();

    // Agentic materialize writes lifecycle_status=active on promote; adj promote units
    // are also active. Prefer lifecycle over disposition-on-same-id (disposition rows
    // are keyed by *evidence* source_event_id, not the Observation/Claim event_id).
    if (life === "active" || life === "promoted") {
      return { ...base, decision: "admit", reason_codes: ["thin_admit_active_unit"] };
    }
    if (disp === "promote" || disp === "promoted") {
      return { ...base, decision: "admit", reason_codes: ["thin_admit_promoted_unit"] };
    }
    if (life === "draft" || life === "held" || life === "") {
      return { ...base, decision: "skip", reason_codes: ["thin_skip_draft_or_held_unit"] };
    }
    return { ...base, decision: "skip", reason_codes: ["thin_skip_non_promoted_unit"] };
  }

  // Other event types (erasure, etc.): skip under thin by default.
  return { ...base, decision: "skip", reason_codes: ["thin_skip_event_type"] };
}
