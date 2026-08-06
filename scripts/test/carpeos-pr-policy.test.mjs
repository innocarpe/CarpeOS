import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

test("shared PR skill keeps atomic commits separate from semantic PR grouping", () => {
  const skill = read("skills/carpeos-pr/SKILL.md");
  const agents = read("AGENTS.md");
  const template = read(".github/PULL_REQUEST_TEMPLATE.md");

  assert.match(skill, /Commits MUST be atomic/);
  assert.match(skill, /PRs are semantic review units, not commit containers/);
  assert.match(skill, /Never create one PR per commit merely/);
  assert.match(skill, /only when the user explicitly asks/);
  assert.match(skill, /Mandatory semantic-boundary receipt/);
  assert.match(skill, /Never infer the PR count from the commit count/);
  assert.match(agents, /NEVER create one PR per commit unless the user explicitly requests/);
  assert.match(template, /one semantic review unit may contain multiple atomic commits/);
  assert.match(template, /Commit atomicity and PR grouping are separate/);
});

test("PR skill installer covers every supported user harness", () => {
  const installerPath = "scripts/install-pr-skill.sh";
  const installer = read(installerPath);

  assert.equal(existsSync(resolve(root, installerPath)), true);
  for (const userSkillDir of [
    ".claude/skills",
    ".codex/skills",
    ".agents/skills",
    ".grok/skills",
  ]) {
    const escapedDir = userSkillDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(installer, new RegExp(`\\$\\{HOME\\}/${escapedDir}`));
  }
  assert.match(installer, /GJC_CONFIG_ROOT}\/agent\/skills/);
  assert.match(installer, /GJC_CONFIG_ROOT}\/skills/);
  assert.match(installer, /ROOT}\/\.codex\/skills\/carpeos-pr/);
  assert.match(installer, /Codex CLI/);
});
test("all shared skill installers expose the same Codex CLI harness path", () => {
  for (const [installerPath, skillName] of [
    ["scripts/install-pr-skill.sh", "carpeos-pr"],
    ["scripts/install-ci-skill.sh", "carpeos-ci"],
    ["scripts/install-release-skill.sh", "carpeos-release"],
  ]) {
    const installer = read(installerPath);
    assert.match(installer, /\$\{HOME\}\/\.codex\/skills/);
    assert.ok(installer.includes(`ROOT}/.codex/skills/${skillName}`));
    assert.match(installer, /Codex CLI/);
  }
});
