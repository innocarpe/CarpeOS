import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildOkfManifest,
  readPreviousOkfManifest,
  stableOkfManifestJson,
  validatePreviousOkfManifestFileBounds,
  type OkfProjectionManifest,
  type PreviousOkfManifestRead,
} from "./manifest.js";
import { mapEventsToOkf } from "./map.js";
import {
  assertSafeOkfExistingPath,
  prepareSafeOkfDirectory,
  prepareSafeOkfFile,
  resolveManagedOkfPath,
  resolveOkfManifestPath,
} from "./paths.js";
import { renderOkfConcept } from "./render.js";
import type { OkfMapConfig, OkfMapInput } from "./types.js";
import { compareText, uniqueSorted } from "./utils.js";

export type OkfProjectionConfig = OkfMapConfig & {
  outputRoot: string;
  pathPolicy?: "delete_missing" | "tombstone_missing";
};

export type OkfProjectionFile = {
  path: string;
  content: string;
  tombstoned?: boolean;
};

export type OkfProjectionPlan = {
  files: OkfProjectionFile[];
  manifest: OkfProjectionManifest;
};

export type RebuildOkfProjectionResult = {
  manifestPath: string;
  manifestStatus: PreviousOkfManifestRead["status"];
  written: string[];
  deleted: string[];
  preservedDeletionBecauseManifestCorrupt: boolean;
};

/** Build the deterministic, bundle-relative OKF files without touching disk. */
export function buildOkfProjectionPlan(input: {
  snapshot: OkfMapInput;
  config: OkfProjectionConfig;
}): OkfProjectionPlan {
  const config = normalizeOkfProjectionConfig(input.config);
  assertVisibleTrustZones(config);
  const mapped = mapEventsToOkf(input.snapshot, config);
  const files: OkfProjectionFile[] = [
    ...mapped.concepts.map((concept) => ({
      path: concept.path,
      content: renderOkfConcept(concept),
    })),
    { path: "index.md", content: mapped.indexMarkdown },
    { path: "log.md", content: mapped.logMarkdown },
  ].sort(compareFiles);
  assertUniquePaths(files);
  return {
    files,
    manifest: buildOkfManifest({
      files,
      visibleTrustZoneIds: config.visibleTrustZoneIds,
      pathPolicy: config.pathPolicy,
    }),
  };
}

/** Rebuild only files recorded in the prior OKF projection manifest. */
export function rebuildOkfProjection(input: {
  snapshot: OkfMapInput;
  config: OkfProjectionConfig;
}): RebuildOkfProjectionResult {
  const config = normalizeOkfProjectionConfig(input.config);
  assertVisibleTrustZones(config);
  prepareSafeOkfDirectory(config.outputRoot, config.outputRoot);

  const plan = buildOkfProjectionPlan({ snapshot: input.snapshot, config });
  const manifestPath = resolveOkfManifestPath(config.outputRoot);
  const previous = readPreviousOkfManifest(manifestPath);
  const missing = previous.status === "valid" ? missingPreviousFiles(previous, plan.files) : [];
  if (previous.status === "valid") {
    validatePreviousOkfManifestFileBounds({
      outputRoot: config.outputRoot,
      manifest: previous.manifest,
    });
  }

  const tombstones = config.pathPolicy === "tombstone_missing" ? missing.map(tombstoneFile) : [];
  const files = [...plan.files, ...tombstones].sort(compareFiles);
  assertUniquePaths(files);
  const manifest = buildOkfManifest({
    files,
    visibleTrustZoneIds: config.visibleTrustZoneIds,
    pathPolicy: config.pathPolicy,
  });
  assertPreflightTargets({
    outputRoot: config.outputRoot,
    files,
    missing,
    manifestPath,
    previous,
  });

  const deleted =
    config.pathPolicy === "delete_missing"
      ? deleteMissingPreviousFiles(config.outputRoot, missing)
      : [];

  for (const file of files) {
    atomicWrite(
      config.outputRoot,
      resolveManagedOkfPath(config.outputRoot, file.path),
      file.content,
    );
  }
  atomicWrite(config.outputRoot, manifestPath, stableOkfManifestJson(manifest));

  return {
    manifestPath,
    manifestStatus: previous.status,
    written: files.map((file) => file.path),
    deleted,
    preservedDeletionBecauseManifestCorrupt: previous.status === "corrupt",
  };
}

function normalizeOkfProjectionConfig(config: OkfProjectionConfig): Required<OkfProjectionConfig> {
  return {
    ...config,
    visibleTrustZoneIds: uniqueSorted(config.visibleTrustZoneIds),
    includeHeld: config.includeHeld === true,
    includeReferencedEvidence: config.includeReferencedEvidence !== false,
    generatedBy: config.generatedBy ?? "carpeos/okf-export/v1",
    pathPolicy: config.pathPolicy ?? "delete_missing",
    exportNote: config.exportNote ?? "",
  };
}
function assertVisibleTrustZones(config: Required<OkfProjectionConfig>): void {
  if (config.visibleTrustZoneIds.length === 0) {
    throw new Error("visibleTrustZoneIds is required");
  }
}
function assertPreflightTargets(input: {
  outputRoot: string;
  files: readonly OkfProjectionFile[];
  missing: readonly string[];
  manifestPath: string;
  previous: PreviousOkfManifestRead;
}): void {
  const previouslyManaged =
    input.previous.status === "valid"
      ? new Set(input.previous.manifest.files.map((file) => file.path))
      : new Set<string>();

  for (const file of input.files) {
    const target = resolveManagedOkfPath(input.outputRoot, file.path);
    assertSafeOkfExistingPath(input.outputRoot, target);
    if (existsSync(target) && !previouslyManaged.has(file.path)) {
      throw new Error(`OKF projection path is not owned by the previous manifest: ${file.path}`);
    }
  }

  for (const path of input.missing) {
    if (!previouslyManaged.has(path)) {
      throw new Error(`OKF projection path is not owned by the previous manifest: ${path}`);
    }
    assertSafeOkfExistingPath(input.outputRoot, resolveManagedOkfPath(input.outputRoot, path));
  }

  assertSafeOkfExistingPath(input.outputRoot, input.manifestPath);
  if (input.previous.status === "corrupt") {
    throw new Error("OKF projection manifest is corrupt and cannot establish ownership");
  }
}

function missingPreviousFiles(
  previous: Extract<PreviousOkfManifestRead, { status: "valid" }>,
  files: readonly OkfProjectionFile[],
): string[] {
  const nextPaths = new Set(files.map((file) => file.path));
  return previous.manifest.files
    .map((file) => file.path)
    .filter((path) => !nextPaths.has(path))
    .sort(compareText);
}

function deleteMissingPreviousFiles(outputRoot: string, paths: readonly string[]): string[] {
  const deleted: string[] = [];
  for (const path of paths) {
    const target = resolveManagedOkfPath(outputRoot, path);
    assertSafeOkfExistingPath(outputRoot, target);
    rmSync(target, { force: true });
    deleted.push(path);
  }
  return deleted;
}

function tombstoneFile(path: string): OkfProjectionFile {
  return {
    path,
    tombstoned: true,
    content: `---
type: "Erasure Tombstone"
title: "Erased Projection"
status: "deprecated"
generated: { by: "carpeos/okf-export/v1" }
carpeos_projection: true
canonical_effect: "none"
---

# Erased Projection

This non-authoritative projection is deprecated. No prior content is retained.
`,
  };
}

function atomicWrite(outputRoot: string, path: string, content: string): void {
  prepareSafeOkfDirectory(outputRoot, dirname(path));
  prepareSafeOkfFile(outputRoot, path);
  const temporaryPath = `${path}.tmp-${process.pid}`;
  prepareSafeOkfFile(outputRoot, temporaryPath);
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

function assertUniquePaths(files: readonly OkfProjectionFile[]): void {
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`OKF projection path collision: ${file.path}`);
    paths.add(file.path);
  }
}

function compareFiles(left: OkfProjectionFile, right: OkfProjectionFile): number {
  return compareText(left.path, right.path);
}
