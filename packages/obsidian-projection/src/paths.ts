import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { compareText, sha256Digest } from "./utils.js";

export const MANIFEST_FILE_NAME = ".carpeos-obsidian-projection-manifest.json";

export function normalizeVaultRelativePath(path: string): string {
  if (path.length === 0) {
    throw new Error("projection path is required");
  }
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error(`projection path must be relative and use forward slashes: ${path}`);
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".." || segment === "~",
    )
  ) {
    throw new Error(`projection path contains an unsafe segment: ${path}`);
  }
  if (!path.endsWith(".md")) {
    throw new Error(`projection path must end in .md: ${path}`);
  }
  return segments.join("/");
}

export function resolveManagedPath(outputRoot: string, vaultRelativePath: string): string {
  const root = resolve(outputRoot);
  const normalizedPath = normalizeVaultRelativePath(vaultRelativePath);
  const absolutePath = resolve(root, ...normalizedPath.split("/"));
  assertInsideRoot(root, absolutePath);
  return absolutePath;
}

export function resolveManifestPath(outputRoot: string): string {
  return resolve(outputRoot, MANIFEST_FILE_NAME);
}

export function assertInsideRoot(outputRoot: string, targetPath: string): void {
  const root = resolve(outputRoot);
  const target = resolve(targetPath);
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return;
  }
  throw new Error(`projection path escapes managed root: ${targetPath}`);
}

export function assertRealPathInsideRoot(outputRoot: string, targetPath: string): void {
  const root = realpathSync(outputRoot);
  const target = realpathSync(targetPath);
  assertInsideRoot(root, target);
}

export function prepareSafeManagedFile(outputRoot: string, targetPath: string): void {
  assertInsideRoot(outputRoot, targetPath);
  assertNoSymlinkAncestor(outputRoot, dirname(targetPath));
  if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) {
    throw new Error(`projection target is a symlink: ${targetPath}`);
  }
  assertRealPathInsideRoot(outputRoot, dirname(targetPath));
}

export function prepareSafeManagedDirectory(outputRoot: string, directoryPath: string): void {
  assertInsideRoot(outputRoot, directoryPath);
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  if (lstatSync(outputRoot).isSymbolicLink()) {
    throw new Error(`projection output root is a symlink: ${outputRoot}`);
  }
  const root = resolve(outputRoot);
  const target = resolve(directoryPath);
  const relativeDirectory = relative(root, target);
  const segments = relativeDirectory === "" ? [] : relativeDirectory.split(/[\\/]+/);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`projection directory ancestor is a symlink: ${current}`);
    }
    if (!existsSync(current)) {
      mkdirSync(current, { mode: 0o700 });
    }
  }
  assertRealPathInsideRoot(outputRoot, target);
}

export function assertSafeManagedExistingPath(outputRoot: string, targetPath: string): void {
  assertInsideRoot(outputRoot, targetPath);
  assertNoSymlinkAncestor(outputRoot, dirname(targetPath));
  if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) {
    throw new Error(`projection managed path is a symlink: ${targetPath}`);
  }
  if (existsSync(targetPath)) {
    assertRealPathInsideRoot(outputRoot, targetPath);
  }
}

export function safePathSegment(input: string): string {
  if (
    input.length === 0 ||
    input.includes("/") ||
    input.includes("\\") ||
    input.includes("\0") ||
    input.includes("..")
  ) {
    throw new Error(`unsafe path segment: ${input}`);
  }
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  const digest = sha256Digest(input).slice("sha-256:".length, "sha-256:".length + 10);
  return `${slug.length === 0 ? "item" : slug}-${digest}`;
}

export function vaultRootLink(path: string, label: string): string {
  const normalizedPath = normalizeVaultRelativePath(path);
  const safeLabel = label.replaceAll("|", "-").replaceAll("]", ")");
  return `[[/${normalizedPath}|${safeLabel}]]`;
}

export function comparePaths(left: { path: string }, right: { path: string }): number {
  return compareText(left.path, right.path);
}

function assertNoSymlinkAncestor(outputRoot: string, directoryPath: string): void {
  const root = resolve(outputRoot);
  const target = resolve(directoryPath);
  assertInsideRoot(root, target);
  const relativeDirectory = relative(root, target);
  const segments = relativeDirectory === "" ? [] : relativeDirectory.split(/[\\/]+/);
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) {
    throw new Error(`projection output root is a symlink: ${outputRoot}`);
  }
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`projection directory ancestor is a symlink: ${current}`);
    }
  }
}
