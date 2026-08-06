import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildFinalV5Decision,
  classifyFourZeroReceipt,
  scanKnownFourZeroReceipts,
  selectPrimaryFourZeroSeam,
} from "../src/m8-seam.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("M8 four-zero seam classification", () => {
  it("classifies known g008 receipts without inventing release acceptance", () => {
    const classified = scanKnownFourZeroReceipts(repoRoot);
    expect(classified.length).toBeGreaterThanOrEqual(2);

    const install = classified.find((c) => c.path.includes("exact-install"));
    expect(install?.exists).toBe(true);
    expect(install?.body_free).toBe(true);
    expect(install?.accepted_as_install_smoke).toBe(true);
    expect(install?.accepted_as_release_seam).toBe(false);

    const gate = classified.find((c) => c.path.includes("release-gate-defer"));
    expect(gate?.exists).toBe(true);
    expect(gate?.accepted_as_release_seam).toBe(false);
    expect(gate?.blockers.some((b) => b.includes("release_gate"))).toBe(true);
  });

  it("does not select install-smoke as accepted release seam", () => {
    const classified = scanKnownFourZeroReceipts(repoRoot);
    const selected = selectPrimaryFourZeroSeam(classified);
    expect(selected.four_zero_seam?.accepted ?? false).toBe(false);
    expect(selected.install_smoke_ref?.path).toContain("exact-install");
    expect(selected.install_smoke_ref?.accepted).toBe(false);
  });

  it("builds final decision with deferred M8 and shippable draft lane", () => {
    const decision = buildFinalV5Decision({
      repoRoot,
      opt_in: true,
      timestamp: "2026-08-06T12:00:00.000Z",
    });
    expect(decision.schema).toBe("carpeos.v5.final-decision-receipt/v1");
    expect(decision.draft_only).toBe(true);
    expect(decision.canonical_effect).toBe("none");
    expect(decision.primary_provider).toBe("deepseek_direct");
    expect(decision.openrouter_required).toBe(false);
    expect(decision.capture_hot_path_wired).toBe(false);
    expect(decision.m8.status).toBe("deferred");
    expect(decision.m8_complete).toBe(false);
    expect(decision.draft_lane_shippable).toBe(true);
    expect(JSON.stringify(decision)).not.toMatch(/Bearer /);
  });

  it("flags missing receipt paths", () => {
    const missing = classifyFourZeroReceipt(repoRoot, "artifacts/missing/nope.json");
    expect(missing.exists).toBe(false);
    expect(missing.accepted_as_release_seam).toBe(false);
  });
});
