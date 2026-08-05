import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "./policy-identity.mjs";

const SHA1 = /^[0-9a-f]{40}$/;

export class TreeDigestError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "TreeDigestError";
    this.code = code;
  }
}

/**
 * Hashes Git's complete recursive tree listing, including NUL-delimited paths.
 * The digest is content-addressed and independent of the checkout directory.
 */
export function gitTreeSha256({ repoRoot = process.cwd(), commit = "HEAD" } = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0)
    throwTreeDigestError("invalid_root", "repository root is required");
  if (commit !== "HEAD" && !SHA1.test(commit))
    throwTreeDigestError("invalid_commit", "commit must be HEAD or a full SHA-1");

  const result = spawnSync("git", ["ls-tree", "-r", "-z", "--full-tree", commit], {
    cwd: resolve(repoRoot),
    encoding: "buffer",
    env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  if (result.error) throwTreeDigestError("git_failed", result.error.message);
  if (result.status !== 0)
    throwTreeDigestError("git_failed", result.stderr?.toString("utf8") || "git ls-tree failed");
  return sha256Hex(result.stdout ?? Buffer.alloc(0));
}
export function gitHeadSha({ repoRoot = process.cwd() } = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0)
    throwTreeDigestError("invalid_root", "repository root is required");
  const result = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: resolve(repoRoot),
    encoding: "utf8",
    env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  if (result.error) throwTreeDigestError("git_failed", result.error.message);
  if (result.status !== 0) {
    throwTreeDigestError("git_failed", result.stderr?.trim() || "git rev-parse failed");
  }
  const headSha = result.stdout.trim();
  if (!SHA1.test(headSha)) throwTreeDigestError("invalid_commit", "HEAD is not a full SHA-1");
  return headSha;
}

function throwTreeDigestError(code, message) {
  throw new TreeDigestError(code, message);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [repoRoot = process.cwd(), commit = "HEAD"] = process.argv.slice(2);
    process.stdout.write(`${gitTreeSha256({ repoRoot, commit })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
