import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the public package version for `carpeos version`.
 *
 * Preference order:
 * 1. esbuild-injected `process.env.CARPEOS_EMBEDDED_VERSION` (npm package build)
 * 2. nearby package.json (monorepo or installed package layout)
 * 3. `0.0.0-dev` fallback for incomplete checkouts
 */
export function packageVersion(): string {
  const embedded = process.env.CARPEOS_EMBEDDED_VERSION;
  if (typeof embedded === "string" && embedded.length > 0 && embedded !== "undefined") {
    return embedded;
  }
  return tryReadPackageJsonVersion() ?? "0.0.0-dev";
}

export function packageName(): string {
  // Public npm identity — monorepo workspace name is @carpeos/cli and must not leak.
  return "@innocarpe/carpeos";
}

function tryReadPackageJsonVersion(): string | undefined {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      // npm package: dist/cli.js → ../package.json (@innocarpe/carpeos)
      join(here, "../package.json"),
      // monorepo apps/carpeos-cli/src → packages/carpeos/package.json
      join(here, "../../packages/carpeos/package.json"),
      // monorepo apps/carpeos-cli/dist → packages/carpeos/package.json
      join(here, "../../../packages/carpeos/package.json"),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const raw = JSON.parse(readFileSync(path, "utf8")) as {
        name?: string;
        version?: string;
      };
      // Skip internal workspace packages (e.g. @carpeos/cli).
      if (raw.name !== undefined && raw.name !== "@innocarpe/carpeos") {
        continue;
      }
      if (typeof raw.version === "string" && raw.version.length > 0) {
        return raw.version;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}
