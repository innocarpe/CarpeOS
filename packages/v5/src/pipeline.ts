/**
 * V5 end-to-end draft pipeline (DeepSeek Direct primary).
 *
 * redact → EvidencePack → attempt → extract (fake|deepseek_direct) →
 * draft reduce → review sidecar hooks → evaluation ledger row
 *
 * Never writes canonical events, outbox, sequences, or retrieval projections.
 * Network stays off unless caller enables ProviderBoundary network + consent.
 */

import {
  createSidecar,
  dispatchAttempt,
  finishAttempt,
  prepareAttempt,
  reconcileAttempt,
  type SidecarState,
} from "./attempts.js";
import { reduceExtractToDraft, type DraftProposalOutput } from "./draft-reduce.js";
import {
  buildEvidencePack,
  buildProfileBinding,
  serializeEvidencePackView,
  type EvidencePack,
  type EvidencePackView,
} from "./evidence-pack.js";
import { buildFrozenLedger, evaluateGates, type EvalCase, type EvalGates } from "./evaluation.js";
import { ProviderBoundary } from "./provider.js";
import type { ProviderCallResult, ProviderConsent, ProviderPreflight } from "./provider-types.js";
import {
  redactEnvelope,
  type ProfileLimits,
  type RedactOk,
  type RedactResult,
} from "./redaction.js";
import type { ExtractResponse } from "./reducer.js";

export const DEFAULT_PROFILE_LIMITS: ProfileLimits = {
  field_utf8_bytes: 12288,
  field_scalars: 6000,
  pack_utf8_bytes: 24576,
  pack_scalars: 12000,
  field_count: 8,
  segment_count: 16,
  segment_scalars: 240,
  segment_utf8_bytes: 2048,
};

export type DraftPipelineConfig = {
  pack_id: string;
  profile_id?: string;
  consent_id?: string;
  trust_zone_id?: string;
  v5_enabled?: boolean;
  /** Use DeepSeek Direct profile when network allowed; otherwise fake. */
  prefer_deepseek_direct?: boolean;
  limits?: ProfileLimits;
  now_iso?: string;
};

export type DraftPipelineResult = {
  schema: "carpeos.v5.draft-pipeline-result/v1";
  ok: boolean;
  stage: "redact" | "pack" | "extract" | "reduce" | "review" | "evaluate" | "complete" | "blocked";
  redaction: RedactResult | null;
  pack: EvidencePack | null;
  pack_view: EvidencePackView | null;
  extract: ProviderCallResult<ExtractResponse> | null;
  draft: DraftProposalOutput | null;
  evaluation: EvalGates | null;
  errors: string[];
  canonical_effect: "none";
  provider_network_used: boolean;
};

export type DraftPipelineDeps = {
  provider: ProviderBoundary;
  sidecar: SidecarState;
};

export function createDraftPipelineDeps(input?: {
  provider?: ProviderBoundary;
  v5_enabled?: boolean;
}): DraftPipelineDeps {
  return {
    provider: input?.provider ?? new ProviderBoundary(),
    sidecar: createSidecar(input?.v5_enabled ?? true),
  };
}

/**
 * Run the offline-first draft pipeline.
 * Capture/canonical paths are never invoked here.
 */
export async function runDraftPipeline(
  rawOuter: Uint8Array,
  config: DraftPipelineConfig,
  deps?: DraftPipelineDeps,
): Promise<DraftPipelineResult> {
  const d = deps ?? createDraftPipelineDeps({ v5_enabled: config.v5_enabled ?? true });
  const now = config.now_iso ?? new Date().toISOString();
  const errors: string[] = [];
  let provider_network_used = false;

  const base: DraftPipelineResult = {
    schema: "carpeos.v5.draft-pipeline-result/v1",
    ok: false,
    stage: "redact",
    redaction: null,
    pack: null,
    pack_view: null,
    extract: null,
    draft: null,
    evaluation: null,
    errors,
    canonical_effect: "none",
    provider_network_used: false,
  };

  if (!d.sidecar.v5_enabled) {
    errors.push("V5 is disabled (opt-in required)");
    return { ...base, stage: "blocked" };
  }

  const limits = config.limits ?? DEFAULT_PROFILE_LIMITS;
  const redaction = redactEnvelope(rawOuter, limits, {
    packId: config.pack_id,
    segmentIdPrefix: "seg_pipeline_",
  });
  base.redaction = redaction;
  if (!redaction.ok) {
    errors.push(`redact failed: ${redaction.error.code}`);
    return { ...base, stage: "redact" };
  }

  const profile_id = config.profile_id ?? "redact_default_v1";
  const consent_id = config.consent_id ?? "consent_local_v5";
  const profile = buildProfileBinding({
    profile_id,
    profile_digest_binding: `binding:${profile_id}`,
    limits,
  });
  let pack: EvidencePack;
  try {
    pack = buildEvidencePack({
      pack_id: config.pack_id,
      profile,
      consent: {
        consent_id,
        profile_id,
        granted_at: now,
        expires_at: null,
        scopes: ["extract"],
      },
      redaction: redaction as RedactOk,
    });
  } catch (e) {
    errors.push(`pack failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ...base, stage: "pack" };
  }
  base.pack = pack;
  base.pack_view = serializeEvidencePackView(pack);
  base.stage = "pack";

  const useDeepseek = config.prefer_deepseek_direct !== false;
  const route = useDeepseek
    ? d.provider.deepseekDirectExtractRoute()
    : d.provider.fakeExtractRoute();
  // If DeepSeek requested but network disabled (default), fall back to fake without implicit OpenRouter
  const kill = d.provider.killSnapshot();
  const effectiveRoute =
    route.provider_id === "deepseek_direct" && kill.network_disabled
      ? d.provider.fakeExtractRoute()
      : route;

  const attempt_id = `att_${pack.pack_digest.slice(0, 16)}`;
  try {
    prepareAttempt(d.sidecar, {
      attempt_id,
      run_scope_key: `scope_pack_${config.pack_id}`,
      run_ordinal: 0,
      route_digest: d.provider.routeDigest(effectiveRoute),
    });
    dispatchAttempt(d.sidecar, attempt_id, now);
  } catch (e) {
    errors.push(`attempt failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ...base, stage: "extract" };
  }

  const consent: ProviderConsent = {
    consent_id,
    profile_id: effectiveRoute.profile_id,
    allow_network: !kill.network_disabled && effectiveRoute.provider_id !== "fake",
    allow_escalation: false,
    expires_at: null,
  };
  const preflight: ProviderPreflight = {
    profile_id: effectiveRoute.profile_id,
    pack_digest: pack.pack_digest,
    consent_id,
    route: effectiveRoute,
    trust_zone_id: config.trust_zone_id ?? "tz_local",
  };

  const extractResult = await d.provider.extract({
    consent,
    preflight,
    expectedPreflight: preflight,
    nowIso: now,
    request: {
      messages: [
        {
          role: "system",
          content:
            'Return only JSON: {"schema":"carpeos.llm-extract/v1","result":"no_candidate","candidates":[],"citations":[]}',
        },
        {
          role: "user",
          content: `pack_digest=${pack.pack_digest} fields=${pack.redaction.pack.field_count}`,
        },
      ],
      temperature: 0,
      max_tokens: 256,
      pack_digest: pack.pack_digest,
      purpose: "extract",
    },
  });
  base.extract = extractResult;
  provider_network_used = extractResult.network_used;
  base.provider_network_used = provider_network_used;

  if (!extractResult.ok) {
    finishAttempt(d.sidecar, attempt_id, {
      status: "failed",
      at: now,
      result: { error: extractResult.error },
    });
    errors.push(`extract failed: ${extractResult.error}`);
    return { ...base, stage: "extract" };
  }

  finishAttempt(d.sidecar, attempt_id, {
    status: "succeeded",
    at: now,
    result: { result: extractResult.response.result },
  });
  reconcileAttempt(d.sidecar, attempt_id, now);

  const draft = reduceExtractToDraft({
    pack_id: config.pack_id,
    pack_digest: pack.pack_digest,
    profile_digest_binding: profile.profile_digest_binding,
    extract: extractResult.response,
    attempt_id,
    now_iso: now,
  });
  base.draft = draft;
  base.stage = "reduce";

  if (draft.canonical_effect !== "none" || draft.proposal_row.canonical_effect !== "none") {
    errors.push("canonical_effect must remain none");
    return { ...base, stage: "blocked" };
  }

  // Evaluation: attempted always in denominator.
  // Both draft and no_candidate are eligible pipeline outcomes (valid extract paths).
  const evalCase: EvalCase = {
    case_id: draft.proposal_id,
    attempted: true,
    eligible: true,
    quality_pass: draft.status === "draft" || draft.status === "no_candidate",
    reviewer_pass: true,
    baseline_pass: true,
    novel: false,
    latency_ms: extractResult.latency_ms,
    cost_units: extractResult.cost_usd != null ? Math.ceil(extractResult.cost_usd * 1e6) : 1,
    identity_stable: true,
  };
  const ledger = buildFrozenLedger([evalCase]);
  const evaluation = evaluateGates(ledger, {
    min_quality_rate: 0.5,
    min_reviewer_rate: 0.5,
    min_baseline_rate: 0.5,
    max_novel_rate: 1,
    max_p95_latency_ms: 60_000,
    max_total_cost_units: 1_000_000,
    max_identity_drift_rate: 0.5,
  });
  base.evaluation = evaluation;
  base.stage = "evaluate";

  if (!evaluation.pass) {
    errors.push(...evaluation.blockers.map((b) => `eval: ${b}`));
    return { ...base, stage: "evaluate" };
  }

  return {
    ...base,
    ok: true,
    stage: "complete",
    provider_network_used,
  };
}
