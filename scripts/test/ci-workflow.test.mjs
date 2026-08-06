import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const ci = () => readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
const setupAction = () =>
  readFileSync(resolve(root, ".github/actions/setup-node-pnpm/action.yml"), "utf8");

test("CI workflow is path-filtered and keeps Checks aggregate", () => {
  const source = ci();
  assert.match(source, /on:\n {2}pull_request:/);
  assert.match(source, /branches:\n {6}- main/);
  assert.match(source, /dorny\/paths-filter@v3/);
  assert.match(source, /filters:\s*\|\n\s+ci:/);
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
  // Required status check name must remain Checks.
  assert.match(source, /name:\s*Checks/);
  assert.match(source, /Aggregate PR lean/);
});

test("CI runs PR lean work as parallel jobs with shared setup action", () => {
  const source = ci();
  for (const job of [
    "quality:",
    "boundary:",
    "build:",
    "typecheck:",
    "test:",
    "main-full:",
    "checks:",
  ]) {
    assert.match(source, new RegExp(`^ {2}${job}`, "m"), `missing job ${job}`);
  }
  assert.match(source, /\.\/\.github\/actions\/setup-node-pnpm/);
  assert.match(source, /pnpm format:check/);
  assert.match(source, /pnpm lint/);
  assert.match(source, /pnpm public-boundary/);
  assert.match(source, /pnpm build/);
  assert.match(source, /pnpm typecheck/);
  assert.match(source, /pnpm test/);
  // Sequential pnpm check mega-step is gone (parallelized).
  assert.doesNotMatch(source, /run:\s*pnpm check\b/);
  // Typecheck/test wait for build artifact.
  assert.match(source, /name:\s*monorepo-dist/);
  assert.match(source, /actions\/upload-artifact@v4/);
  assert.match(source, /actions\/download-artifact@v4/);
});

test("CI main-full stays main-only and uses built packages", () => {
  const source = ci();
  const mainFullBlock = source.slice(source.indexOf("main-full:"));
  assert.match(
    mainFullBlock,
    /github\.event_name\s*==\s*'push'[\s\S]*github\.ref\s*==\s*'refs\/heads\/main'/,
  );
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
    assert.match(mainFullBlock, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  // Do not rebuild capture for evals on every PR lean job.
  assert.doesNotMatch(
    source,
    /Build capture evaluators|Build and evaluate retrieval|filter @carpeos\/capture build/,
  );
});

test("shared setup-node-pnpm composite caches pnpm store", () => {
  const source = setupAction();
  assert.match(source, /pnpm\/action-setup@v6/);
  assert.match(source, /actions\/setup-node@v7/);
  assert.match(source, /cache:\s*pnpm/);
  assert.match(source, /pnpm install --frozen-lockfile/);
  assert.match(source, /node-version:\s*22\.22\.0/);
});
