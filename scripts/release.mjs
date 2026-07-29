#!/usr/bin/env node
/**
 * Cut a SemVer release for @innocarpe/carpeos.
 *
 * Usage:
 *   node scripts/release.mjs patch|minor|major|X.Y.Z [--dry-run] [--force-tag]
 *
 * - Bumps packages/carpeos/package.json version
 * - Moves CHANGELOG [Unreleased] into a versioned section (or ensures section exists)
 * - Creates commit + annotated tag vX.Y.Z
 * - Does NOT push (maintainer pushes main + tag to trigger CI publish)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "packages/carpeos/package.json");
const changelogPath = join(root, "CHANGELOG.md");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !opts.allowFail) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

function parseArgs(argv) {
  const out = { bump: "", dryRun: false, forceTag: false, help: false };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--force-tag") out.forceTag = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (!out.bump) out.bump = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return out;
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`invalid semver: ${v}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function formatSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function bumpVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) {
    return bump;
  }
  const v = parseSemver(current);
  if (bump === "major") {
    return formatSemver({ major: v.major + 1, minor: 0, patch: 0 });
  }
  if (bump === "minor") {
    return formatSemver({ major: v.major, minor: v.minor + 1, patch: 0 });
  }
  if (bump === "patch") {
    return formatSemver({ major: v.major, minor: v.minor, patch: v.patch + 1 });
  }
  throw new Error(`bump must be patch|minor|major|X.Y.Z (got ${bump})`);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fold Unreleased into a new version section, or ensure a version section exists.
 */
function updateChangelog(changelog, version, date) {
  const header = `## [${version}] - ${date}`;
  if (changelog.includes(`## [${version}]`)) {
    return changelog;
  }

  const unreleasedRe = /## \[Unreleased\]\s*\n+([\s\S]*?)(?=\n## \[|\n\[Unreleased\]:|\n*$)/;
  const match = unreleasedRe.exec(changelog);
  let body = "";
  let rest = changelog;

  if (match) {
    body = match[1].trim();
    // strip empty "none yet" placeholder
    if (/^\(none yet/i.test(body) || body.length === 0) {
      body = "### Added\n\n- Release packaging and install tooling for this version.";
    }
    rest = changelog.replace(
      unreleasedRe,
      `## [Unreleased]\n\n### Added\n\n- (none yet — fold entries here before the next release)\n\n`,
    );
  } else {
    body = "### Added\n\n- See git history for this release.";
  }

  // Insert new section after Unreleased block
  const insertAt = rest.indexOf("## [Unreleased]");
  if (insertAt === -1) {
    rest = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- (none yet)\n\n${header}\n\n${body}\n\n${rest}`;
  } else {
    const afterUnreleased = rest.indexOf("\n## [", insertAt + 1);
    const pos = afterUnreleased === -1 ? rest.length : afterUnreleased;
    rest = rest.slice(0, pos).trimEnd() + `\n\n${header}\n\n${body}\n` + rest.slice(pos);
  }

  // Update compare links footer roughly
  const tag = `v${version}`;
  if (!rest.includes(`[${version}]:`)) {
    rest =
      rest.trimEnd() + `\n[${version}]: https://github.com/innocarpe/carpeos/releases/tag/${tag}\n`;
  }
  if (rest.includes("[Unreleased]:")) {
    rest = rest.replace(
      /\[Unreleased\]: .*/,
      `[Unreleased]: https://github.com/innocarpe/carpeos/compare/${tag}...HEAD`,
    );
  } else {
    rest =
      rest.trimEnd() +
      `\n[Unreleased]: https://github.com/innocarpe/carpeos/compare/${tag}...HEAD\n`;
  }

  return rest;
}

function gitClean() {
  const status = run("git", ["status", "--porcelain"]);
  return (status.stdout || "").trim().length === 0;
}

function tagExists(tag) {
  const r = run("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
    allowFail: true,
  });
  return r.status === 0;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.bump) {
    process.stdout.write(`Usage: node scripts/release.mjs <patch|minor|major|X.Y.Z> [--dry-run] [--force-tag]

Bumps @innocarpe/carpeos, updates CHANGELOG.md, commits, and creates annotated tag vX.Y.Z.
Does not push. After review:

  git push origin main
  git push origin vX.Y.Z

Pushing the tag runs .github/workflows/release.yml (npm publish + GitHub Release).
`);
    process.exit(args.help ? 0 : 2);
  }

  if (!gitClean() && !args.dryRun) {
    throw new Error("working tree is not clean; commit or stash first");
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const current = pkg.version;
  const next = bumpVersion(current, args.bump);
  const tag = `v${next}`;
  const sameVersion = current === next;

  if (sameVersion && !args.forceTag) {
    process.stdout.write(
      `Version already ${next}. Use --force-tag to create/retag commit+tag without bump, or pass a higher version.\n`,
    );
  }

  if (tagExists(tag) && !args.dryRun) {
    throw new Error(`tag ${tag} already exists`);
  }

  process.stdout.write(`Release plan: ${current} -> ${next} (tag ${tag})\n`);

  if (args.dryRun) {
    process.stdout.write("dry-run: no files changed\n");
    return;
  }

  if (!sameVersion) {
    pkg.version = next;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }

  const changelog = readFileSync(changelogPath, "utf8");
  const updated = updateChangelog(changelog, next, todayUtc());
  writeFileSync(changelogPath, updated.endsWith("\n") ? updated : `${updated}\n`, "utf8");

  run("git", ["add", "packages/carpeos/package.json", "CHANGELOG.md"]);
  run("git", ["commit", "-m", `chore(release): @innocarpe/carpeos v${next}`], { stdio: "inherit" });

  run("git", ["tag", "-a", tag, "-m", `release: @innocarpe/carpeos v${next}`], {
    stdio: "inherit",
  });

  process.stdout.write(`
Created commit + tag ${tag}.

Next:
  git push origin HEAD
  git push origin ${tag}

Ensure GitHub secret NPM_TOKEN is set before the release workflow publishes.
`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
