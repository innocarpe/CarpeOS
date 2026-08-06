/**
 * Body-free cost calculation from usage + price snapshot.
 * Never touches request/response bodies.
 */

import { digestSha256 } from "./jcs.js";
import type {
  BodyFreeCostRecord,
  PriceSnapshot,
  ProviderErrorCode,
  ProviderId,
  ProviderProfileId,
  UsageMetadata,
} from "./provider-types.js";

export type CostCalculation =
  | { ok: true; cost_usd: number; formula_applied: string }
  | { ok: false; error: "usage_missing" | "cost_calculation_failed"; reason: string };

/**
 * formula:
 *   cost = (cache_hit/1e6)*hit_price + (cache_miss/1e6)*miss_price + (output/1e6)*out_price
 * If cache splits are null, all input_tokens are treated as cache_miss.
 */
export function calculateCostUsd(usage: UsageMetadata, price: PriceSnapshot): CostCalculation {
  const { input_tokens, output_tokens, cache_hit_tokens, cache_miss_tokens } = usage;
  if (input_tokens === null || output_tokens === null) {
    return { ok: false, error: "usage_missing", reason: "input_tokens or output_tokens null" };
  }
  if (input_tokens < 0 || output_tokens < 0) {
    return { ok: false, error: "cost_calculation_failed", reason: "negative token counts" };
  }

  let hit = cache_hit_tokens;
  let miss = cache_miss_tokens;
  if (hit === null || miss === null) {
    hit = 0;
    miss = input_tokens;
  }
  if (hit + miss !== input_tokens) {
    // Prefer explicit splits when present but inconsistent → fail closed
    if (cache_hit_tokens !== null && cache_miss_tokens !== null) {
      return {
        ok: false,
        error: "cost_calculation_failed",
        reason: "cache_hit_tokens + cache_miss_tokens !== input_tokens",
      };
    }
    hit = 0;
    miss = input_tokens;
  }

  const hitPrice = price.input_cache_hit_per_1m ?? price.input_cache_miss_per_1m;
  const missPrice = price.input_cache_miss_per_1m;
  const outPrice = price.output_per_1m;
  if (![hitPrice, missPrice, outPrice].every((n) => Number.isFinite(n) && n >= 0)) {
    return { ok: false, error: "cost_calculation_failed", reason: "non-finite price fields" };
  }

  const cost_usd =
    (hit / 1e6) * hitPrice + (miss / 1e6) * missPrice + (output_tokens / 1e6) * outPrice;
  if (!Number.isFinite(cost_usd) || cost_usd < 0) {
    return { ok: false, error: "cost_calculation_failed", reason: "non-finite cost" };
  }
  return {
    ok: true,
    cost_usd,
    formula_applied: price.formula,
  };
}

export function buildCostRecord(input: {
  provider_id: ProviderId;
  model_id: string;
  route: ProviderProfileId;
  usage: UsageMetadata;
  latency_ms: number;
  status: "ok" | "error";
  error_code: ProviderErrorCode | null;
  cost_usd: number | null;
}): BodyFreeCostRecord {
  return {
    schema: "carpeos.v5.cost-record/v1",
    provider_id: input.provider_id,
    model_id: input.model_id,
    route: input.route,
    input_tokens: input.usage.input_tokens,
    output_tokens: input.usage.output_tokens,
    cache_hit_tokens: input.usage.cache_hit_tokens,
    cache_miss_tokens: input.usage.cache_miss_tokens,
    latency_ms: input.latency_ms,
    status: input.status,
    error_code: input.error_code,
    cost_usd: input.cost_usd,
    currency: "USD",
    canonical_effect: "none",
  };
}

export type CostComputationReceipt = {
  schema: "carpeos.v5.cost-computation-receipt/v1";
  timestamp: string;
  price_snapshot: PriceSnapshot;
  record: BodyFreeCostRecord;
  calculation: CostCalculation;
  pass: boolean;
  /** Digest of body-free record only — never includes secrets or bodies. */
  record_digest: string;
  canonical_effect: "none";
};

export function buildCostComputationReceipt(input: {
  price_snapshot: PriceSnapshot;
  record: BodyFreeCostRecord;
  calculation: CostCalculation;
  timestamp?: string;
}): CostComputationReceipt {
  return {
    schema: "carpeos.v5.cost-computation-receipt/v1",
    timestamp: input.timestamp ?? new Date().toISOString(),
    price_snapshot: input.price_snapshot,
    record: input.record,
    calculation: input.calculation,
    pass: input.calculation.ok && input.record.cost_usd !== null,
    record_digest: digestSha256(input.record),
    canonical_effect: "none",
  };
}
