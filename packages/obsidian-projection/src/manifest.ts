import { readFileSync } from "node:fs";
import type {
  ObsidianGeneratedFile,
  ObsidianProjectionManifest,
  ObsidianProjectionNote,
} from "@carpeos/schema";
import { validateConformance } from "@carpeos/schema";
import { normalizeVaultRelativePath, resolveManagedPath } from "./paths.js";
import type { ProjectionConfig, RenderedNote } from "./render.js";
import { comparePaths } from "./paths.js";
import { sha256Digest, stableJson } from "./utils.js";

export type PreviousManifestRead =
  | { status: "missing" }
  | { status: "valid"; manifest: ObsidianProjectionManifest }
  | { status: "corrupt"; error: string };

export function buildManifest(input: {
  outputRoot: string;
  config: Required<ProjectionConfig>;
  notes: readonly RenderedNote[];
}): ObsidianProjectionManifest {
  assertNoNotePathCollisions(input.notes);
  const files = input.notes.map((rendered) =>
    generatedFileFromNote(rendered.note, rendered.content),
  );
  assertNoPathCollisions(files);
  const manifest: ObsidianProjectionManifest = {
    schema_version: "v1",
    manifest_type: "obsidian_projection_manifest",
    projection_version: input.config.projectionVersion,
    output_root: input.outputRoot,
    generated_at_policy: input.config.generatedAtPolicy,
    config_digest: sha256Digest(
      stableJson({
        projection_version: input.config.projectionVersion,
        visible_trust_zone_ids: input.config.visibleTrustZoneIds,
        path_policy: input.config.pathPolicy,
        generated_at_policy: input.config.generatedAtPolicy,
        non_authoritative_marker: input.config.nonAuthoritativeMarker,
      }),
    ),
    visible_trust_zone_ids: [...input.config.visibleTrustZoneIds],
    path_policy: input.config.pathPolicy,
    files: files.sort(comparePaths),
  };
  assertValidManifest(manifest);
  return manifest;
}

export function readPreviousManifest(path: string): PreviousManifestRead {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return { status: "missing" };
    }
    throw error;
  }

  try {
    const manifest = JSON.parse(raw) as ObsidianProjectionManifest;
    assertValidManifest(manifest);
    return { status: "valid", manifest };
  } catch (error) {
    return { status: "corrupt", error: error instanceof Error ? error.message : String(error) };
  }
}

export function assertValidManifest(manifest: ObsidianProjectionManifest): void {
  const conformance = validateConformance("obsidianProjection", manifest);
  if (!conformance.valid) {
    throw new Error(`invalid Obsidian projection manifest: ${conformance.errors.join("; ")}`);
  }
}

export function assertValidNote(note: ObsidianProjectionNote): void {
  const conformance = validateConformance("obsidianProjection", note);
  if (!conformance.valid) {
    throw new Error(`invalid Obsidian projection note: ${conformance.errors.join("; ")}`);
  }
}

export function validatePreviousManifestFileBounds(input: {
  outputRoot: string;
  manifest: ObsidianProjectionManifest;
}): void {
  for (const file of input.manifest.files) {
    resolveManagedPath(input.outputRoot, normalizeVaultRelativePath(file.path));
  }
}

function generatedFileFromNote(
  note: ObsidianProjectionNote,
  content: string,
): ObsidianGeneratedFile {
  assertValidNote(note);
  return {
    path: note.path,
    category: note.category,
    source_lineage: note.source_lineage,
    content_digest: sha256Digest(content),
    tombstoned: false,
  };
}

function assertNoPathCollisions(files: readonly ObsidianGeneratedFile[]): void {
  const seen = new Map<string, string>();
  for (const file of files) {
    const existing = seen.get(file.path);
    const signature = stableJson({
      category: file.category,
      source_lineage: file.source_lineage,
      content_digest: file.content_digest,
    });
    if (existing !== undefined && existing !== signature) {
      throw new Error(`Obsidian projection path collision: ${file.path}`);
    }
    seen.set(file.path, signature);
  }
}

function assertNoNotePathCollisions(notes: readonly RenderedNote[]): void {
  const seen = new Set<string>();
  for (const note of notes) {
    if (seen.has(note.note.path)) {
      throw new Error(`Obsidian projection path collision: ${note.note.path}`);
    }
    seen.add(note.note.path);
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === code
  );
}
