import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const ci = () => readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");

const MAIN_ONLY =
  /github\.event_name\s*==\s*'push'\s*&&\s*github\.ref\s*==\s*'refs\/heads\/main'/;

test("CI workflow keeps PR lean and main-full lanes", () => {
  const source = ci();
  assert.match(source, /on:\n {2}pull_request:/);
  assert.match(source, /branches:\n {6}- main/);
  assert.match(source, /pnpm check/);

  // Integration depth is main-only (smokes / e2e / package evals).
  for (const marker of [
    "smoke:dogfood",
    "smoke:mcp",
    "smoke:product",
    "smoke:knowledge",
    "test:e2e",
    "eval:adjudication:built",
    "eval:knowledge-form:built",
    "eval:retrieval",
  ]) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const mainOnlySteps = source.split("\n").filter((line) => MAIN_ONLY.test(line));
  assert.ok(
    mainOnlySteps.length >= 6,
    `expected several main-only steps, found ${mainOnlySteps.length}`,
  );

  // Do not pay a second monorepo build for capture/retrieval on every PR.
  assert.doesNotMatch(
    source,
    /Build capture evaluators|Build and evaluate retrieval|filter @carpeos\/capture build/,
  );
});

test("CI lean path does not run smokes without main-only guards", () => {
  const source = ci();
  // Every smoke/e2e/eval step line should sit under a preceding main-only if.
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (
      /smoke:(dogfood|mcp|product|knowledge)|test:e2e|eval:(adjudication:built|knowledge-form:built|retrieval)/.test(
        lines[i],
      )
    ) {
      const window = lines.slice(Math.max(0, i - 12), i + 1).join("\n");
      assert.match(
        window,
        MAIN_ONLY,
        `integration command near line ${i + 1} must be main-only gated:\n${window}`,
      );
    }
  }
});

test("CI path-filters monorepo work and keeps Checks job present", () => {
  const source = ci();
  // Required check name must stay so docs-only PRs are not blocked as "missing".
  assert.match(source, /name:\s*Checks/);
  assert.match(source, /dorny\/paths-filter@v3/);
  assert.match(source, /filters:\s*\|\n\s+ci:/);
  // Positive filter covers code planes; pure README/docs should not match alone.
  for (const marker of [
    "apps/**",
    "packages/**",
    "scripts/**",
    "schemas/**",
    ".github/**",
    "package.json",
    "pnpm-lock.yaml",
  ]) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  // Full install/check gated on filter output (skip path exists).
  assert.match(source, /steps\.filter\.outputs\.ci\s*==\s*'true'/);
  assert.match(source, /Skip full Checks \(no CI-relevant paths\)/);
  assert.match(source, /if:\s*steps\.filter\.outputs\.ci\s*!=\s*'true'/);
});
