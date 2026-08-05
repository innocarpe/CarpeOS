import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExactCheckQuery,
  buildEvidenceIdentity,
  buildEvidenceReceipt,
  buildExactCheckQuery,
  collectCheckRuns,
  collectPaginatedPages,
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

test("M4 emits a strict exact-evidence receipt from verified pages", () => {
  const query = buildExactCheckQuery({
    repositoryPath: identity.repository_path,
    headSha,
  });
  const receipt = buildEvidenceReceipt({
    query,
    identity,
    pages: [{ items: [suite(1, [run(11), run(12)])], headers: { link: "" } }],
    observedAt: "2026-01-02T00:00:00Z",
  });
  assert.equal(receipt.status, "verified");
  assert.deepEqual(receipt.run_ids, [11, 12]);
  assert.match(receipt.receipt_digest, /^[0-9a-f]{64}$/);
  assert.throws(
    () => buildEvidenceReceipt({ query, identity, pages: [], observedAt: "2026-01-02T00:00:00Z" }),
    /bounded and non-empty/,
  );
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
