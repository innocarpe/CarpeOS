/**
 * Offline cost experiment against synthetic redacted EvidencePack fixtures.
 * Never runs in the capture hot path. Body-free metadata only.
 */

import {
  buildCostComputationReceipt,
  buildCostRecord,
  calculateCostUsd,
  type CostComputationReceipt,
} from "./provider-cost.js";
import {
  DEEPSEEK_DIRECT_FLASH_PRICE_SNAPSHOT,
  OPENROUTER_DEEPSEEK_PRICE_SNAPSHOT,
} from "./provider-profiles.js";
import type {
  BodyFreeCostRecord,
  PriceSnapshot,
  ProviderCallResult,
  ProviderId,
  ProviderProfileId,
  UsageMetadata,
} from "./provider-types.js";
import type { ExtractResponse } from "./reducer.js";

export type CostExperimentCase = {
  case_id: string;
  /** Synthetic pack digest only — never embed pack bodies. */
  pack_digest: string;
  profile_id: ProviderProfileId;
  provider_id: ProviderId;
  model_id: string;
};

export type CostExperimentResult = {
  schema: "carpeos.v5.cost-experiment-result/v1";
  case_id: string;
  pack_digest: string;
  record: BodyFreeCostRecord;
  receipt: CostComputationReceipt;
  canonical_effect: "none";
};

export type CostExperimentLedger = {
  schema: "carpeos.v5.cost-experiment-ledger/v1";
  frozen: true;
  results: CostExperimentResult[];
  spend_usd_total: number;
  spend_cap_usd: number;
  kill_switch_tripped: boolean;
  canonical_effect: "none";
};

export function priceSnapshotForProfile(profile_id: ProviderProfileId): PriceSnapshot | null {
  if (profile_id === "deepseek_direct_extract_v1") return DEEPSEEK_DIRECT_FLASH_PRICE_SNAPSHOT;
  if (profile_id === "openrouter_deepseek_extract_v1") return OPENROUTER_DEEPSEEK_PRICE_SNAPSHOT;
  return null;
}

/**
 * Record body-free cost metadata from a completed provider call.
 * Does not invoke network. Suitable for experiment post-processing.
 */
export function recordCostFromCall(input: {
  case_id: string;
  pack_digest: string;
  profile_id: ProviderProfileId;
  provider_id: ProviderId;
  model_id: string;
  call: ProviderCallResult<ExtractResponse>;
  price: PriceSnapshot;
}): CostExperimentResult {
  const usage: UsageMetadata = input.call.ok
    ? input.call.usage
    : {
        input_tokens: null,
        output_tokens: null,
        cache_hit_tokens: null,
        cache_miss_tokens: null,
      };
  const latency_ms = input.call.latency_ms;
  const calc = input.call.ok
    ? calculateCostUsd(usage, input.price)
    : {
        ok: false as const,
        error: "usage_missing" as const,
        reason: "call failed",
      };
  const cost_usd = calc.ok ? calc.cost_usd : null;
  const record = buildCostRecord({
    provider_id: input.provider_id,
    model_id: input.model_id,
    route: input.profile_id,
    usage,
    latency_ms,
    status: input.call.ok ? "ok" : "error",
    error_code: input.call.ok ? null : input.call.error,
    cost_usd,
  });
  const receipt = buildCostComputationReceipt({
    price_snapshot: input.price,
    record,
    calculation: calc.ok
      ? calc
      : {
          ok: false,
          error: calc.error === "usage_missing" ? "usage_missing" : "cost_calculation_failed",
          reason: "reason" in calc ? calc.reason : "call failed",
        },
  });
  return {
    schema: "carpeos.v5.cost-experiment-result/v1",
    case_id: input.case_id,
    pack_digest: input.pack_digest,
    record,
    receipt,
    canonical_effect: "none",
  };
}

export function buildExperimentLedger(input: {
  results: CostExperimentResult[];
  spend_cap_usd: number;
}): CostExperimentLedger {
  const spend_usd_total = input.results.reduce((n, r) => n + (r.record.cost_usd ?? 0), 0);
  return {
    schema: "carpeos.v5.cost-experiment-ledger/v1",
    frozen: true,
    results: input.results,
    spend_usd_total,
    spend_cap_usd: input.spend_cap_usd,
    kill_switch_tripped: spend_usd_total >= input.spend_cap_usd,
    canonical_effect: "none",
  };
}

/**
 * Compare Direct vs OpenRouter on the same pack_digest / settings.
 * Does not require equal model_id strings (route-specific slugs differ)
 * but requires the same pack_digest and purpose.
 */
export function compareRouteCosts(
  a: CostExperimentResult,
  b: CostExperimentResult,
): {
  same_pack: boolean;
  comparable: boolean;
  a_cost_usd: number | null;
  b_cost_usd: number | null;
  delta_usd: number | null;
} {
  const same_pack = a.pack_digest === b.pack_digest;
  const a_cost = a.record.cost_usd;
  const b_cost = b.record.cost_usd;
  const comparable = same_pack && a_cost !== null && b_cost !== null;
  return {
    same_pack,
    comparable,
    a_cost_usd: a_cost,
    b_cost_usd: b_cost,
    delta_usd: comparable && a_cost !== null && b_cost !== null ? b_cost - a_cost : null,
  };
}
