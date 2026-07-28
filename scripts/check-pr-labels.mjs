#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogPath = join(repoRoot, ".github", "labels.json");
const eventPath = process.env.GITHUB_EVENT_PATH;
const currentPullRequestPath = process.env.CARPEOS_CURRENT_PULL_REQUEST_PATH;
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Unable to parse ${description} at ${path}: ${error.message}`);
    return null;
  }
}

if (typeof eventPath !== "string" || eventPath.trim() === "") {
  fail("GITHUB_EVENT_PATH must point to a pull_request event payload.");
}

const catalog = readJson(catalogPath, "label catalog");
const event = eventPath ? readJson(eventPath, "GitHub event") : null;
const eventPullRequest = event?.pull_request;

if (eventPullRequest === undefined) {
  fail("GitHub event payload must contain pull_request.");
}

const currentPullRequest = currentPullRequestPath
  ? readJson(currentPullRequestPath, "current pull request")
  : eventPullRequest;
const pullRequest = currentPullRequest ?? undefined;

if (catalog !== null && pullRequest !== undefined) {
  const catalogByName = new Map(catalog.labels.map((label) => [label.name, label]));
  const appliedNames = pullRequest.labels?.map((label) => label.name) ?? [];
  const appliedLabels = [];

  for (const name of appliedNames) {
    const label = catalogByName.get(name);
    if (label === undefined) {
      fail(`Applied label is not defined in .github/labels.json: ${name}.`);
    } else {
      appliedLabels.push(label);
    }
  }

  const cardinality = catalog.policy?.pullRequest?.cardinality ?? {};
  for (const [group, rule] of Object.entries(cardinality)) {
    const count = appliedLabels.filter((label) => label.group === group).length;
    if (rule === "exactly-one" && count !== 1) {
      fail(`Pull request must have exactly one ${group} label; found ${count}.`);
    }
    if (rule === "one-or-more" && count < 1) {
      fail(`Pull request must have at least one ${group} label; found ${count}.`);
    }
  }

  const additions = pullRequest.additions;
  const deletions = pullRequest.deletions;
  if (!Number.isInteger(additions) || additions < 0) {
    fail("pull_request.additions must be a non-negative integer.");
  }
  if (!Number.isInteger(deletions) || deletions < 0) {
    fail("pull_request.deletions must be a non-negative integer.");
  }

  if (
    Number.isInteger(additions) &&
    additions >= 0 &&
    Number.isInteger(deletions) &&
    deletions >= 0
  ) {
    const total = additions + deletions;
    const expectedBand = catalog.sizeBands.find(
      (band) => total >= band.min && (band.max === null || total <= band.max),
    );
    const appliedSize = appliedLabels.find((label) => label.group === "size");

    if (expectedBand === undefined) {
      fail(`No size band covers ${total} changed line(s).`);
    } else if (appliedSize?.name !== expectedBand.name) {
      fail(
        `Pull request with ${total} changed line(s) requires ${expectedBand.name}; ` +
          `found ${appliedSize?.name ?? "none"}.`,
      );
    }
  }

  const status = appliedLabels.find((label) => label.group === "status")?.name;
  if (pullRequest.merged === true && status !== "status:merged") {
    fail("Merged pull request must use status:merged.");
  }
  if (pullRequest.state === "open" && status === "status:merged") {
    fail("Open pull request cannot use status:merged.");
  }
}

if (failures.length > 0) {
  console.error("Pull request label check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

const total = pullRequest.additions + pullRequest.deletions;
console.log(
  `Pull request label check passed for ${pullRequest.labels.length} label(s) ` +
    `and ${total} changed line(s).`,
);
