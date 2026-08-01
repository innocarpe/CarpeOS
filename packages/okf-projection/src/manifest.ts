import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { compareText } from "./utils.js";
import { normalizeOkfRelativePath, resolveManagedOkfPath } from "./paths.js";

export type OkfManifestFile = {
  path: string;
  content_digest: string;
  tombstoned: boolean;
};

export type OkfProjectionManifest = {
  schema_version: "v1";
  manifest_type: "okf_projection_manifest";
  projection_version: "okf-export/v1";
  okf_version: "0.2";
  visible_trust_zone_ids: string[];
  path_policy: "delete_missing" | "tombstone_missing";
  files: OkfManifestFile[];
};

export type PreviousOkfManifestRead =
  | { status: "missing" }
  | { status: "valid"; manifest: OkfProjectionManifest }
  | { status: "corrupt"; error: string };

export function buildOkfManifest(input: {
  files: readonly { path: string; content: string; tombstoned?: boolean }[];
  visibleTrustZoneIds: readonly string[];
  pathPolicy: "delete_missing" | "tombstone_missing";
}): OkfProjectionManifest {
  const files = input.files
    .map((file) => ({
      path: normalizeOkfRelativePath(file.path),
      content_digest: sha256Digest(file.content),
      tombstoned: file.tombstoned === true,
    }))
    .sort(compareManifestPaths);
  assertUniqueManifestPaths(files);
  return {
    schema_version: "v1",
    manifest_type: "okf_projection_manifest",
    projection_version: "okf-export/v1",
    okf_version: "0.2",
    visible_trust_zone_ids: uniqueSorted(input.visibleTrustZoneIds),
    path_policy: input.pathPolicy,
    files,
  };
}

export function readPreviousOkfManifest(path: string): PreviousOkfManifestRead {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return { status: "missing" };
    throw error;
  }
  try {
    const manifest = JSON.parse(raw) as OkfProjectionManifest;
    assertValidOkfManifest(manifest);
    return { status: "valid", manifest };
  } catch (error) {
    return { status: "corrupt", error: error instanceof Error ? error.message : String(error) };
  }
}

export function assertValidOkfManifest(manifest: OkfProjectionManifest): void {
  if (
    manifest.schema_version !== "v1" ||
    manifest.manifest_type !== "okf_projection_manifest" ||
    manifest.projection_version !== "okf-export/v1" ||
    manifest.okf_version !== "0.2" ||
    !Array.isArray(manifest.visible_trust_zone_ids) ||
    !manifest.visible_trust_zone_ids.every((zone) => typeof zone === "string") ||
    (manifest.path_policy !== "delete_missing" && manifest.path_policy !== "tombstone_missing") ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("invalid OKF projection manifest");
  }
  for (const file of manifest.files) {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof file.path !== "string" ||
      typeof file.content_digest !== "string" ||
      typeof file.tombstoned !== "boolean"
    ) {
      throw new Error("invalid OKF projection manifest file");
    }
    normalizeOkfRelativePath(file.path);
  }
  assertUniqueManifestPaths(manifest.files);
}

export function validatePreviousOkfManifestFileBounds(input: {
  outputRoot: string;
  manifest: OkfProjectionManifest;
}): void {
  for (const file of input.manifest.files) {
    resolveManagedOkfPath(input.outputRoot, file.path);
  }
}

export function stableOkfManifestJson(manifest: OkfProjectionManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function sha256Digest(content: string): string {
  return `sha-256:${createHash("sha256").update(content).digest("hex")}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function compareManifestPaths(left: { path: string }, right: { path: string }): number {
  return compareText(left.path, right.path);
}

function assertUniqueManifestPaths(files: readonly OkfManifestFile[]): void {
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`OKF projection path collision: ${file.path}`);
    paths.add(file.path);
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
