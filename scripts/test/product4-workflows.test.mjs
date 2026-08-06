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

test("M4 keeps the raw producer unprivileged and dispatch-only until activation", () => {
  const source = workflow("product-4-candidate-evaluate.yml");
  // Trust plane is not a PR merge gate until activation (ci-policy).
  assert.match(source, /on:\n {2}workflow_dispatch:/);
  assert.doesNotMatch(source, /\non:\n {2}pull_request:/);
  assert.doesNotMatch(source, /pull_request_target/);
  assert.match(source, /workflow_dispatch:[\s\S]*head_sha:/);
  assert.match(source, /workflow_dispatch:[\s\S]*base_sha:/);
  assert.match(source, /ref: \$\{\{ env\.PRODUCT4_HEAD_SHA \}\}/);
  assert.match(source, /path: candidate/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /contents: read/);
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
  assert.match(source, /setpriv[\s\S]*--no-new-privs/);
  assert.match(source, /sandbox-probe\.mjs/);
  assert.match(source, /assertSandboxProbeObservation/);
  assert.match(source, /--setenv CI true/);
  assert.match(source, /sandbox-probe\.json/);
  assert.match(source, /sandbox-probe\.mjs/);
  assert.match(source, /assertSandboxProbeObservation/);
  // Host prepares tooling + immutable input + offline store only.
  assert.match(source, /cache-dependency-path: candidate\/pnpm-lock\.yaml/);
  assert.match(source, /CARPEOS_CANDIDATE_ROOT=/);
  assert.match(source, /rm -rf "\$CARPEOS_CANDIDATE_ROOT"/);
  assert.match(source, /mv "\$GITHUB_WORKSPACE\/candidate" "\$CARPEOS_CANDIDATE_ROOT"/);
  assert.doesNotMatch(
    source,
    /mkdir -p "\$CARPEOS_CANDIDATE_ROOT"\n\s+mv "\$GITHUB_WORKSPACE\/candidate"/,
  );
  assert.match(source, /pnpm --dir "\$CARPEOS_CANDIDATE_ROOT" fetch --frozen-lockfile/);
  assert.match(source, /cp -RL --no-preserve=ownership \/candidate\/\. \/work\//);
  assert.match(source, /find \/work -mindepth 1 -exec chmod u\+rwX \{\} \+/);
  assert.doesNotMatch(source, /cp -aL \/candidate\/\. \/work\//);
  assert.doesNotMatch(source, /chmod -R u\+rwX \/work$/m);
  assert.match(source, /node_src=.*command -v node/);
  assert.match(source, /pnpm store path --silent/);
  assert.match(source, /tool_root=.*product4-host-tools/);
  assert.match(source, /staged_store=.*product4-pnpm-store/);
  assert.match(source, /"\$npm_cmd" install --global --prefix "\$tool_root" pnpm@/);
  assert.match(source, /test -x "\$tool_root\/bin\/node"/);
  assert.match(source, /test -x "\$tool_root\/bin\/pnpm"/);
  assert.match(source, /test -d "\$staged_store"/);
  assert.match(source, /find "\$staged_store" -mindepth 1 -print -quit/);
  assert.match(source, /--unshare-all/);
  assert.match(source, /--unshare-net/);
  assert.match(source, /--cap-drop ALL/);
  assert.match(source, /--clearenv/);
  assert.match(source, /--ro-bind "\$CARPEOS_CANDIDATE_ROOT" \/candidate/);
  assert.match(source, /--ro-bind "\$tool_root" "\$tool_root"/);
  assert.match(source, /--bind "\$staged_store" \/pnpm-store/);
  assert.doesNotMatch(source, /--ro-bind "\$staged_store" \/pnpm-store/);
  assert.match(source, /--setenv CI true/);
  assert.match(source, /confirmModulesPurge=false/);
  // Claim-only static probe JSON must not return.
  assert.doesNotMatch(source, /JSON\.stringify\(\{backend:"bubblewrap",network:"disabled"/);
  assert.match(source, /sandbox-probe\.mjs/);
  assert.match(source, /assertSandboxProbeObservation/);
  assert.match(source, /--setenv PATH "\$tool_root\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin"/);
  assert.doesNotMatch(source, /--ro-bind "\$pnpm_bin_dir" "\$pnpm_bin_dir"/);
  assert.doesNotMatch(source, /--ro-bind "\$node_dir" "\$node_dir"/);
  assert.doesNotMatch(source, /--ro-bind "\$pnpm_dir" "\$pnpm_dir"/);
  assert.doesNotMatch(source, /setup-pnpm\/node_modules\/\.bin/);
  assert.match(
    source,
    /pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir \/pnpm-store/,
  );
  assert.doesNotMatch(source, /pnpm install --offline --frozen-store --frozen-lockfile/);
  assert.match(source, /pnpm --filter "@carpeos\/cli\.\.\." build/);
  assert.match(
    source,
    /node apps\/carpeos-cli\/dist\/index\.js init --home \/home --trust-zone tz_synthetic/,
  );
  // Old host-side candidate lifecycle path must not return.
  assert.doesNotMatch(source, /^ {8}run: pnpm install --frozen-lockfile --ignore-scripts$/m);
  assert.doesNotMatch(source, /Build the local CLI from C without privileged credentials/);
  assert.doesNotMatch(source, /Initialize a disposable synthetic store/);
  assert.doesNotMatch(source, /^ {8}run: pnpm --filter '@carpeos\/cli\.\.\.' build$/m);
  assert.doesNotMatch(
    source,
    /run: node apps\/carpeos-cli\/dist\/index\.js init --home "\$CARPEOS_HOME"/,
  );
  assert.doesNotMatch(source, /--bind "\$HOME"/);
  assert.doesNotMatch(source, /env:[\s\S]{0,160}github\.token/);
  assert.match(source, /--workspace-root "\$CARPEOS_SANDBOX_WORK"/);
  assert.match(source, /--cli-root "\$CARPEOS_SANDBOX_WORK"/);
  assert.match(source, /--candidate-root "\$CARPEOS_CANDIDATE_ROOT"/);
  assert.match(source, /sudo -n chmod -R a-w "\$CARPEOS_SANDBOX_WORK"/);
  assert.match(source, /sudo -n chmod -R a-w "\$CARPEOS_SANDBOX_OUT"/);
  assert.match(source, /name: product4-raw-\$\{\{ env\.PRODUCT4_HEAD_SHA \}\}/);
});

test("M4 isolates base-owned evaluation from the untrusted candidate workspace", () => {
  const source = workflow("product-4-candidate-attest.yml");
  // Not a PR path trigger; optional chain after manual evaluate / dispatch.
  assert.match(source, /workflow_run:/);
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /\non:\n {2}pull_request:/);
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
  assert.match(source, /rm -rf "\$CARPEOS_CANDIDATE_ROOT"/);
  assert.match(source, /mv "\$GITHUB_WORKSPACE\/candidate" "\$CARPEOS_CANDIDATE_ROOT"/);
  assert.doesNotMatch(
    source,
    /mkdir -p "\$CARPEOS_CANDIDATE_ROOT"\n\s+mv "\$GITHUB_WORKSPACE\/candidate"/,
  );
  assert.match(source, /node_src=.*command -v node/);
  assert.match(source, /pnpm store path --silent/);
  assert.match(source, /tool_root=.*product4-host-tools/);
  assert.match(source, /staged_store=.*product4-pnpm-store/);
  assert.match(source, /"\$npm_cmd" install --global --prefix "\$tool_root" pnpm@/);
  assert.match(source, /test -x "\$tool_root\/bin\/node"/);
  assert.match(source, /test -x "\$tool_root\/bin\/pnpm"/);
  assert.match(source, /test -d "\$staged_store"/);
  assert.match(source, /find "\$staged_store" -mindepth 1 -print -quit/);
  assert.match(source, /cp -RL --no-preserve=ownership \/candidate\/\. \/work\//);
  assert.match(source, /find \/work -mindepth 1 -exec chmod u\+rwX \{\} \+/);
  assert.doesNotMatch(source, /cp -aL \/candidate\/\. \/work\//);
  assert.doesNotMatch(source, /chmod -R u\+rwX \/work$/m);
  assert.match(source, /pnpm --dir "\$CARPEOS_CANDIDATE_ROOT" fetch --frozen-lockfile/);
  assert.match(source, /--setenv CI true/);
  assert.match(source, /confirmModulesPurge=false/);
  // Claim-only static probe JSON must not return.
  assert.doesNotMatch(source, /JSON\.stringify\(\{backend:"bubblewrap",network:"disabled"/);
  assert.match(source, /sandbox-probe\.mjs/);
  assert.match(source, /assertSandboxProbeObservation/);
  assert.match(source, /--setenv PATH "\$tool_root\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin"/);
  assert.match(source, /--ro-bind "\$tool_root" "\$tool_root"/);
  assert.match(source, /--bind "\$staged_store" \/pnpm-store/);
  assert.doesNotMatch(source, /--ro-bind "\$staged_store" \/pnpm-store/);
  assert.doesNotMatch(source, /--ro-bind "\$pnpm_bin_dir" "\$pnpm_bin_dir"/);
  assert.doesNotMatch(source, /--ro-bind "\$node_dir" "\$node_dir"/);
  assert.doesNotMatch(source, /--ro-bind "\$pnpm_dir" "\$pnpm_dir"/);
  assert.doesNotMatch(source, /setup-pnpm\/node_modules\/\.bin/);
  assert.match(
    source,
    /pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir \/pnpm-store --config\.confirmModulesPurge=false/,
  );
  assert.doesNotMatch(source, /pnpm install --offline --frozen-store --frozen-lockfile/);
  assert.match(source, /--noprofile/);
  assert.match(source, /--norc/);
  assert.match(source, /--unshare-net/);
  assert.match(source, /--unshare-all/);
  assert.match(source, /--cap-drop ALL/);
  assert.match(source, /setpriv[\s\S]*--no-new-privs/);
  assert.match(source, /sudo -n chmod -R a-w "\$CARPEOS_SANDBOX_WORK"/);
  assert.match(source, /sudo -n chmod -R a-w "\$CARPEOS_SANDBOX_OUT"/);
  assert.match(source, /sudo -n chown -R "\$\(id -u\):\$\(id -g\)" "\$CARPEOS_SANDBOX_OUT"/);
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
  assert.match(source, /workflow_run:/);
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /\non:\n {2}pull_request:/);
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
