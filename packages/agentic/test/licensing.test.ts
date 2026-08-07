/**
 * ADR 0018 D3.3 licensing corpus under production promote-when-verified defaults.
 * Offline fake only. Cases omit hint_kind so kind assignment is measured.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadGoldenManifest } from "../src/golden.js";
import { evaluateAutoPromotePrecisionSuite } from "../src/precision.js";
import { verifyExtractCandidate } from "../src/verify.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const LICENSING = join(ROOT, "fixtures/agentic/v1/licensing-promote/manifest.json");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDb(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), "agentic-licensing-"));
  dirs.push(dir);
  return new DatabaseSync(join(dir, "agentic.sqlite"));
}

describe("ADR 0018 licensing-promote corpus", () => {
  it("passes under promote-when-verified defaults with zero must_not leaks", () => {
    const db = makeDb();
    const manifest = loadGoldenManifest(LICENSING);
    // No hint_kind on cases — kind is inferred.
    expect(manifest.cases.every((c) => c.hint_kind === undefined)).toBe(true);
    const report = evaluateAutoPromotePrecisionSuite(db, manifest, {
      now: new Date("2026-08-07T00:00:00Z"),
    });
    expect(report.must_not_promote_leaks).toBe(0);
    expect(report.pass).toBe(true);
    expect(report.golden_with_auto.network_used).toBe(false);
    // Decision-class cases should be able to promote under production defaults.
    expect(report.true_promote_count).toBeGreaterThan(0);
    db.close();
  });

  it("D3.1 statement grounding rejects fabricated decision over real quote", () => {
    const pack =
      "We decided to require make preflight before every PR. Also the sync credential check must stay enabled.";
    const v = verifyExtractCandidate(
      {
        kind: "decision",
        statement: "We decided to disable the sync credential check immediately",
        confidence: 0.99,
        citations: [
          {
            evidence_event_id: "evt_lic_ground",
            segment_id: "seg_0",
            start: 0,
            end: 12,
            quote: "We decided",
          },
        ],
      },
      pack,
    );
    expect(v.cite_ok).toBe(false);
  });
});
