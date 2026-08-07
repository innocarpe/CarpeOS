#!/usr/bin/env node
/**
 * Q-S5 advisory metrics: agentic promote count, last-7d count, metadata-among-promote.
 * Usage: node scripts/quality-qs5-metrics.mjs [--home ~/.carpeos] [--days 7]
 * Public-safe: prints aggregate counts only (no statement dump unless --verbose).
 */
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const home = flag("--home", join(homedir(), ".carpeos"));
const days = Number(flag("--days", "7"));
const verbose = args.includes("--verbose");
const META =
  /hook event is SessionEnd|session id is|The agent type is|agentic\.evidence|hook_event_name/i;

const db = new DatabaseSync(join(home, "carpeos.sqlite"), { readOnly: true });
const rows = db
  .prepare(
    `SELECT disposition, policy_version, statement, created_at
     FROM knowledge_dispositions
     WHERE disposition = 'promote' AND policy_version LIKE 'agentic%'
     ORDER BY created_at DESC`,
  )
  .all();
const now = Date.now();
const windowMs = days * 24 * 60 * 60 * 1000;
let inWindow = 0;
let meta = 0;
const samples = [];
for (const r of rows) {
  const t = Date.parse(r.created_at);
  if (Number.isFinite(t) && now - t <= windowMs) inWindow += 1;
  if (META.test(r.statement ?? "")) meta += 1;
  if (verbose && samples.length < 5) samples.push((r.statement ?? "").slice(0, 120));
}
const report = {
  schema: "carpeos.agentic.qs5-metrics/v1",
  home_label: home === join(homedir(), ".carpeos") ? "~/.carpeos" : "custom",
  days,
  promote_total: rows.length,
  promote_in_window: inWindow,
  metadata_among_promote: meta,
  qs5_n_ok: inWindow >= 30,
  qs5_meta_ok: meta === 0,
  qs5_advisory_pass: inWindow >= 30 && meta === 0,
  note: "Q-S5 is advisory smoke (plan §10); not a release blocker.",
};
if (verbose) report.samples = samples;
db.close();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.qs5_advisory_pass ? 0 : 2;
