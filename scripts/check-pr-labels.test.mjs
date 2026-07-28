import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const checkerPath = join(repoRoot, "scripts", "check-pr-labels.mjs");
const requiredLabels = [
  "type:ci",
  "area:ci",
  "size:s",
  "status:needs-review",
  "milestone:maintenance",
];

function runCheck(overrides = {}, currentOverrides) {
  const fixtureDir = mkdtempSync(join(tmpdir(), "carpeos-pr-labels-"));
  const eventPath = join(fixtureDir, "event.json");
  const pullRequest = {
    additions: 20,
    deletions: 8,
    labels: requiredLabels.map((name) => ({ name })),
    merged: false,
    state: "open",
    ...overrides,
  };

  writeFileSync(eventPath, JSON.stringify({ pull_request: pullRequest }));
  const env = { ...process.env, GITHUB_EVENT_PATH: eventPath };
  if (currentOverrides !== undefined) {
    const currentPullRequestPath = join(fixtureDir, "current-pull-request.json");
    writeFileSync(currentPullRequestPath, JSON.stringify({ ...pullRequest, ...currentOverrides }));
    env.CARPEOS_CURRENT_PULL_REQUEST_PATH = currentPullRequestPath;
  }

  const result = spawnSync(process.execPath, [checkerPath], {
    encoding: "utf8",
    env,
  });
  rmSync(fixtureDir, { force: true, recursive: true });
  return result;
}

test("accepts a complete pull request label set with the matching size", () => {
  const result = runCheck();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check passed/);
});

test("rejects a missing required label group", () => {
  const result = runCheck({
    labels: requiredLabels.filter((name) => name !== "area:ci").map((name) => ({ name })),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /at least one area label/);
});

test("rejects multiple labels from an exactly-one group", () => {
  const result = runCheck({
    labels: [...requiredLabels, "type:chore"].map((name) => ({ name })),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /exactly one type label; found 2/);
});

test("rejects a size label that does not match the GitHub diff", () => {
  const result = runCheck({ additions: 100, deletions: 0 });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires size:m; found size:s/);
});

test("rejects labels outside the source-of-truth catalog", () => {
  const result = runCheck({
    labels: [...requiredLabels, "priority:urgent"].map((name) => ({ name })),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /not defined in \.github\/labels\.json/);
});

test("requires status:merged for a merged pull request label event", () => {
  const result = runCheck({ merged: true, state: "closed" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Merged pull request must use status:merged/);
});

test("rejects status:merged while a pull request is open", () => {
  const result = runCheck({
    labels: requiredLabels.map((name) => ({
      name: name === "status:needs-review" ? "status:merged" : name,
    })),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Open pull request cannot use status:merged/);
});

test("validates the current pull request instead of an intermediate event snapshot", () => {
  const result = runCheck(
    {
      labels: requiredLabels
        .filter((name) => name !== "status:needs-review")
        .map((name) => ({ name })),
    },
    { labels: requiredLabels.map((name) => ({ name })) },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check passed/);
});
