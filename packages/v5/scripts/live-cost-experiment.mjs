#!/usr/bin/env node
/**
 * Live DeepSeek Direct cost experiment (opt-in, operator-only).
 *
 * - Never runs in the capture hot path.
 * - Requires explicit --allow-network.
 * - Reads DEEPSEEK_API_KEY from the environment only (never from argv/files in-repo).
 * - Synthetic pack digests only; body-free receipts (no prompts/completions/keys).
 * - Default output: ~/.carpeos/v5-cost-experiments/<timestamp>.json
 *
 * Usage:
 *   set -a && source ~/.carpeos/v5-provider.env && set +a
 *   node packages/v5/scripts/live-cost-experiment.mjs --dry-run
 *   node packages/v5/scripts/live-cost-experiment.mjs --allow-network --spend-cap-usd 0.05
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE_URL = "https://api.deepseek.com";
const MODEL_ID = "deepseek-v4-flash";
const PROVIDER_ID = "deepseek_direct";
const ROUTE = "deepseek_direct_extract_v1";

/** Official pricing snapshot (docs as of 2026-08-06). Re-verify before large runs. */
const PRICE_SNAPSHOT = {
  schema: "carpeos.v5.price-snapshot/v1",
  provider_id: PROVIDER_ID,
  model_id: MODEL_ID,
  currency: "USD",
  input_cache_hit_per_1m: 0.0028,
  input_cache_miss_per_1m: 0.14,
  output_per_1m: 0.28,
  source: "https://api-docs.deepseek.com/quick_start/pricing/",
  timestamp: "2026-08-06T00:00:00.000Z",
  formula:
    "cost_usd = (cache_hit/1e6)*hit + (cache_miss/1e6)*miss + (output/1e6)*out; null cache splits => all input as miss",
};

const DEFAULT_CASES = [
  {
    case_id: "synth-title-01",
    pack_digest: "sha256:v5_cost_exp_synth_title_01",
    field: "document.title",
    note: "short title token",
  },
  {
    case_id: "synth-body-01",
    pack_digest: "sha256:v5_cost_exp_synth_body_01",
    field: "document.body",
    note: "short body token",
  },
];

function parseArgs(argv) {
  const out = {
    allowNetwork: false,
    dryRun: false,
    spendCapUsd: 0.05,
    cases: DEFAULT_CASES.length,
    outPath: null,
    timeoutMs: 30_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allow-network") out.allowNetwork = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--spend-cap-usd") out.spendCapUsd = Number(argv[++i]);
    else if (a === "--cases") out.cases = Number(argv[++i]);
    else if (a === "--out") out.outPath = argv[++i];
    else if (a === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isFinite(out.spendCapUsd) || out.spendCapUsd <= 0) {
    throw new Error("--spend-cap-usd must be a positive number");
  }
  if (!Number.isInteger(out.cases) || out.cases < 1 || out.cases > DEFAULT_CASES.length) {
    throw new Error(`--cases must be integer 1..${DEFAULT_CASES.length}`);
  }
  return out;
}

function sha256Json(value) {
  return "sha256:" + createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
}

export function calculateCostUsd(usage, price = PRICE_SNAPSHOT) {
  const { input_tokens, output_tokens, cache_hit_tokens, cache_miss_tokens } = usage;
  if (input_tokens == null || output_tokens == null) {
    return { ok: false, error: "usage_missing" };
  }
  if (input_tokens < 0 || output_tokens < 0) {
    return { ok: false, error: "cost_calculation_failed" };
  }
  let hit = cache_hit_tokens;
  let miss = cache_miss_tokens;
  if (hit == null || miss == null) {
    hit = 0;
    miss = input_tokens;
  }
  if (cache_hit_tokens != null && cache_miss_tokens != null && hit + miss !== input_tokens) {
    return { ok: false, error: "cost_calculation_failed" };
  }
  const hitPrice = price.input_cache_hit_per_1m ?? price.input_cache_miss_per_1m;
  const cost =
    (hit / 1e6) * hitPrice +
    (miss / 1e6) * price.input_cache_miss_per_1m +
    (output_tokens / 1e6) * price.output_per_1m;
  if (!Number.isFinite(cost) || cost < 0) {
    return { ok: false, error: "cost_calculation_failed" };
  }
  return { ok: true, cost_usd: cost };
}

function assertNoSecretLeak(serialized, key) {
  if (key && serialized.includes(key)) {
    throw new Error("secret material leaked into receipt serialization");
  }
  if (/Bearer\s+[A-Za-z0-9._-]+/i.test(serialized)) {
    throw new Error("authorization header leaked into receipt serialization");
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function smokeModels(key, timeoutMs) {
  const t0 = Date.now();
  const res = await fetchWithTimeout(
    `${BASE_URL}/models`,
    { headers: { authorization: `Bearer ${key}` } },
    timeoutMs,
  );
  const latency_ms = Date.now() - t0;
  let hasFlash = false;
  let model_count = null;
  if (res.ok) {
    const body = await res.json();
    const data = Array.isArray(body?.data) ? body.data : [];
    model_count = data.length;
    hasFlash = data.some((m) => m?.id === MODEL_ID);
  } else {
    await res.text().catch(() => "");
  }
  return {
    ok: res.ok && hasFlash,
    http_status: res.status,
    latency_ms,
    model_count,
    has_deepseek_v4_flash: hasFlash,
  };
}

function buildExtractPrompt(caseDef) {
  // Synthetic redacted-pack *references only* — no real document bodies.
  return {
    messages: [
      {
        role: "system",
        content:
          "You are a draft-only extractor. Respond with a single JSON object, no markdown. " +
          'Required shape: {"schema":"carpeos.llm-extract/v1","result":"no_candidate","candidates":[],"citations":[]}. ' +
          "Prefer result=no_candidate for synthetic probes.",
      },
      {
        role: "user",
        content: `Synthetic EvidencePack probe (redacted). pack_digest=${caseDef.pack_digest} field=${caseDef.field} note=${caseDef.note}`,
      },
    ],
  };
}

function parseUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return {
      input_tokens: null,
      output_tokens: null,
      cache_hit_tokens: null,
      cache_miss_tokens: null,
    };
  }
  return {
    input_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    output_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    cache_hit_tokens:
      typeof usage.prompt_cache_hit_tokens === "number" ? usage.prompt_cache_hit_tokens : null,
    cache_miss_tokens:
      typeof usage.prompt_cache_miss_tokens === "number" ? usage.prompt_cache_miss_tokens : null,
  };
}

function tryParseExtract(content) {
  if (typeof content !== "string") return { parse_ok: false, result_kind: null };
  let text = content.trim();
  // strip common markdown fences without logging content length details beyond ok/fail
  if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }
  try {
    const inner = JSON.parse(text);
    if (inner?.schema !== "carpeos.llm-extract/v1") {
      return { parse_ok: false, result_kind: null };
    }
    return { parse_ok: true, result_kind: typeof inner.result === "string" ? inner.result : null };
  } catch {
    return { parse_ok: false, result_kind: null };
  }
}

async function runCase(key, caseDef, timeoutMs) {
  const { messages } = buildExtractPrompt(caseDef);
  const t0 = Date.now();
  let res;
  try {
    res = await fetchWithTimeout(
      `${BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL_ID,
          messages,
          temperature: 0,
          max_tokens: 128,
        }),
      },
      timeoutMs,
    );
  } catch {
    return {
      case_id: caseDef.case_id,
      pack_digest: caseDef.pack_digest,
      ok: false,
      error: "timeout",
      latency_ms: Date.now() - t0,
      http_status: null,
      usage: {
        input_tokens: null,
        output_tokens: null,
        cache_hit_tokens: null,
        cache_miss_tokens: null,
      },
      parse_ok: false,
      result_kind: null,
      cost_usd: null,
      cost_error: "usage_missing",
    };
  }

  const latency_ms = Date.now() - t0;
  const rawText = await res.text();
  let usage = {
    input_tokens: null,
    output_tokens: null,
    cache_hit_tokens: null,
    cache_miss_tokens: null,
  };
  let parse_ok = false;
  let result_kind = null;
  if (res.ok) {
    try {
      const body = JSON.parse(rawText);
      usage = parseUsage(body.usage);
      const content = body.choices?.[0]?.message?.content;
      const parsed = tryParseExtract(content);
      parse_ok = parsed.parse_ok;
      result_kind = parsed.result_kind;
    } catch {
      parse_ok = false;
    }
  }

  const calc = calculateCostUsd(usage);
  return {
    case_id: caseDef.case_id,
    pack_digest: caseDef.pack_digest,
    ok: res.ok && calc.ok,
    error: res.ok ? (calc.ok ? null : calc.error) : res.status === 429 ? "http_429" : "http_error",
    latency_ms,
    http_status: res.status,
    usage,
    parse_ok,
    result_kind,
    cost_usd: calc.ok ? calc.cost_usd : null,
    cost_error: calc.ok ? null : calc.error,
  };
}

function defaultOutPath() {
  const dir = join(homedir(), ".carpeos", "v5-cost-experiments");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dir, `deepseek-direct-${stamp}.json`);
}

function buildLedger(input) {
  const results = input.case_results.map((r) => {
    const record = {
      schema: "carpeos.v5.cost-record/v1",
      provider_id: PROVIDER_ID,
      model_id: MODEL_ID,
      route: ROUTE,
      pack_digest: r.pack_digest,
      case_id: r.case_id,
      input_tokens: r.usage.input_tokens,
      output_tokens: r.usage.output_tokens,
      cache_hit_tokens: r.usage.cache_hit_tokens,
      cache_miss_tokens: r.usage.cache_miss_tokens,
      latency_ms: r.latency_ms,
      http_status: r.http_status,
      status: r.ok ? "ok" : "error",
      error_code: r.error,
      parse_ok: r.parse_ok,
      result_kind: r.result_kind,
      cost_usd: r.cost_usd,
      cost_error: r.cost_error,
      currency: "USD",
      canonical_effect: "none",
    };
    return {
      schema: "carpeos.v5.cost-experiment-result/v1",
      case_id: r.case_id,
      pack_digest: r.pack_digest,
      record,
      record_digest: sha256Json(record),
      canonical_effect: "none",
    };
  });

  const spend_usd_total = results.reduce((n, r) => n + (r.record.cost_usd ?? 0), 0);
  return {
    schema: "carpeos.v5.cost-experiment-ledger/v1",
    frozen: true,
    timestamp: new Date().toISOString(),
    provider_id: PROVIDER_ID,
    model_id: MODEL_ID,
    route: ROUTE,
    base_url: BASE_URL,
    price_snapshot: PRICE_SNAPSHOT,
    spend_cap_usd: input.spendCapUsd,
    spend_usd_total,
    kill_switch_tripped: input.killSwitchTripped,
    smoke: input.smoke,
    results,
    canonical_effect: "none",
    notes: [
      "Synthetic pack digests only; no EvidencePack bodies.",
      "Credentials are never written to this ledger.",
      "Not a capture-hot-path or release gate.",
    ],
  };
}

function printHelp() {
  console.log(`Usage:
  node packages/v5/scripts/live-cost-experiment.mjs --dry-run
  node packages/v5/scripts/live-cost-experiment.mjs --allow-network [--spend-cap-usd 0.05] [--cases 1|2]

Environment:
  DEEPSEEK_API_KEY   required for --allow-network (load from ~/.carpeos/v5-provider.env)

Output:
  Default: ~/.carpeos/v5-cost-experiments/deepseek-direct-<timestamp>.json
  Body-free only. Never commit live receipts with secrets (none should be present).
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const selected = DEFAULT_CASES.slice(0, args.cases);
  if (args.dryRun) {
    const plan = {
      schema: "carpeos.v5.cost-experiment-plan/v1",
      dry_run: true,
      allow_network: false,
      model_id: MODEL_ID,
      base_url: BASE_URL,
      spend_cap_usd: args.spendCapUsd,
      cases: selected.map((c) => ({
        case_id: c.case_id,
        pack_digest: c.pack_digest,
      })),
      price_snapshot: PRICE_SNAPSHOT,
      canonical_effect: "none",
    };
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (!args.allowNetwork) {
    console.error("Refusing to run: pass --allow-network (or use --dry-run).");
    process.exit(2);
  }

  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    console.error("DEEPSEEK_API_KEY is not set. Source ~/.carpeos/v5-provider.env first.");
    process.exit(2);
  }

  const smoke = await smokeModels(key, args.timeoutMs);
  if (!smoke.ok) {
    console.error(
      JSON.stringify({
        ok: false,
        step: "smoke",
        http_status: smoke.http_status,
        has_deepseek_v4_flash: smoke.has_deepseek_v4_flash,
      }),
    );
    process.exit(1);
  }

  const case_results = [];
  let spend = 0;
  let killSwitchTripped = false;

  for (const c of selected) {
    if (spend >= args.spendCapUsd) {
      killSwitchTripped = true;
      break;
    }
    const result = await runCase(key, c, args.timeoutMs);
    case_results.push(result);
    if (typeof result.cost_usd === "number") {
      spend += result.cost_usd;
    }
    if (spend >= args.spendCapUsd) {
      killSwitchTripped = true;
      break;
    }
  }

  const ledger = buildLedger({
    case_results,
    spendCapUsd: args.spendCapUsd,
    killSwitchTripped,
    smoke,
  });

  const serialized = JSON.stringify(ledger, null, 2) + "\n";
  assertNoSecretLeak(serialized, key);

  const outPath = args.outPath ?? defaultOutPath();
  mkdirSync(join(outPath, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(outPath, serialized, { mode: 0o600 });

  // Console: body-free summary only
  console.log(
    JSON.stringify(
      {
        ok: case_results.every((r) => r.ok) && !killSwitchTripped,
        out: outPath,
        spend_usd_total: ledger.spend_usd_total,
        spend_cap_usd: ledger.spend_cap_usd,
        kill_switch_tripped: ledger.kill_switch_tripped,
        cases: ledger.results.map((r) => ({
          case_id: r.case_id,
          cost_usd: r.record.cost_usd,
          tokens: {
            in: r.record.input_tokens,
            out: r.record.output_tokens,
          },
          latency_ms: r.record.latency_ms,
          parse_ok: r.record.parse_ok,
          http_status: r.record.http_status,
        })),
        smoke: ledger.smoke,
        ledger_digest: sha256Json(ledger),
      },
      null,
      2,
    ),
  );
}

// Allow unit tests to import pure helpers when executed under node --experimental-vm-modules
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("live-cost-experiment.mjs") ||
    process.argv[1].includes("live-cost-experiment.mjs"));

if (isMain) {
  main().catch((err) => {
    console.error(
      JSON.stringify({ ok: false, error: "fatal", message: String(err?.message ?? err) }),
    );
    process.exit(1);
  });
}
