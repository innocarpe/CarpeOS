import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const workflow = (name) => readFileSync(resolve(root, ".github/workflows", name), "utf8");
const evaluatorRunner = () =>
  readFileSync(resolve(root, "scripts/product4/evaluator-runner.mjs"), "utf8");

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
  assert.match(source, /apt-get install --no-install-recommends -y bubblewrap/);
  assert.match(source, /--sandbox-receipt/);
  assert.match(source, /bwrap/);
  assert.match(source, /setpriv\s+--no-new-privs/);
  assert.match(source, /sandbox-probe\.json/);
  assert.match(source, /sandbox-probe\.mjs/);
  assert.match(source, /assertSandboxProbeObservation/);
  assert.match(source, /buildP02SandboxReceipt/);
  // Claim-only static probe JSON must not return.
  assert.doesNotMatch(source, /JSON\.stringify\(\{backend:"bubblewrap",network:"disabled"/);
  assert.match(source, /ulimit -u 64/);
  assert.match(source, /ulimit -v 1048576/);
  assert.match(source, /--bind "\$CARPEOS_HOME" \/home/);
});

test("M4 isolates base-owned evaluation from the untrusted candidate workspace", () => {
  const source = workflow("product-4-candidate-attest.yml");
  assert.match(source, /on:\n {2}workflow_run:/);
  assert.doesNotMatch(source, /pull_request_target/);
  assert.match(
    source,
    /ref: \$\{\{ github\.event\.workflow_run\.pull_requests\[0\]\.base\.sha \}\}/,
  );
  assert.match(source, /path: candidate/);
  assert.match(source, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(source, /apt-get install --no-install-recommends -y bubblewrap/);
  assert.match(source, /name: product4-raw-\$\{\{ github\.event\.workflow_run\.head_sha \}\}\n/);
  assert.match(source, /name: product4-attestation\n/);
  assert.doesNotMatch(source, /product4-attestation-\$\{\{/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /evaluator-runner\.mjs/);
  assert.match(
    evaluatorRunner(),
    /const sealedTrustedEvidence = sealTrustedEvidence\(\{[\s\S]*\n {2}\}\);\n {2}const evaluation = evaluateCandidateEvidence\(\{[\s\S]*\n {4}trustedEvidence: sealedTrustedEvidence,\n {2}\}\);/,
  );
  assert.match(source, /--candidate-root/);
  assert.match(source, /cache-dependency-path: candidate\/pnpm-lock\.yaml/);
  assert.match(source, /node_path=.*command -v node/);
  assert.match(source, /pnpm_command=.*command -v pnpm/);
  assert.match(source, /pnpm_path=.*readlink -f "\$pnpm_command"/);
  assert.match(source, /pnpm_store=.*pnpm store path --silent/);
  assert.match(source, /test -x "\$node_path"/);
  assert.match(source, /test -x "\$pnpm_path"/);
  assert.match(source, /test -d "\$pnpm_store"/);
  assert.match(source, /find "\$pnpm_store" -mindepth 1 -print -quit/);
  assert.match(
    source,
    /--setenv PATH "\$node_dir:\$pnpm_bin_dir:\/usr\/local\/bin:\/usr\/bin:\/bin"/,
  );
  assert.match(source, /--ro-bind "\$node_dir" "\$node_dir"/);
  assert.match(source, /--ro-bind "\$pnpm_dir" "\$pnpm_dir"/);
  assert.match(source, /--ro-bind "\$pnpm_bin_dir" "\$pnpm_bin_dir"/);
  assert.match(source, /--ro-bind "\$pnpm_store" \/pnpm-store/);
  assert.match(
    source,
    /pnpm install --offline --frozen-store --frozen-lockfile --ignore-scripts --store-dir \/pnpm-store/,
  );
  assert.match(source, /--unshare-net/);
  assert.match(source, /--unshare-all/);
  assert.match(source, /--cap-drop ALL/);
  assert.match(source, /setpriv[\s\S]*--no-new-privs/);
  assert.match(source, /sandbox-probe\.mjs/);
  assert.match(source, /assertSandboxProbeObservation/);
  assert.doesNotMatch(source, /JSON\.stringify\(\{backend:\\"bubblewrap\\"/);
  assert.match(source, /sudo -n chmod -R a-w "\$CARPEOS_SANDBOX_WORK"/);
  assert.match(source, /sudo -n chmod -R a-w "\$CARPEOS_SANDBOX_OUT"/);
  assert.doesNotMatch(source, /--bind "\$HOME"/);
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
  assert.match(source, /--head-sha "\$\{\{ github\.event\.workflow_run\.head_sha \}\}"/);
  assert.match(source, /--run-id "\$\{\{ github\.event\.workflow_run\.id \}\}"/);
  assert.match(source, /--artifact-name "product4-attestation"/);
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
