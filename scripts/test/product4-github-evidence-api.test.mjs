import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExactCheckQuery,
  assertRealCheckRun,
  buildEvidenceIdentity,
  buildEvidenceReceipt,
  buildExactCheckQuery,
  collectCheckRuns,
  collectPaginatedPages,
  normalizeCheckRunsResponse,
  normalizeCheckSuitesResponse,
  reconcileLostPatch,
  reconcileLostPost,
} from "../product4/github-evidence-api.mjs";
import { MAINTENANCE_STUDY_FIXTURE_SHA256 } from "../product4/policy-identity.mjs";

const headSha = "a".repeat(40);
const identity = buildEvidenceIdentity({
  repositoryPath: "synthetic/carpeos",
  headSha,
  externalId: `carpeos-4.0.0:${headSha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`,
  appId: 4242,
});

function suite(id, runs = []) {
  return {
    id,
    repository_id: identity.repository_id,
    repository_path: identity.repository_path,
    head_sha: identity.head_sha,
    external_id: identity.external_id,
    fixture_sha256: identity.fixture_sha256,
    policy_sha256: identity.policy_sha256,
    context: identity.context,
    check_name: identity.check_name,
    app_id: identity.app_id,
    runs,
  };
}

function run(id, conclusion = "pending") {
  return { id, app_id: identity.app_id, head_sha: identity.head_sha, conclusion };
}
function githubSuite(id, overrides = {}) {
  return {
    id,
    repository: {
      id: identity.repository_id,
      full_name: identity.repository_path,
    },
    head_sha: identity.head_sha,
    app: { id: identity.app_id, name: "synthetic-product4-app" },
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
}

function githubRun(id, suiteId = 1, overrides = {}) {
  return {
    id,
    repository: {
      id: identity.repository_id,
      full_name: identity.repository_path,
    },
    head_sha: identity.head_sha,
    app: { id: identity.app_id, name: "synthetic-product4-app" },
    name: identity.check_name,
    external_id: identity.external_id,
    status: "completed",
    conclusion: "success",
    check_suite: githubSuite(suiteId),
    ...overrides,
  };
}

function normalizedRunPage(runs, link = "") {
  return normalizeCheckRunsResponse(
    {
      total_count: runs.length,
      check_runs: runs,
      headers: { link },
    },
    { identity },
  );
}

test("M4 pins exact-C query parameters and frozen identity", () => {
  const query = buildExactCheckQuery({
    repositoryPath: identity.repository_path,
    headSha,
  });
  assert.equal(query.path, `synthetic/carpeos/commits/${headSha}/check-runs`);
  assert.deepEqual(query.query, {
    check_name: "Product 4 Candidate Evidence",
    filter: "all",
    per_page: 100,
  });
  assertExactCheckQuery(query);
  assert.throws(
    () => assertExactCheckQuery({ ...query, query: { ...query.query, filter: "latest" } }),
    /filter=all/,
  );
  assert.throws(
    () =>
      buildExactCheckQuery({
        repositoryPath: identity.repository_path,
        headSha,
        policySha256: "b".repeat(64),
      }),
    /policy_not_active/,
  );
});

test("M4 traverses every RFC 5988 next link and rejects incomplete full pages", async () => {
  const pages = {
    "page-1": { items: [1], headers: { link: '<https://api.test/page-2>; rel="next"' } },
    "page-2": { items: [2], headers: { link: '<https://api.test/page-3>; rel="next"' } },
    "page-3": { items: [3], headers: { link: "" } },
  };
  const visited = [];
  const collected = await collectPaginatedPages({
    firstUrl: "https://api.test/page-1",
    fetchPage: async (url) => {
      visited.push(url);
      return pages[url.slice(url.lastIndexOf("/") + 1)];
    },
  });
  assert.deepEqual(visited, [
    "https://api.test/page-1",
    "https://api.test/page-2",
    "https://api.test/page-3",
  ]);
  assert.deepEqual(
    collected.flatMap((page) => page.items),
    [1, 2, 3],
  );

  await assert.rejects(
    () =>
      collectPaginatedPages({
        firstUrl: "https://api.test/page-1",
        fetchPage: async () => ({
          items: Array.from({ length: 100 }, (_, index) => index),
          headers: { link: "" },
        }),
      }),
    /incomplete_pagination/,
  );
  const normalizedResponses = {
    "page-1": {
      total_count: 2,
      check_runs: [githubRun(70, 70)],
      headers: { link: '<https://api.test/page-2>; rel="next"' },
    },
    "page-2": {
      total_count: 2,
      check_runs: [githubRun(71, 71)],
      headers: { link: "" },
    },
  };
  const adapted = await collectPaginatedPages({
    firstUrl: "https://api.test/page-1",
    identity,
    fetchPage: async (url) => normalizedResponses[url.slice(url.lastIndexOf("/") + 1)],
    normalizePage: (response, { identity: callbackIdentity }) =>
      normalizeCheckRunsResponse(response, { identity: callbackIdentity }),
  });
  assert.deepEqual(
    collectCheckRuns({ pages: adapted, identity }).map((run) => run.id),
    [70, 71],
  );
});

test("M4 caps suite enumeration and de-duplicates only identical run responses", () => {
  const pages = [
    { items: [suite(1, [run(11), run(12)])], headers: { link: "" } },
    { items: [suite(2, [run(12), run(13)])], headers: { link: "" } },
  ];
  assert.deepEqual(
    collectCheckRuns({ pages, identity }).map((item) => item.id),
    [11, 12, 13],
  );

  const conflict = suite(3, [{ ...run(11), conclusion: "success" }]);
  assert.throws(
    () =>
      collectCheckRuns({
        pages: [{ items: [pages[0].items[0], conflict], headers: { link: "" } }],
        identity,
      }),
    /duplicate_refusal/,
  );
  const capPages = Array.from({ length: 11 }, (_, pageIndex) => ({
    items: Array.from({ length: pageIndex === 10 ? 1 : 100 }, (_, itemIndex) =>
      suite(pageIndex * 100 + itemIndex + 1),
    ),
    headers: { link: "" },
  }));
  assert.throws(() => collectCheckRuns({ pages: capPages, identity }), /cap_exceeded/);

  const foreign = suite(4, [run(14)]);
  foreign.app_id = 9999;
  assert.throws(
    () => collectCheckRuns({ pages: [{ items: [foreign], headers: { link: "" } }], identity }),
    /duplicate_refusal/,
  );
});

test("M4 emits a strict exact-evidence receipt from verified GitHub-shaped pages", () => {
  const query = buildExactCheckQuery({
    repositoryPath: identity.repository_path,
    headSha,
  });
  const pages = [normalizedRunPage([githubRun(11, 1), githubRun(12, 1)])];
  const receipt = buildEvidenceReceipt({
    query,
    identity,
    pages,
    observedAt: "2026-01-02T00:00:00Z",
  });
  assert.equal(receipt.status, "verified");
  assert.deepEqual(receipt.run_ids, [11, 12]);
  assert.equal(receipt.suite_count, 1);
  assert.match(receipt.receipt_digest, /^[0-9a-f]{64}$/);
  assert.throws(
    () =>
      buildEvidenceReceipt({
        query,
        identity,
        pages: [{ items: [suite(1, [run(11)])], headers: { link: "" } }],
        observedAt: "2026-01-02T00:00:00Z",
      }),
    /real GitHub adapter pages are required/,
  );
  assert.throws(
    () => buildEvidenceReceipt({ query, identity, pages: [], observedAt: "2026-01-02T00:00:00Z" }),
    /bounded and non-empty/,
  );
});
test("M4 binds C1 query fields to the normalized C2 identity", () => {
  const query = buildExactCheckQuery({
    repositoryPath: identity.repository_path,
    headSha,
  });
  const pages = [normalizedRunPage([githubRun(31)])];
  const mismatches = [
    { ...query, path: `${identity.repository_path}/commits/${"b".repeat(40)}/check-runs` },
    {
      ...query,
      query: { ...query.query, check_name: "foreign-check" },
    },
    {
      ...query,
      identity: { ...query.identity, head_sha: "b".repeat(40) },
    },
    {
      ...query,
      identity: { ...query.identity, context: "foreign-context" },
    },
    {
      ...query,
      identity: { ...query.identity, policy_sha256: "b".repeat(64) },
    },
    {
      ...query,
      identity: { ...query.identity, fixture_sha256: "b".repeat(64) },
    },
  ];
  for (const mismatchedQuery of mismatches) {
    assert.throws(
      () =>
        buildEvidenceReceipt({
          query: mismatchedQuery,
          identity,
          pages,
          observedAt: "2026-01-02T00:00:00Z",
        }),
      /identity_conflict|frozen check name/,
    );
  }
});

test("M4 adapts real GitHub suite/run response shapes and rejects invented nesting", () => {
  const suitePage = normalizeCheckSuitesResponse(
    {
      total_count: 1,
      check_suites: [githubSuite(41)],
      headers: { link: "" },
    },
    { identity },
  );
  assert.equal(suitePage.items[0].id, 41);
  assert.equal(suitePage.items[0].repository_path, identity.repository_path);
  const runPage = normalizedRunPage([githubRun(42, 41)]);
  assert.equal(runPage.items[0].check_name, identity.check_name);
  assert.equal(runPage.items[0].suite_id, 41);
  assert.deepEqual(
    collectCheckRuns({ pages: [runPage], identity }).map((run) => run.id),
    [42],
  );
  assert.throws(
    () =>
      normalizeCheckRunsResponse(
        {
          total_count: 1,
          items: [{ id: 42, runs: [] }],
          headers: { link: "" },
        },
        { identity },
      ),
    /invented nested|check_runs/,
  );
  assert.throws(
    () =>
      normalizeCheckSuitesResponse(
        { total_count: 1, items: [{ id: 41, runs: [] }], headers: { link: "" } },
        { identity },
      ),
    /invented nested|check_suites/,
  );
});

test("M4 refuses foreign repository/App/C and missing check identity in real responses", () => {
  const cases = [
    {
      label: "repository",
      run: githubRun(51, 1, { repository: { id: 999, full_name: identity.repository_path } }),
      code: /duplicate_refusal/,
    },
    {
      label: "App",
      run: githubRun(52, 1, { app: { id: 999, name: "foreign" } }),
      code: /duplicate_refusal/,
    },
    {
      label: "head C",
      run: githubRun(53, 1, { head_sha: "b".repeat(40) }),
      code: /duplicate_refusal/,
    },
    {
      label: "name",
      run: githubRun(54, 1, { name: "foreign-check" }),
      code: /duplicate_refusal/,
    },
    {
      label: "conclusion",
      run: githubRun(55, 1, { conclusion: null }),
      code: /completed state/,
    },
    {
      label: "status",
      run: githubRun(56, 1, { status: "unknown" }),
      code: /status is invalid/,
    },
  ];
  for (const { run: foreignRun, code } of cases) {
    assert.throws(
      () =>
        normalizeCheckRunsResponse(
          { total_count: 1, check_runs: [foreignRun], headers: { link: "" } },
          { identity },
        ),
      code,
    );
  }
  assert.throws(
    () => assertRealCheckRun({ ...githubRun(57), app: undefined }, identity),
    /App identity/,
  );
});

test("M4 refuses pagination loops and deduplicates/caps adapted suites deterministically", async () => {
  await assert.rejects(
    () =>
      collectPaginatedPages({
        firstUrl: "https://api.test/page-1",
        fetchPage: async (url) => ({
          items: [url],
          headers: {
            link: url.endsWith("page-1")
              ? '<https://api.test/page-2>; rel="next"'
              : '<https://api.test/page-1>; rel="next"',
          },
        }),
      }),
    /incomplete_pagination/,
  );

  const duplicatePage = normalizedRunPage([githubRun(61, 61)]);
  const identical = normalizedRunPage([githubRun(61, 61)]);
  assert.deepEqual(
    collectCheckRuns({ pages: [duplicatePage, identical], identity }).map((run) => run.id),
    [61],
  );
  assert.throws(
    () =>
      collectCheckRuns({
        pages: [duplicatePage, normalizedRunPage([githubRun(61, 61, { conclusion: "failure" })])],
        identity,
      }),
    /duplicate_refusal/,
  );

  const cappedPages = Array.from({ length: 1001 }, (_, index) =>
    normalizedRunPage([githubRun(1000 + index, 1000 + index)]),
  );
  assert.throws(() => collectCheckRuns({ pages: cappedPages, identity }), /cap_exceeded/);
});
test("M4 reconciles lost POST/PATCH without blind duplicate writes", () => {
  const pending = {
    ...identity,
    ...run(21),
    status: "queued",
  };
  const patch = { conclusion: "success", status: "completed" };
  const found = { ...pending, ...patch };
  assert.equal(reconcileLostPost({ matches: [found], identity }).status, "post_reconciled");
  assert.equal(reconcileLostPost({ matches: [], identity }).status, "post_indeterminate");
  assert.equal(
    reconcileLostPatch({
      matches: [],
      identity,
      pendingRun: pending,
      attemptedPatch: patch,
      retryCount: 0,
    }).status,
    "retry_once",
  );
  assert.equal(
    reconcileLostPatch({
      matches: [],
      identity,
      pendingRun: pending,
      attemptedPatch: patch,
      retryCount: 1,
    }).status,
    "patch_indeterminate",
  );
  assert.equal(
    reconcileLostPatch({ matches: [found], identity, pendingRun: pending, attemptedPatch: patch })
      .status,
    "patch_reconciled",
  );
  assert.throws(
    () => reconcileLostPost({ matches: [found, { ...found, id: 22 }], identity }),
    /duplicate_refusal/,
  );
});
