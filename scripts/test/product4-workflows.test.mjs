import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const workflow = (name) => readFileSync(resolve(root, ".github/workflows", name), "utf8");

/**
 * GitHub Actions rejects `runner.*` in job-level `env` (invalid workflow file).
 * Paths that need RUNNER_TEMP must be set in a step via GITHUB_ENV or used only
 * under step-level `with:` / `run:`.
 */
function assertNoJobLevelRunnerContext(source) {
  const withoutSteps = source.split(/\n\s+steps:\s*\n/)[0] ?? source;
  assert.doesNotMatch(
    withoutSteps,
    /\$\{\{\s*runner\./,
    "job-level env cannot reference runner context",
  );
  assert.match(source, /GITHUB_ENV/);
}

test("M4 keeps the raw producer unprivileged and bound to pull_request C", () => {
  const source = workflow("product-4-candidate-evaluate.yml");
  // Trust plane is path-gated until activation (ci-policy), not every PR.
  assert.match(source, /on:\n {2}pull_request:/);
  assert.match(source, /paths:/);
  assert.match(source, /scripts\/product4\/\*\*/);
  assert.doesNotMatch(source, /pull_request_target/);
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /contents: read/);
  assert.match(source, /pull-requests: read/);
  assert.doesNotMatch(
    source,
    /contents: write|checks: write|actions: write|id-token: write|secrets\./,
  );
  assertNoJobLevelRunnerContext(source);
  assert.match(source, /tree-digest\.mjs/);
  assert.match(source, /p02-runner\.mjs/);
  assert.match(source, /raw-producer\.mjs/);
});

test("M4 isolates base-owned evaluation from the untrusted candidate workspace", () => {
  const source = workflow("product-4-candidate-attest.yml");
  assert.match(source, /on:\n {2}workflow_run:/);
  assert.doesNotMatch(source, /pull_request_target/);
  assert.match(source, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(source, /path: candidate/);
  assert.match(source, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(source, /name: product4-raw-\$\{\{ github\.event\.workflow_run\.head_sha \}\}\n/);
  assert.match(source, /name: product4-attestation\n/);
  assert.doesNotMatch(source, /product4-attestation-\$\{\{/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /evaluator-runner\.mjs/);
  assert.match(source, /--candidate-root/);
  assert.doesNotMatch(source, /env:[\s\S]{0,160}github\.token/);
  assertNoJobLevelRunnerContext(source);
  assert.doesNotMatch(
    source,
    /contents: write|checks: write|actions: write|id-token: write|secrets\./,
  );
});

test("M4 publisher has no candidate checkout and performs a data-only dry run", () => {
  const source = workflow("product-4-candidate-publish.yml");
  assert.match(source, /on:\n {2}workflow_run:/);
  assert.doesNotMatch(source, /pull_request_target|head_repository|path: candidate|candidate-root/);
  assert.match(source, /publisher-runner\.mjs/);
  assert.match(source, /name: product4-attestation\n/);
  assert.doesNotMatch(source, /product4-attestation-\$\{\{/);
  assert.doesNotMatch(source, /--head-sha "\$\{\{ github\.event\.workflow_run\.head_sha \}\}"/);
  assert.match(source, /name: product4-publication\n/);
  assert.doesNotMatch(source, /product4-publication-\$\{\{/);
  assert.match(source, /live authority/);
  assert.match(source, /contents: read/);
  assert.match(source, /actions: read/);
  assert.doesNotMatch(
    source,
    /contents: write|checks: write|actions: write|id-token: write|secrets\./,
  );
});
