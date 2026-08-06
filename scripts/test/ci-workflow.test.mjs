import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const ci = () => readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
const setupAction = () =>
  readFileSync(resolve(root, ".github/actions/setup-node-pnpm/action.yml"), "utf8");

test("CI keeps path filter and Checks aggregate", () => {
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
  assert.match(source, /name:\s*Checks/);
  assert.match(source, /Aggregate PR lean/);
});

test("CI PR lean is slim: static ∥ monorepo (not five-way split)", () => {
  const source = ci();
  for (const job of ["changes:", "static:", "monorepo:", "main-full:", "checks:"]) {
    assert.match(source, new RegExp(`^ {2}${job}`, "m"), `missing job ${job}`);
  }
  assert.doesNotMatch(source, /^ {2}quality:/m);
  assert.doesNotMatch(source, /^ {2}boundary:/m);
  assert.doesNotMatch(source, /^ {2}build:/m);
  assert.doesNotMatch(source, /^ {2}typecheck:/m);
  assert.doesNotMatch(source, /^ {2}test:/m);

  assert.match(source, /\.\/\.github\/actions\/setup-node-pnpm/);
  assert.match(source, /pnpm format:check/);
  assert.match(source, /pnpm lint/);
  assert.match(source, /pnpm public-boundary/);
  assert.match(source, /pnpm build/);
  assert.match(source, /pnpm typecheck/);
  assert.match(source, /pnpm test/);
  assert.doesNotMatch(source, /run:\s*pnpm check\b/);
});

test("CI monorepo runs build then typecheck then test in one job", () => {
  const source = ci();
  const mono = source.slice(source.indexOf("monorepo:"), source.indexOf("main-full:"));
  const buildAt = mono.indexOf("pnpm build");
  const typeAt = mono.indexOf("pnpm typecheck");
  const testAt = mono.indexOf("pnpm test");
  assert.ok(buildAt >= 0 && typeAt > buildAt && testAt > typeAt);
  assert.match(mono, /github\.event_name\s*==\s*'push'/);
  assert.match(mono, /monorepo-dist/);
});

test("CI main-full stays main-only", () => {
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
});

test("shared setup-node-pnpm composite caches pnpm store", () => {
  const source = setupAction();
  assert.match(source, /pnpm\/action-setup@v6/);
  assert.match(source, /actions\/setup-node@v7/);
  assert.match(source, /cache:\s*pnpm/);
  assert.match(source, /pnpm install --frozen-lockfile/);
});
