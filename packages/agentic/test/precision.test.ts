import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateAgenticGate } from "../src/gate.js";
import { loadGoldenManifest } from "../src/golden.js";
import {
  AGENTIC_AUTO_PROMOTE_PRECISION_MIN,
  evaluateAutoPromotePrecisionSuite,
} from "../src/precision.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const MANIFEST = join(ROOT, "fixtures/agentic/v1/golden-12/manifest.json");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDb(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), "agentic-precision-"));
  dirs.push(dir);
  return new DatabaseSync(join(dir, "agentic.sqlite"));
}

describe("P3 auto-promote precision suite", () => {
  it("meets precision ≥ 0.90 with zero must_not_promote leaks offline", () => {
    const db = makeDb();
    const manifest = loadGoldenManifest(MANIFEST);
    const report = evaluateAutoPromotePrecisionSuite(db, manifest, {
      now: new Date("2026-08-07T00:00:00Z"),
    });
    expect(report.precision_min).toBe(AGENTIC_AUTO_PROMOTE_PRECISION_MIN);
    expect(report.must_not_promote_leaks).toBe(0);
    expect(report.precision).toBeGreaterThanOrEqual(0.9);
    expect(report.pass).toBe(true);
    expect(report.golden_with_auto.network_used).toBe(false);
    db.close();
  });

  it("gate still rejects noise path even with allow_auto_promote", () => {
    const g = evaluateAgenticGate({
      candidate: {
        kind: "decision",
        statement: "ok",
        confidence: 0.99,
        citations: [],
      },
      cite_ok: false,
      secret_ok: true,
      allow_auto_promote: true,
    });
    expect(g.decision).toBe("reject");
  });
});
