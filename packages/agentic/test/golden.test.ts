import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateGoldenManifest, loadGoldenManifest } from "../src/golden.js";
import { runAgenticProposalPipeline } from "../src/pipeline.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const MANIFEST = join(ROOT, "fixtures/agentic/v1/golden-12/manifest.json");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDb(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), "agentic-golden-"));
  dirs.push(dir);
  return new DatabaseSync(join(dir, "agentic.sqlite"));
}

describe("golden-12 offline", () => {
  it("passes the vertical-slice corpus network-off", () => {
    const db = makeDb();
    const manifest = loadGoldenManifest(MANIFEST);
    expect(manifest.cases).toHaveLength(12);
    const report = evaluateGoldenManifest(db, manifest, {
      now: new Date("2026-08-06T12:00:00Z"),
    });
    if (!report.pass) {
      const fails = report.results.filter((r) => !r.pass);
      throw new Error(
        `golden failures: ${fails.map((f) => `${f.id}:${f.notes.join("|")}`).join("; ")}`,
      );
    }
    expect(report.pass).toBe(true);
    expect(report.network_used).toBe(false);
    expect(report.canonical_effect).toBe("none");
    db.close();
  });

  it("is idempotent on full corpus replay", () => {
    const db = makeDb();
    const manifest = loadGoldenManifest(MANIFEST);
    const a = evaluateGoldenManifest(db, manifest);
    const b = evaluateGoldenManifest(db, manifest);
    expect(a.pass_count).toBe(b.pass_count);
    // No proposal flood: second run reuses proposal ids (same counts)
    const proposalsA = a.results.flatMap((r) => r.pipeline.proposals.map((p) => p.proposal_id));
    const proposalsB = b.results.flatMap((r) => r.pipeline.proposals.map((p) => p.proposal_id));
    expect(new Set(proposalsA).size).toBe(proposalsA.length);
    expect(proposalsA.sort()).toEqual(proposalsB.sort());
    db.close();
  });

  it("agentic-off yields no proposals for decision cases", () => {
    const db = makeDb();
    const r = runAgenticProposalPipeline(db, {
      trust_zone_id: "tz",
      source_event_id: "evt",
      hook_event_name: "SessionEnd",
      signal_text: "Decision: we will require make preflight before opening any pull request.",
      agentic_enabled: false,
    });
    expect(r.stage).toBe("disabled");
    expect(r.proposals).toEqual([]);
    db.close();
  });

  it("never uses network on fake path (capture-adjacent fence)", () => {
    const db = makeDb();
    const r = runAgenticProposalPipeline(db, {
      trust_zone_id: "tz",
      source_event_id: "evt",
      hook_event_name: "SessionEnd",
      signal_text: "Decision: we will require make preflight before opening any pull request.",
      allow_network: false,
      mode: "fake",
    });
    expect(r.network_used).toBe(false);
    db.close();
  });
});
