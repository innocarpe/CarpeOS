#!/usr/bin/env node
/**
 * Fail-closed check: public package version must appear on the mandatory
 * release documentation surface. For majors (X.0.0), also require PRD + DoD
 * + architecture overview mentions.
 *
 * Does not call npm/GitHub remotes. See docs/maintainers/major-release-surface.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function argVersion() {
  const idx = process.argv.indexOf("--version");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return JSON.parse(read("packages/carpeos/package.json")).version;
}

function mustInclude(rel, needles, errors) {
  if (!existsSync(join(root, rel))) {
    errors.push(`missing file: ${rel}`);
    return;
  }
  const text = read(rel);
  for (const needle of needles) {
    if (!text.includes(needle)) errors.push(`${rel}: missing ${JSON.stringify(needle)}`);
  }
}

function main() {
  const version = argVersion();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`invalid version: ${version}`);
    process.exit(2);
  }
  const [major, minor, patch] = version.split(".").map(Number);
  const isMajorish = minor === 0 && patch === 0;
  const errors = [];

  mustInclude("CHANGELOG.md", [`## [${version}]`], errors);
  mustInclude("README.md", [`@innocarpe/carpeos@${version}`, `v${version}`], errors);
  mustInclude("README.ko.md", [`@innocarpe/carpeos@${version}`, `v${version}`], errors);
  mustInclude(
    "packages/carpeos/README.md",
    [`@innocarpe/carpeos@${version}`, version],
    errors,
  );
  mustInclude(
    "docs/maintainers/versioning-and-releases.md",
    [`@innocarpe/carpeos@${version}`],
    errors,
  );
  mustInclude("docs/maintainers/major-release-surface.md", ["Mandatory surface checklist"], errors);

  if (isMajorish) {
    const dod = `docs/maintainers/product-${version}.md`;
    const prd = `docs/PRD-v${major}.md`;
    mustInclude(dod, [version, `@innocarpe/carpeos@${version}`], errors);
    mustInclude(prd, ["Status:"], errors);
    mustInclude("docs/PRD.md", [`PRD-v${major}.md`, `product-${version}.md`], errors);
    mustInclude(
      "docs/architecture/overview.md",
      [`Product ${major}`, version],
      errors,
    );
  }

  if (errors.length > 0) {
    console.error(`major-release-surface: FAIL for ${version}`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error("See docs/maintainers/major-release-surface.md");
    process.exit(1);
  }
  console.log(`major-release-surface: OK for ${version}${isMajorish ? " (major)" : ""}`);
}

main();
