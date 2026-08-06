import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");

test("carpeos-ci policy SSOT and skill are present and cross-linked", () => {
  const policyPath = "docs/maintainers/ci-policy.md";
  const skillPath = "skills/carpeos-ci/SKILL.md";
  const installPath = "scripts/install-ci-skill.sh";

  assert.equal(existsSync(resolve(root, policyPath)), true);
  assert.equal(existsSync(resolve(root, skillPath)), true);
  assert.equal(existsSync(resolve(root, installPath)), true);

  const policy = read(policyPath);
  const skill = read(skillPath);
  // Git tracks AGENTS.md; Linux CI is case-sensitive (macOS may alias Agents.md).
  const agents = read("AGENTS.md");

  assert.match(policy, /PR lean/);
  assert.match(policy, /Main full/);
  assert.match(policy, /job-level `env` must not use the `runner` context/i);
  assert.match(policy, /skills\/carpeos-ci\/SKILL\.md/);

  assert.match(skill, /docs\/maintainers\/ci-policy\.md/);
  assert.match(skill, /pr-lean/);
  assert.match(skill, /main-full/);
  assert.match(skill, /Job-level `env` must not reference `runner\.\*`/);
  assert.match(skill, /Claude Code, Codex CLI, Grok Build, and Gajae Code/);

  assert.match(agents, /skills\/carpeos-ci\/SKILL\.md/);
  assert.match(agents, /install-ci-skill\.sh/);
  assert.match(agents, /docs\/maintainers\/ci-policy\.md/);
});

test("install-ci-skill.sh points at skills/carpeos-ci and requires policy SSOT", () => {
  const install = read("scripts/install-ci-skill.sh");
  assert.match(install, /skills\/carpeos-ci/);
  assert.match(install, /ci-policy\.md/);
  assert.match(install, /\.claude\/skills/);
  assert.match(install, /\.agents\/skills/);
  assert.match(install, /\.grok\/skills/);
  assert.match(install, /\.gjc/);
});
