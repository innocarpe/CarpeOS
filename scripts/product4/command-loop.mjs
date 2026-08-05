import { digestJson, PRODUCT4_CONTEXT, PRODUCT4_POLICY_SHA256 } from "./policy-identity.mjs";

export const PRODUCT4_COMMAND_LOOP = Object.freeze([
  Object.freeze({ step: 1, command_id: "capture", authority: "local", effect: "evidence" }),
  Object.freeze({
    step: 2,
    command_id: "canonical_append",
    authority: "canonical",
    effect: "append_only",
  }),
  Object.freeze({
    step: 3,
    command_id: "adjudication",
    authority: "human_review",
    effect: "classify",
  }),
  Object.freeze({
    step: 4,
    command_id: "promoted_projection",
    authority: "projection",
    effect: "promoted_only",
  }),
  Object.freeze({
    step: 6,
    command_id: "candidate_evidence",
    authority: "base_evaluator",
    effect: "attestation",
  }),
  Object.freeze({
    step: 7,
    command_id: "human_authority",
    authority: "human",
    effect: "accept_or_defer",
  }),
]);

export const TEMPLATE_5_RECOVERY_ONLY = Object.freeze({
  step: 5,
  command_id: "recovery_reconciliation",
  mode: "recovery_only",
  can_write: false,
  auto_authority: false,
});

const FORBIDDEN_AUTHORITY = new Set(["Claim", "AcceptanceDecision", "Supersession"]);
const SHA256 = /^[0-9a-f]{64}$/;

export function assertSixCommandLoop(receipt) {
  if (!isRecord(receipt)) throwLoopError("invalid_receipt", "loop receipt must be an object");
  if (receipt.policy_sha256 !== PRODUCT4_POLICY_SHA256)
    throwLoopError("policy_not_active", "loop policy is not P4_0");
  if (receipt.context !== PRODUCT4_CONTEXT)
    throwLoopError("context_mismatch", "loop context is not frozen");
  if (!Array.isArray(receipt.steps) || receipt.steps.length !== PRODUCT4_COMMAND_LOOP.length) {
    throwLoopError("invalid_steps", "loop must contain exactly six steps");
  }

  const seen = new Set();
  receipt.steps.forEach((observed, index) => {
    const expected = PRODUCT4_COMMAND_LOOP[index];
    if (!isRecord(observed)) throwLoopError("invalid_step", `step ${index + 1} is not an object`);
    if (observed.step !== expected.step || observed.command_id !== expected.command_id) {
      throwLoopError("invalid_order", `expected step ${expected.step}:${expected.command_id}`);
    }
    if (seen.has(observed.step))
      throwLoopError("duplicate_step", `duplicate step ${observed.step}`);
    seen.add(observed.step);
    if (observed.status !== "passed")
      throwLoopError("step_not_passed", `step ${observed.step} is not passed`);
    if (!SHA256.test(observed.evidence_digest ?? "")) {
      throwLoopError("invalid_evidence", `step ${observed.step} evidence digest is invalid`);
    }
    if (
      observed.authority_effect !== undefined &&
      FORBIDDEN_AUTHORITY.has(observed.authority_effect)
    ) {
      throwLoopError("auto_authority", `step ${observed.step} claims forbidden authority`);
    }
  });

  if (receipt.template_5 !== undefined) {
    const recovery = receipt.template_5;
    if (
      !isRecord(recovery) ||
      recovery.step !== TEMPLATE_5_RECOVERY_ONLY.step ||
      recovery.command_id !== TEMPLATE_5_RECOVERY_ONLY.command_id ||
      recovery.mode !== TEMPLATE_5_RECOVERY_ONLY.mode ||
      recovery.can_write !== false ||
      recovery.auto_authority !== false
    ) {
      throwLoopError(
        "template_5_not_recovery_only",
        "template 5 is recovery-only and non-authoritative",
      );
    }
  }
  if (receipt.auto_authority === true || FORBIDDEN_AUTHORITY.has(receipt.authority_effect)) {
    throwLoopError("auto_authority", "the loop cannot create automatic knowledge authority");
  }
  return receipt;
}

export function buildSixCommandLoopReceipt({ steps, template5 = TEMPLATE_5_RECOVERY_ONLY }) {
  const receipt = {
    schema_version: "carpeos.product4-command-loop/v1",
    policy_sha256: PRODUCT4_POLICY_SHA256,
    context: PRODUCT4_CONTEXT,
    steps,
    template_5: template5,
    auto_authority: false,
  };
  assertSixCommandLoop(receipt);
  return {
    ...receipt,
    receipt_digest: digestJson(receipt),
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwLoopError(code, message) {
  const error = new Error(message);
  error.name = "CommandLoopError";
  error.code = code;
  throw error;
}
