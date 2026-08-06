#!/usr/bin/env node
/**
 * Emit the durable V5-M8 / final draft-lane decision receipt (body-free).
 *
 * Usage (from repo root):
 *   node packages/v5/scripts/m8-decision.mjs
 *   node packages/v5/scripts/m8-decision.mjs --out artifacts/v5/m8/final-decision-receipt.json
 *
 * Never invents 4.0 acceptance. Never prints credentials.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

// Prefer built dist; fall back note if missing
const distUrl = pathToFileURL(join(repoRoot, "packages/v5/dist/m8-seam.js")).href;

function parseArgs(argv) {
  let out = join(repoRoot, "artifacts/v5/m8/final-decision-receipt.json");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = resolve(argv[++i] ?? out);
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage: node packages/v5/scripts/m8-decision.mjs [--out path]");
      process.exit(0);
    }
  }
  return { out };
}

const { out } = parseArgs(process.argv.slice(2));
const mod = await import(distUrl);
const receipt = mod.buildFinalV5Decision({
  repoRoot,
  opt_in: true,
  timestamp: new Date().toISOString(),
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });

console.log(
  JSON.stringify(
    {
      ok: receipt.draft_lane_shippable,
      out,
      m8_status: receipt.m8.status,
      m8_complete: receipt.m8_complete,
      draft_lane_shippable: receipt.draft_lane_shippable,
      install_smoke: receipt.install_smoke_ref?.path ?? null,
      selection_notes: receipt.selection_notes,
      canonical_effect: receipt.canonical_effect,
    },
    null,
    2,
  ),
);

process.exit(receipt.draft_lane_shippable ? 0 : 1);
