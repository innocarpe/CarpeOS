#!/usr/bin/env node
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const distDir = join(packageRoot, "dist");
mkdirSync(distDir, { recursive: true });

const packageMeta = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const embeddedVersion = typeof packageMeta.version === "string" ? packageMeta.version : "0.0.0-dev";

// Prefer TypeScript sources so the npm package can build without a prior monorepo tsc.
const alias = {
  "@carpeos/capture": join(repoRoot, "packages/capture/src/index.ts"),
  "@carpeos/local-store": join(repoRoot, "packages/local-store/src/index.ts"),
  "@carpeos/retrieval": join(repoRoot, "packages/retrieval/src/index.ts"),
  "@carpeos/schema": join(repoRoot, "packages/schema/src/index.ts"),
  "@carpeos/sync-client": join(repoRoot, "packages/sync-client/src/index.ts"),
  "@carpeos/mcp-server": join(repoRoot, "apps/carpeos-mcp-server/src/exports.ts"),
  "@carpeos/obsidian-projection": join(repoRoot, "packages/obsidian-projection/src/index.ts"),
  "@carpeos/okf-projection": join(repoRoot, "packages/okf-projection/src/index.ts"),
  "@carpeos/v5": join(repoRoot, "packages/v5/src/index.ts"),
};

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  alias,
  // Keep published runtime deps external.
  external: ["@modelcontextprotocol/*", "ajv", "ajv/*", "node:*"],
  loader: { ".json": "json" },
  define: {
    "process.env.CARPEOS_EMBEDDED_VERSION": JSON.stringify(embeddedVersion),
  },
};

await esbuild.build({
  ...common,
  entryPoints: [join(repoRoot, "apps/carpeos-cli/src/index.ts")],
  outfile: join(distDir, "cli.js"),
});

await esbuild.build({
  ...common,
  entryPoints: [join(repoRoot, "apps/carpeos-mcp-server/src/stdio.ts")],
  outfile: join(distDir, "mcp-server-lib.js"),
});

writeFileSync(
  join(distDir, "mcp-server.js"),
  `import { serveCarpeosMcpStdio } from "./mcp-server-lib.js";
try {
  serveCarpeosMcpStdio();
} catch {
  process.stderr.write("carpeos-mcp-server: startup failed\\n");
  process.exitCode = 1;
}
`,
  "utf8",
);

// Install-local helpers used by `carpeos setup` when installed from npm.
const setupOut = join(distDir, "setup");
mkdirSync(setupOut, { recursive: true });
cpSync(join(repoRoot, "scripts/lib/install-core.mjs"), join(setupOut, "install-core.mjs"));
cpSync(join(repoRoot, "scripts/lib/install-hooks.mjs"), join(setupOut, "install-hooks.mjs"));
// Capture-hook templates (adapters are not in the npm package otherwise).
const hooksOut = join(setupOut, "hooks");
mkdirSync(hooksOut, { recursive: true });
for (const host of ["claude", "codex", "grok"]) {
  const hostOut = join(hooksOut, host);
  mkdirSync(hostOut, { recursive: true });
  if (host === "claude") {
    cpSync(
      join(repoRoot, "adapters/claude/settings.json.example"),
      join(hostOut, "settings.json.example"),
    );
  } else {
    cpSync(
      join(repoRoot, `adapters/${host}/hooks.json.example`),
      join(hostOut, "hooks.json.example"),
    );
  }
}
writeFileSync(
  join(setupOut, "run-setup.mjs"),
  `${readFileSync(join(packageRoot, "scripts/run-setup.template.mjs"), "utf8")}`,
  "utf8",
);

for (const name of ["cli.js", "mcp-server.js"]) {
  chmodSync(join(distDir, name), 0o755);
}

// Ensure package LICENSE is present for npm
try {
  cpSync(join(repoRoot, "LICENSE"), join(packageRoot, "LICENSE"));
} catch {
  // optional in partial checkouts
}

process.stdout.write(`built @innocarpe/carpeos -> ${distDir}\n`);
