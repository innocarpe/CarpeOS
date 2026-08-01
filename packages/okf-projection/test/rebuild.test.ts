import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CanonicalEvent } from "@carpeos/schema";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildOkfManifest,
  buildOkfProjectionPlan,
  normalizeOkfRelativePath,
  rebuildOkfProjection,
  resolveManagedOkfPath,
  type OkfMapInput,
} from "../src/index.js";
import { assertSafeOkfExistingPath } from "../src/paths.js";

const roots: string[] = [];
const generatedAt = "2026-07-31T12:00:00Z";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("rebuildOkfProjection (K2)", () => {
  it("fails closed when no visible trust zone is supplied", () => {
    const outputRoot = makeRoot();
    const emptyConfig = { ...config(outputRoot), visibleTrustZoneIds: [] };
    expect(() =>
      buildOkfProjectionPlan({ snapshot: emptySnapshot(), config: emptyConfig }),
    ).toThrow("visibleTrustZoneIds is required");
    expect(() => rebuildOkfProjection({ snapshot: emptySnapshot(), config: emptyConfig })).toThrow(
      "visibleTrustZoneIds is required",
    );
  });
  it("writes mapped concepts, reserved roots, and a manifest on initial rebuild", () => {
    const outputRoot = makeRoot();
    const result = rebuildOkfProjection({
      snapshot: snapshotWithObservation(),
      config: config(outputRoot),
    });

    expect(result.manifestStatus).toBe("missing");
    expect(result.written).toEqual(["index.md", "log.md", "observations/obs_alpha.md"]);
    expect(readFileSync(join(outputRoot, "observations/obs_alpha.md"), "utf8")).toContain(
      "Observation",
    );
    expect(readFileSync(join(outputRoot, "index.md"), "utf8")).toContain("okf_version");
    expect(readFileSync(result.manifestPath, "utf8")).toContain(
      '"projection_version": "okf-export/v1"',
    );
  });
  it("accepts a safe missing nested target without creating its parent directories", () => {
    const outputRoot = makeRoot();
    const targetPath = join(outputRoot, "new", "nested", "projection.md");

    expect(() => assertSafeOkfExistingPath(outputRoot, targetPath)).not.toThrow();
    expect(existsSync(join(outputRoot, "new"))).toBe(false);
  });
  it("rejects a symlinked existing ancestor during preflight", () => {
    const outputRoot = makeRoot();
    const externalRoot = makeRoot();
    symlinkSync(externalRoot, join(outputRoot, "observations"));

    expect(() =>
      rebuildOkfProjection({ snapshot: snapshotWithObservation(), config: config(outputRoot) }),
    ).toThrow("directory ancestor is a symlink");
    expect(existsSync(join(externalRoot, "obs_alpha.md"))).toBe(false);
  });
  it("preflights missing-manifest collisions before writing other planned paths", () => {
    const outputRoot = makeRoot();
    const indexPath = join(outputRoot, "index.md");
    const logPath = join(outputRoot, "log.md");
    writeFileSync(logPath, "unmanaged log\n");

    expect(() =>
      rebuildOkfProjection({ snapshot: snapshotWithObservation(), config: config(outputRoot) }),
    ).toThrow("not owned by the previous manifest");
    expect(() => readFileSync(indexPath, "utf8")).toThrow();
    expect(readFileSync(logPath, "utf8")).toBe("unmanaged log\n");
  });
  it("preflights corrupt-manifest collisions before writing other planned paths", () => {
    const outputRoot = makeRoot();
    const indexPath = join(outputRoot, "index.md");
    const logPath = join(outputRoot, "log.md");
    const manifestPath = join(outputRoot, ".carpeos-okf-projection-manifest.json");
    writeFileSync(logPath, "unmanaged log\n");
    writeFileSync(manifestPath, "{ corrupt");

    expect(() =>
      rebuildOkfProjection({ snapshot: snapshotWithObservation(), config: config(outputRoot) }),
    ).toThrow("not owned by the previous manifest");
    expect(() => readFileSync(indexPath, "utf8")).toThrow();
    expect(readFileSync(logPath, "utf8")).toBe("unmanaged log\n");
    expect(readFileSync(manifestPath, "utf8")).toBe("{ corrupt");
  });
  it("preflights unmanaged new paths before deleting or rewriting validly owned files", () => {
    const outputRoot = makeRoot();
    rebuildOkfProjection({
      snapshot: snapshotWithObservation("alpha"),
      config: config(outputRoot),
    });
    const alphaPath = join(outputRoot, "observations/alpha.md");
    const betaPath = join(outputRoot, "observations/beta.md");
    const indexPath = join(outputRoot, "index.md");
    const manifestPath = join(outputRoot, ".carpeos-okf-projection-manifest.json");
    const initialIndex = readFileSync(indexPath, "utf8");
    const initialManifest = readFileSync(manifestPath, "utf8");
    writeFileSync(betaPath, "unmanaged beta\n");

    expect(() =>
      rebuildOkfProjection({
        snapshot: snapshotWithObservation("beta"),
        config: config(outputRoot),
      }),
    ).toThrow("not owned by the previous manifest");
    expect(readFileSync(alphaPath, "utf8")).toContain("Observation");
    expect(readFileSync(betaPath, "utf8")).toBe("unmanaged beta\n");
    expect(readFileSync(indexPath, "utf8")).toBe(initialIndex);
    expect(readFileSync(manifestPath, "utf8")).toBe(initialManifest);
  });

  it("produces stable sorted paths and an identical manifest for the same snapshot", () => {
    const outputRoot = makeRoot();
    const plan = buildOkfProjectionPlan({
      snapshot: snapshotWithObservation(),
      config: config(outputRoot),
    });
    expect(plan.files.map((file) => file.path)).toEqual([
      "index.md",
      "log.md",
      "observations/obs_alpha.md",
    ]);

    rebuildOkfProjection({ snapshot: snapshotWithObservation(), config: config(outputRoot) });
    const firstManifest = readFileSync(
      join(outputRoot, ".carpeos-okf-projection-manifest.json"),
      "utf8",
    );
    rebuildOkfProjection({ snapshot: snapshotWithObservation(), config: config(outputRoot) });
    expect(readFileSync(join(outputRoot, ".carpeos-okf-projection-manifest.json"), "utf8")).toBe(
      firstManifest,
    );
  });

  it("deletes only manifest-managed missing files under delete_missing", () => {
    const outputRoot = makeRoot();
    rebuildOkfProjection({ snapshot: snapshotWithObservation(), config: config(outputRoot) });
    writeFileSync(join(outputRoot, "unmanaged.md"), "keep me\n");

    const result = rebuildOkfProjection({ snapshot: emptySnapshot(), config: config(outputRoot) });
    expect(result.deleted).toEqual(["observations/obs_alpha.md"]);
    expect(() => readFileSync(join(outputRoot, "observations/obs_alpha.md"), "utf8")).toThrow();
    expect(readFileSync(join(outputRoot, "unmanaged.md"), "utf8")).toBe("keep me\n");
  });

  it("replaces only manifest-managed missing files with tombstones under tombstone_missing", () => {
    const outputRoot = makeRoot();
    rebuildOkfProjection({
      snapshot: snapshotWithObservation(),
      config: config(outputRoot, "tombstone_missing"),
    });
    mkdirSync(join(outputRoot, "notes"));
    writeFileSync(join(outputRoot, "notes", "unmanaged.md"), "keep me\n");

    const result = rebuildOkfProjection({
      snapshot: emptySnapshot(),
      config: config(outputRoot, "tombstone_missing"),
    });
    expect(result.deleted).toEqual([]);
    const tombstone = readFileSync(join(outputRoot, "observations/obs_alpha.md"), "utf8");
    expect(tombstone).toBe(`---
type: "Erasure Tombstone"
title: "Erased Projection"
status: "deprecated"
generated: { by: "carpeos/okf-export/v1" }
carpeos_projection: true
canonical_effect: "none"
---

# Erased Projection

This non-authoritative projection is deprecated. No prior content is retained.
`);
    expect(tombstone).not.toContain("A deterministic projection is reproducible.");
    expect(readFileSync(join(outputRoot, "notes", "unmanaged.md"), "utf8")).toBe("keep me\n");
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      projection_version: string;
      files: Array<{ path: string; tombstoned: boolean }>;
    };
    expect(manifest.projection_version).toBe("okf-export/v1");
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "observations/obs_alpha.md", tombstoned: true }),
      ]),
    );
  });

  it("rejects traversal, unsafe managed paths, and bundle escapes", () => {
    expect(() => normalizeOkfRelativePath("../outside.md")).toThrow("unsafe segment");
    expect(() => normalizeOkfRelativePath("nested\\outside.md")).toThrow("forward slashes");
    expect(() =>
      buildOkfManifest({
        files: [{ path: "../outside.md", content: "unsafe" }],
        visibleTrustZoneIds: ["tz_local_default"],
        pathPolicy: "delete_missing",
      }),
    ).toThrow("unsafe segment");
    expect(() => resolveManagedOkfPath(makeRoot(), "../outside.md")).toThrow("unsafe segment");
  });
});

function config(
  outputRoot: string,
  pathPolicy: "delete_missing" | "tombstone_missing" = "delete_missing",
) {
  return {
    outputRoot,
    pathPolicy,
    visibleTrustZoneIds: ["tz_local_default"],
    generatedAt,
  } as const;
}

function snapshotWithObservation(observationId = "obs_alpha"): OkfMapInput {
  const event = {
    event_id: `evt_observation_${observationId}`,
    event_type: "Observation",
    lifecycle_status: "active",
    trust_zone: { trust_zone_id: "tz_local_default", isolation: "local_device" },
    payload: {
      observation_id: observationId,
      observed_at: "2026-01-01T00:01:00Z",
      statement: "A deterministic projection is reproducible.",
      evidence_artifact_refs: [],
    },
  } as unknown as CanonicalEvent<"Observation">;
  return {
    events: [
      {
        event_id: event.event_id,
        event_type: event.event_type,
        trust_zone_id: "tz_local_default",
        event,
      },
    ],
  };
}

function emptySnapshot(): OkfMapInput {
  return { events: [] };
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "carpeos-okf-k2-"));
  roots.push(root);
  return root;
}
