import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const OKF_MANIFEST_FILE_NAME = ".carpeos-okf-projection-manifest.json";

export function normalizeOkfRelativePath(path: string): string {
  if (path.length === 0) {
    throw new Error("OKF projection path is required");
  }
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error(`OKF projection path must be relative and use forward slashes: ${path}`);
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".." || segment === "~",
    )
  ) {
    throw new Error(`OKF projection path contains an unsafe segment: ${path}`);
  }
  if (!path.endsWith(".md")) {
    throw new Error(`OKF projection path must end in .md: ${path}`);
  }
  return segments.join("/");
}

export function resolveManagedOkfPath(outputRoot: string, bundleRelativePath: string): string {
  const root = resolve(outputRoot);
  const normalizedPath = normalizeOkfRelativePath(bundleRelativePath);
  const target = resolve(root, ...normalizedPath.split("/"));
  assertInsideOkfRoot(root, target);
  return target;
}

export function resolveOkfManifestPath(outputRoot: string): string {
  return resolve(outputRoot, OKF_MANIFEST_FILE_NAME);
}

export function assertInsideOkfRoot(outputRoot: string, targetPath: string): void {
  const root = resolve(outputRoot);
  const target = resolve(targetPath);
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return;
  }
  throw new Error(`OKF projection path escapes managed root: ${targetPath}`);
}

export function prepareSafeOkfDirectory(outputRoot: string, directoryPath: string): void {
  assertInsideOkfRoot(outputRoot, directoryPath);
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  if (lstatSync(outputRoot).isSymbolicLink()) {
    throw new Error(`OKF projection output root is a symlink: ${outputRoot}`);
  }
  const root = resolve(outputRoot);
  const target = resolve(directoryPath);
  const rel = relative(root, target);
  let current = root;
  for (const segment of rel === "" ? [] : rel.split(/[\\/]+/)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`OKF projection directory ancestor is a symlink: ${current}`);
    }
    if (!existsSync(current)) {
      mkdirSync(current, { mode: 0o700 });
    }
  }
  assertRealPathInsideOkfRoot(outputRoot, target);
}

export function prepareSafeOkfFile(outputRoot: string, targetPath: string): void {
  assertInsideOkfRoot(outputRoot, targetPath);
  assertNoSymlinkAncestor(outputRoot, dirname(targetPath));
  if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) {
    throw new Error(`OKF projection target is a symlink: ${targetPath}`);
  }
  assertRealPathInsideOkfRoot(outputRoot, dirname(targetPath));
}

export function assertSafeOkfExistingPath(outputRoot: string, targetPath: string): void {
  const root = resolve(outputRoot);
  const target = resolve(targetPath);
  assertInsideOkfRoot(root, target);
  assertNoSymlinkAncestor(root, dirname(target));
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`OKF projection target is a symlink: ${targetPath}`);
  }

  let current = root;
  if (existsSync(current)) {
    assertRealPathInsideOkfRoot(root, current);
  }
  const rel = relative(root, target);
  for (const segment of rel === "" ? [] : rel.split(/[\\/]+/)) {
    current = resolve(current, segment);
    if (existsSync(current)) {
      assertRealPathInsideOkfRoot(root, current);
    }
  }
}

function assertRealPathInsideOkfRoot(outputRoot: string, targetPath: string): void {
  assertInsideOkfRoot(realpathSync(outputRoot), realpathSync(targetPath));
}

function assertNoSymlinkAncestor(outputRoot: string, directoryPath: string): void {
  const root = resolve(outputRoot);
  const target = resolve(directoryPath);
  assertInsideOkfRoot(root, target);
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) {
    throw new Error(`OKF projection output root is a symlink: ${outputRoot}`);
  }
  let current = root;
  const rel = relative(root, target);
  for (const segment of rel === "" ? [] : rel.split(/[\\/]+/)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`OKF projection directory ancestor is a symlink: ${current}`);
    }
  }
}
