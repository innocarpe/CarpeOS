import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LocalRetrievalInputSnapshot } from "@carpeos/local-store";
import {
  assertSafeManagedExistingPath,
  comparePaths,
  prepareSafeManagedDirectory,
  prepareSafeManagedFile,
  resolveManagedPath,
  resolveManifestPath,
} from "./paths.js";
import {
  buildManifest,
  readPreviousManifest,
  validatePreviousManifestFileBounds,
  type PreviousManifestRead,
} from "./manifest.js";
import {
  normalizeProjectionConfig,
  renderProjectionNotes,
  type ProjectionConfig,
  type RenderedNote,
} from "./render.js";
import { stableJson } from "./utils.js";

export type RebuildObsidianProjectionResult = {
  manifestPath: string;
  manifestStatus: PreviousManifestRead["status"];
  written: string[];
  deleted: string[];
  preservedDeletionBecauseManifestCorrupt: boolean;
};

export function rebuildObsidianProjection(input: {
  snapshot: LocalRetrievalInputSnapshot;
  config: ProjectionConfig;
}): RebuildObsidianProjectionResult {
  const config = normalizeProjectionConfig(input.config);
  if (config.visibleTrustZoneIds.length === 0) {
    throw new Error("visibleTrustZoneIds is required");
  }
  prepareSafeManagedDirectory(config.outputRoot, config.outputRoot);

  const notes = renderProjectionNotes({
    events: input.snapshot.events,
    erasures: input.snapshot.erasures,
    config,
  });
  assertUniqueRenderedPaths(notes);
  const manifest = buildManifest({ outputRoot: config.outputRoot, config, notes });
  const manifestPath = resolveManifestPath(config.outputRoot);
  const previous = readPreviousManifest(manifestPath);
  const deleted =
    previous.status === "valid"
      ? deleteMissingPreviousFiles(config.outputRoot, previous, manifest)
      : [];

  for (const note of notes) {
    atomicWrite(
      config.outputRoot,
      resolveManagedPath(config.outputRoot, note.note.path),
      note.content,
    );
  }
  atomicWrite(config.outputRoot, `${manifestPath}.tmp-target`, `${stableJson(manifest)}\n`);
  renameSync(`${manifestPath}.tmp-target`, manifestPath);

  return {
    manifestPath,
    manifestStatus: previous.status,
    written: manifest.files.map((file) => file.path),
    deleted,
    preservedDeletionBecauseManifestCorrupt: previous.status === "corrupt",
  };
}

function deleteMissingPreviousFiles(
  outputRoot: string,
  previous: Extract<PreviousManifestRead, { status: "valid" }>,
  next: { files: readonly { path: string }[] },
): string[] {
  validatePreviousManifestFileBounds({ outputRoot, manifest: previous.manifest });
  const nextPaths = new Set(next.files.map((file) => file.path));
  const deleted: string[] = [];
  for (const file of previous.manifest.files.slice().sort(comparePaths)) {
    if (nextPaths.has(file.path)) {
      continue;
    }
    const managedPath = resolveManagedPath(outputRoot, file.path);
    assertSafeManagedExistingPath(outputRoot, managedPath);
    rmSync(managedPath, { force: true });
    deleted.push(file.path);
  }
  return deleted;
}

function atomicWrite(outputRoot: string, path: string, content: string): void {
  prepareSafeManagedDirectory(outputRoot, dirname(path));
  prepareSafeManagedFile(outputRoot, path);
  const tmpPath = `${path}.tmp-${process.pid}`;
  prepareSafeManagedFile(outputRoot, tmpPath);
  writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
  renameSync(tmpPath, path);
}

function assertUniqueRenderedPaths(notes: readonly RenderedNote[]): void {
  const paths = new Set<string>();
  for (const note of notes) {
    if (paths.has(note.note.path)) {
      throw new Error(`Obsidian projection path collision: ${note.note.path}`);
    }
    paths.add(note.note.path);
  }
}
