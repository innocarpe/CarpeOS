import {
  canonicalJson,
  digestJson,
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "./policy-identity.mjs";

export const EXACT_PAGE_SIZE = 100;
export const CHECK_SUITE_CAP = 1000;
export const PRODUCT4_CHECK_NAME = "Product 4 Candidate Evidence";

const SHA1 = /^[0-9a-f]{40}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FORBIDDEN_KEY =
  /token|secret|credential|private_path|protected_plaintext|script|module|url|executable|shell/i;

export class EvidenceApiError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "EvidenceApiError";
    this.code = code;
  }
}

export function buildExactCheckQuery({
  repositoryPath,
  headSha,
  checkName = PRODUCT4_CHECK_NAME,
  fixtureSha256 = MAINTENANCE_STUDY_FIXTURE_SHA256,
  policySha256 = PRODUCT4_POLICY_SHA256,
  context = PRODUCT4_CONTEXT,
}) {
  if (typeof repositoryPath !== "string" || !/^[-_./a-z0-9]{3,200}$/i.test(repositoryPath))
    throwApiError("invalid_query", "repository path is invalid");
  assertSha(headSha, SHA1, "head_sha");
  if (checkName !== PRODUCT4_CHECK_NAME) throwApiError("invalid_query", "check name is not frozen");
  if (fixtureSha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
    throwApiError("fixture_mismatch", "fixture is not the frozen maintenance study");
  if (policySha256 !== PRODUCT4_POLICY_SHA256)
    throwApiError("policy_not_active", "query policy is not P4_0");
  if (context !== PRODUCT4_CONTEXT)
    throwApiError("context_mismatch", "query context is not frozen");
  return {
    method: "GET",
    path: `${repositoryPath.replace(/\/$/, "")}/commits/${headSha}/check-runs`,
    query: {
      check_name: PRODUCT4_CHECK_NAME,
      filter: "all",
      per_page: EXACT_PAGE_SIZE,
    },
    identity: {
      repository_id: PRODUCT4_REPOSITORY_ID,
      repository_path: repositoryPath,
      head_sha: headSha,
      check_name: PRODUCT4_CHECK_NAME,
      fixture_sha256: fixtureSha256,
      policy_sha256: policySha256,
      context,
    },
  };
}

export function assertExactCheckQuery(query, expected) {
  if (!isRecord(query) || query.method !== "GET")
    throwApiError("invalid_query", "exact check lookup must be a GET");
  if (!isRecord(query.query)) throwApiError("invalid_query", "query parameters are required");
  if (query.query.filter !== "all" || query.query.per_page !== EXACT_PAGE_SIZE)
    throwApiError("invalid_query", "exact lookup requires filter=all and per_page=100");
  if (query.query.check_name !== PRODUCT4_CHECK_NAME)
    throwApiError("invalid_query", "exact lookup requires the frozen check name");
  if (expected !== undefined) {
    if (query.path !== expected.path || query.query.check_name !== expected.query.check_name)
      throwApiError("identity_conflict", "query does not target the expected C/name identity");
  }
  assertSafePayload(query);
  return query;
}

export async function collectPaginatedPages({ firstUrl, fetchPage, pageSize = EXACT_PAGE_SIZE }) {
  if (typeof firstUrl !== "string" || firstUrl.length === 0)
    throwApiError("invalid_pagination", "first URL is required");
  if (typeof fetchPage !== "function")
    throwApiError("invalid_pagination", "page callback is required");
  if (pageSize !== EXACT_PAGE_SIZE)
    throwApiError("invalid_pagination", "page size is frozen at 100");

  const pages = [];
  const visited = new Set();
  let nextUrl = firstUrl;
  while (nextUrl !== null) {
    if (visited.has(nextUrl))
      throwApiError("incomplete_pagination", "Link traversal loop detected");
    visited.add(nextUrl);
    const page = await fetchPage(nextUrl);
    assertPage(page);
    pages.push(page);
    const next = parseNextLink(page.headers.link);
    if (next === null && page.items.length === pageSize)
      throwApiError("incomplete_pagination", "full page is missing a Link rel=next boundary");
    nextUrl = next;
  }
  return pages;
}

export function parseNextLink(linkHeader) {
  if (linkHeader === undefined || linkHeader === null || linkHeader === "") return null;
  if (typeof linkHeader !== "string")
    throwApiError("invalid_pagination", "Link header is not a string");
  const links = linkHeader.split(",").map((part) => part.trim());
  let next = null;
  for (const link of links) {
    const match = link.match(/^<([^<>]+)>\s*;\s*rel="?([^";]+)"?\s*$/i);
    if (match === null) throwApiError("invalid_pagination", "malformed RFC 5988 Link header");
    const relations = match[2].split(/\s+/);
    if (relations.includes("next")) {
      if (next !== null) throwApiError("duplicate_refusal", "multiple rel=next links returned");
      next = match[1];
    }
  }
  return next;
}

export function buildEvidenceIdentity({
  repositoryId = PRODUCT4_REPOSITORY_ID,
  repositoryPath,
  headSha,
  externalId,
  fixtureSha256 = MAINTENANCE_STUDY_FIXTURE_SHA256,
  policySha256 = PRODUCT4_POLICY_SHA256,
  context = PRODUCT4_CONTEXT,
  checkName = PRODUCT4_CHECK_NAME,
  appId,
}) {
  if (repositoryId !== PRODUCT4_REPOSITORY_ID)
    throwApiError("identity_conflict", "repository id is invalid");
  if (typeof repositoryPath !== "string" || repositoryPath.length < 3)
    throwApiError("identity_conflict", "repository path is required");
  assertSha(headSha, SHA1, "head_sha");
  if (typeof externalId !== "string" || externalId.length < 10 || externalId.length > 200)
    throwApiError("identity_conflict", "external id is invalid");
  if (fixtureSha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
    throwApiError("fixture_mismatch", "fixture is not the frozen maintenance study");
  const expectedExternalId = `carpeos-4.0.0:${headSha}:${fixtureSha256}`;
  if (externalId !== expectedExternalId)
    throwApiError("identity_conflict", "external id is not bound to C and fixture");
  if (policySha256 !== PRODUCT4_POLICY_SHA256)
    throwApiError("policy_not_active", "policy is not P4_0");
  if (context !== PRODUCT4_CONTEXT || checkName !== PRODUCT4_CHECK_NAME)
    throwApiError("context_mismatch", "check context/name is not frozen");
  if (!Number.isSafeInteger(appId) || appId <= 0)
    throwApiError("app_identity_missing", "App id is required");
  return {
    repository_id: repositoryId,
    repository_path: repositoryPath,
    head_sha: headSha,
    external_id: externalId,
    fixture_sha256: fixtureSha256,
    policy_sha256: policySha256,
    context,
    check_name: checkName,
    app_id: appId,
  };
}

export function assertEvidenceRecord(record, identity) {
  if (!isRecord(record)) throwApiError("malformed_response", "evidence response is not an object");
  const errors = [];
  if (record.repository_id !== identity.repository_id) errors.push("repository id mismatch");
  if (record.repository_path !== identity.repository_path) errors.push("repository path mismatch");
  if (record.head_sha !== identity.head_sha) errors.push("head C mismatch");
  if (record.external_id !== identity.external_id) errors.push("external id mismatch");
  if (record.fixture_sha256 !== identity.fixture_sha256) errors.push("fixture mismatch");
  if (record.policy_sha256 !== identity.policy_sha256) errors.push("policy mismatch");
  if (record.context !== identity.context) errors.push("context mismatch");
  if (record.check_name !== identity.check_name) errors.push("check name mismatch");
  if (record.app_id !== identity.app_id) errors.push("foreign or missing App identity");
  assertNoForbiddenKeys(record, errors);
  if (errors.length > 0) throwApiError("duplicate_refusal", errors.join("; "));
  return record;
}

export function collectCheckRuns({ pages, identity, suiteCap = CHECK_SUITE_CAP }) {
  if (!Array.isArray(pages)) throwApiError("malformed_response", "suite pages are required");
  if (!Number.isSafeInteger(suiteCap) || suiteCap < 1 || suiteCap > CHECK_SUITE_CAP)
    throwApiError("cap_exceeded", "suite cap is invalid");
  const runs = new Map();
  let suiteCount = 0;
  for (const page of pages) {
    assertPage(page);
    for (const suite of page.items) {
      suiteCount += 1;
      if (suiteCount > suiteCap) throwApiError("cap_exceeded", "check suite cap exceeded");
      assertEvidenceRecord(suite, identity);
      if (!Array.isArray(suite.runs))
        throwApiError("malformed_response", "suite runs are required");
      for (const run of suite.runs) {
        if (!isRecord(run) || !Number.isSafeInteger(run.id) || run.id <= 0)
          throwApiError("malformed_response", "check run id is invalid");
        if (run.app_id !== identity.app_id || run.head_sha !== identity.head_sha)
          throwApiError("duplicate_refusal", "check run identity is foreign or moved");
        assertSafePayload(run);
        const existing = runs.get(run.id);
        if (existing !== undefined && canonicalJson(existing) !== canonicalJson(run))
          throwApiError("duplicate_refusal", `conflicting duplicate check run ${run.id}`);
        if (existing === undefined) runs.set(run.id, run);
      }
    }
  }
  return [...runs.values()].sort((left, right) => left.id - right.id);
}
export const EVIDENCE_RECEIPT_SCHEMA = "product4-evidence-api-receipt-v1";

export function buildEvidenceReceipt({ query, pages, identity, observedAt }) {
  assertExactCheckQuery(query);
  const verifiedIdentity = normalizeEvidenceIdentity(identity);
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > CHECK_SUITE_CAP)
    throwApiError("malformed_response", "evidence pages must be bounded and non-empty");
  const runs = collectCheckRuns({ pages, identity: verifiedIdentity });
  const unsigned = {
    schema_version: EVIDENCE_RECEIPT_SCHEMA,
    receipt_type: "exact_check_evidence",
    status: "verified",
    repository_id: verifiedIdentity.repository_id,
    repository_path: verifiedIdentity.repository_path,
    head_sha: verifiedIdentity.head_sha,
    external_id: verifiedIdentity.external_id,
    fixture_sha256: verifiedIdentity.fixture_sha256,
    policy_sha256: verifiedIdentity.policy_sha256,
    context: verifiedIdentity.context,
    check_name: verifiedIdentity.check_name,
    app_id: verifiedIdentity.app_id,
    query_digest: digestJson(query),
    identity_digest: digestJson(verifiedIdentity),
    page_count: pages.length,
    suite_count: pages.reduce((count, page) => count + page.items.length, 0),
    run_ids: runs.map((run) => run.id),
    observed_at: observedAt,
  };
  const receipt = { ...unsigned, receipt_digest: digestJson(unsigned) };
  return assertEvidenceReceipt(receipt);
}

export function assertEvidenceReceipt(receipt) {
  if (!isRecord(receipt)) throwApiError("malformed_response", "evidence receipt is required");
  const errors = [];
  const keys = [
    "schema_version",
    "receipt_type",
    "status",
    "repository_id",
    "repository_path",
    "head_sha",
    "external_id",
    "fixture_sha256",
    "policy_sha256",
    "context",
    "check_name",
    "app_id",
    "query_digest",
    "identity_digest",
    "page_count",
    "suite_count",
    "run_ids",
    "observed_at",
    "receipt_digest",
  ];
  for (const key of Object.keys(receipt))
    if (!keys.includes(key)) errors.push(`${key} is not allowed`);
  if (receipt.schema_version !== EVIDENCE_RECEIPT_SCHEMA) errors.push("schema_version is invalid");
  if (receipt.receipt_type !== "exact_check_evidence") errors.push("receipt_type is invalid");
  if (receipt.status !== "verified") errors.push("status is not verified");
  if (receipt.repository_id !== PRODUCT4_REPOSITORY_ID) errors.push("repository_id is invalid");
  if (typeof receipt.repository_path !== "string" || receipt.repository_path.length < 3)
    errors.push("repository_path is invalid");
  if (!SHA1.test(receipt.head_sha ?? "")) errors.push("head_sha is invalid");
  if (
    receipt.external_id !== `carpeos-4.0.0:${receipt.head_sha}:${MAINTENANCE_STUDY_FIXTURE_SHA256}`
  )
    errors.push("external_id is not C-bound");
  if (receipt.fixture_sha256 !== MAINTENANCE_STUDY_FIXTURE_SHA256)
    errors.push("fixture_sha256 is invalid");
  if (receipt.policy_sha256 !== PRODUCT4_POLICY_SHA256) errors.push("policy_sha256 is not P4_0");
  if (receipt.context !== PRODUCT4_CONTEXT) errors.push("context is invalid");
  if (receipt.check_name !== PRODUCT4_CHECK_NAME) errors.push("check_name is invalid");
  if (!Number.isSafeInteger(receipt.app_id) || receipt.app_id <= 0)
    errors.push("app_id is invalid");
  for (const key of ["query_digest", "identity_digest", "receipt_digest"])
    if (!/^[0-9a-f]{64}$/.test(receipt[key] ?? "")) errors.push(`${key} is invalid`);
  if (!Number.isSafeInteger(receipt.page_count) || receipt.page_count < 1)
    errors.push("page_count is invalid");
  if (!Number.isSafeInteger(receipt.suite_count) || receipt.suite_count < 1)
    errors.push("suite_count is invalid");
  if (
    !Array.isArray(receipt.run_ids) ||
    receipt.run_ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(receipt.run_ids).size !== receipt.run_ids.length
  )
    errors.push("run_ids are invalid");
  if (!isTimestamp(receipt.observed_at)) errors.push("observed_at is invalid");
  assertNoForbiddenKeys(receipt, errors);
  if (errors.length === 0) {
    const unsigned = { ...receipt };
    delete unsigned.receipt_digest;
    if (digestJson(unsigned) !== receipt.receipt_digest) errors.push("receipt_digest is invalid");
  }
  if (errors.length > 0) throwApiError("malformed_response", errors.join("; "));
  return receipt;
}

function normalizeEvidenceIdentity(identity) {
  if (!isRecord(identity)) throwApiError("identity_conflict", "evidence identity is required");
  const normalized = buildEvidenceIdentity({
    repositoryId: identity.repository_id,
    repositoryPath: identity.repository_path,
    headSha: identity.head_sha,
    externalId: identity.external_id,
    fixtureSha256: identity.fixture_sha256,
    policySha256: identity.policy_sha256,
    context: identity.context,
    checkName: identity.check_name,
    appId: identity.app_id,
  });
  if (Object.keys(identity).some((key) => !Object.hasOwn(normalized, key)))
    throwApiError("identity_conflict", "evidence identity contains unsupported fields");
  return normalized;
}

export function reconcileLostPost({ matches, identity }) {
  const verified = verifyMatches(matches, identity);
  if (verified.length === 0) {
    return {
      status: "post_indeterminate",
      retry_allowed: false,
      requires_human_reconciliation: true,
    };
  }
  if (verified.length > 1)
    throwApiError("duplicate_refusal", "lost POST reconciled to multiple check runs");
  return {
    status: "post_reconciled",
    retry_allowed: false,
    requires_human_reconciliation: false,
    run: verified[0],
  };
}

export function reconcileLostPatch({
  matches,
  identity,
  pendingRun,
  attemptedPatch,
  retryCount = 0,
}) {
  if (!isRecord(pendingRun))
    throwApiError("invalid_reconciliation", "pending run identity is required");
  const verified = verifyMatches(matches, identity);
  if (verified.length > 1)
    throwApiError("duplicate_refusal", "lost PATCH reconciled to multiple runs");
  if (verified.length === 1) {
    if (canonicalJson(verified[0]) !== canonicalJson({ ...pendingRun, ...attemptedPatch }))
      throwApiError("duplicate_refusal", "lost PATCH found a conflicting run");
    return { status: "patch_reconciled", retry_allowed: false, run: verified[0] };
  }
  if (retryCount === 0) {
    return {
      status: "retry_once",
      retry_allowed: true,
      retry_payload: { ...attemptedPatch },
    };
  }
  return {
    status: "patch_indeterminate",
    retry_allowed: false,
    requires_human_reconciliation: true,
  };
}

function verifyMatches(matches, identity) {
  if (!Array.isArray(matches))
    throwApiError("malformed_response", "reconciliation matches are required");
  return matches.map((match) => assertEvidenceRecord(match, identity));
}

function assertPage(page) {
  if (!isRecord(page) || !Array.isArray(page.items) || !isRecord(page.headers))
    throwApiError("malformed_response", "page must contain items and headers");
  if (page.items.length > EXACT_PAGE_SIZE)
    throwApiError("malformed_response", "page exceeds per_page=100");
}

function assertSha(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value))
    throwApiError("invalid_identity", `${label} is invalid`);
}
function isTimestamp(value) {
  return typeof value === "string" && TIMESTAMP.test(value);
}

function assertNoForbiddenKeys(value, errors, path = "$") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoForbiddenKeys(item, errors, `${path}[${index}]`);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) errors.push(`${path}.${key} is not allowed`);
    assertNoForbiddenKeys(child, errors, `${path}.${key}`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSafePayload(value) {
  const errors = [];
  assertNoForbiddenKeys(value, errors);
  if (errors.length > 0) throwApiError("unsafe_response", errors.join("; "));
}
function throwApiError(code, message) {
  throw new EvidenceApiError(code, message);
}
