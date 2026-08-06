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
const CHECK_RUN_STATUSES = new Set([
  "queued",
  "in_progress",
  "completed",
  "requested",
  "waiting",
  "pending",
]);
const CHECK_RUN_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "success",
  "skipped",
  "stale",
  "timed_out",
]);
const ADAPTER_PAGE = Symbol("product4.githubEvidence.adapterPage");
const ADAPTER_KIND = Symbol("product4.githubEvidence.adapterKind");

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
  const normalizedRepositoryPath = normalizeRepositoryPath(repositoryPath);
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
    path: `${normalizedRepositoryPath}/commits/${headSha}/check-runs`,
    query: {
      check_name: PRODUCT4_CHECK_NAME,
      filter: "all",
      per_page: EXACT_PAGE_SIZE,
    },
    identity: {
      repository_id: PRODUCT4_REPOSITORY_ID,
      repository_path: normalizedRepositoryPath,
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
  const queryKeys = Object.keys(query.query).sort();
  if (queryKeys.join(",") !== "check_name,filter,per_page")
    throwApiError("invalid_query", "exact lookup contains unsupported query parameters");
  if (expected !== undefined) {
    if (!isRecord(expected))
      throwApiError("identity_conflict", "expected query identity is required");
    if (query.path !== expected.path || query.query.check_name !== expected.query.check_name)
      throwApiError("identity_conflict", "query does not target the expected C/name identity");
    if (isRecord(expected.identity)) assertQueryIdentity(query.identity, expected.identity);
  }
  assertSafePayload(query);
  return query;
}

export async function collectPaginatedPages({
  firstUrl,
  fetchPage,
  pageSize = EXACT_PAGE_SIZE,
  normalizePage,
  identity,
}) {
  if (typeof firstUrl !== "string" || firstUrl.length === 0)
    throwApiError("invalid_pagination", "first URL is required");
  if (typeof fetchPage !== "function")
    throwApiError("invalid_pagination", "page callback is required");
  if (pageSize !== EXACT_PAGE_SIZE)
    throwApiError("invalid_pagination", "page size is frozen at 100");
  if (normalizePage !== undefined && typeof normalizePage !== "function")
    throwApiError("invalid_pagination", "page normalizer must be a callback");

  const pages = [];
  const visited = new Set();
  const aggregates = new Map();
  let nextUrl = firstUrl;
  while (nextUrl !== null) {
    if (visited.has(nextUrl))
      throwApiError("incomplete_pagination", "Link traversal loop detected");
    visited.add(nextUrl);
    const rawPage = await fetchPage(nextUrl);
    const page =
      normalizePage !== undefined
        ? await normalizePage(rawPage, { identity, url: nextUrl })
        : normalizeGitHubPageIfNeeded(rawPage, identity);
    assertPage(page);
    const aggregate = recordPageAggregate(aggregates, page);
    pages.push(page);
    const next = parseNextLink(readLinkHeader(page.headers));
    if (next === null) {
      if (aggregate !== null && aggregate.uniqueCount !== aggregate.totalCount)
        throwApiError(
          "incomplete_pagination",
          "terminal page count is below the declared aggregate total_count",
        );
      if (aggregate === null && page.items.length === pageSize)
        throwApiError("incomplete_pagination", "full page is missing a Link rel=next boundary");
    }
    nextUrl = next;
  }
  return pages;
}
function splitLinkHeader(linkHeader) {
  const links = [];
  let current = "";
  let inAngle = false;
  let inQuote = false;
  let escaped = false;
  for (const character of linkHeader) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (inQuote && character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      inQuote = !inQuote;
      current += character;
      continue;
    }
    if (!inQuote && character === "<") inAngle = true;
    if (!inQuote && character === ">") inAngle = false;
    if (character === "," && !inQuote && !inAngle) {
      if (current.trim() === "") throwApiError("invalid_pagination", "empty RFC 5988 Link value");
      links.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (inAngle || inQuote) throwApiError("invalid_pagination", "unterminated RFC 5988 Link value");
  if (current.trim() === "") throwApiError("invalid_pagination", "empty RFC 5988 Link value");
  links.push(current.trim());
  return links;
}

function parseLinkParameters(parametersText) {
  if (parametersText.trim() === "") return {};
  const parameters = {};
  let offset = 0;
  while (offset < parametersText.length) {
    while (/\s/.test(parametersText[offset] ?? "")) offset += 1;
    if (parametersText[offset] !== ";")
      throwApiError("invalid_pagination", "malformed RFC 5988 Link parameters");
    offset += 1;
    while (/\s/.test(parametersText[offset] ?? "")) offset += 1;
    const keyStart = offset;
    while (
      offset < parametersText.length &&
      /[!#$%&'*+\-.^_`|~0-9A-Za-z]/.test(parametersText[offset])
    )
      offset += 1;
    if (offset === keyStart)
      throwApiError("invalid_pagination", "malformed RFC 5988 Link parameter name");
    const key = parametersText.slice(keyStart, offset).toLowerCase();
    while (/\s/.test(parametersText[offset] ?? "")) offset += 1;
    if (parametersText[offset] !== "=")
      throwApiError("invalid_pagination", "RFC 5988 Link parameter value is required");
    offset += 1;
    while (/\s/.test(parametersText[offset] ?? "")) offset += 1;
    let value;
    if (parametersText[offset] === '"') {
      offset += 1;
      let quoted = "";
      let closed = false;
      while (offset < parametersText.length) {
        const character = parametersText[offset++];
        if (character === "\\") {
          if (offset >= parametersText.length)
            throwApiError("invalid_pagination", "malformed quoted Link parameter");
          quoted += parametersText[offset++];
        } else if (character === '"') {
          closed = true;
          break;
        } else {
          quoted += character;
        }
      }
      if (!closed) throwApiError("invalid_pagination", "unterminated quoted Link parameter");
      value = quoted;
    } else {
      const valueStart = offset;
      while (
        offset < parametersText.length &&
        parametersText[offset] !== ";" &&
        !/\s/.test(parametersText[offset])
      )
        offset += 1;
      if (offset === valueStart)
        throwApiError("invalid_pagination", "RFC 5988 Link parameter value is invalid");
      value = parametersText.slice(valueStart, offset);
      while (/\s/.test(parametersText[offset] ?? "")) offset += 1;
    }
    if (Object.hasOwn(parameters, key))
      throwApiError("invalid_pagination", `duplicate RFC 5988 Link parameter ${key}`);
    parameters[key] = value;
  }
  return parameters;
}

function readLinkHeader(headers) {
  if (headers === undefined || headers === null) return undefined;
  if (typeof headers.get === "function") {
    return headers.get("link") ?? headers.get("Link") ?? undefined;
  }
  if (!isRecord(headers)) return undefined;
  const value = headers.link ?? headers.Link;
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

export function parseNextLink(linkHeader) {
  if (linkHeader === undefined || linkHeader === null || linkHeader === "") return null;
  if (typeof linkHeader !== "string")
    throwApiError("invalid_pagination", "Link header is not a string");
  const links = splitLinkHeader(linkHeader);
  let next = null;
  for (const link of links) {
    const match = link.match(/^\s*<([^<>]+)>\s*(.*)$/);
    if (match === null) throwApiError("invalid_pagination", "malformed RFC 5988 Link header");
    const parameters = parseLinkParameters(match[2]);
    const relation = parameters.rel;
    if (relation === undefined) continue;
    const relations = relation.split(/\s+/).filter(Boolean);
    if (relations.some((value) => value.toLowerCase() === "next")) {
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
  const normalizedRepositoryPath = normalizeRepositoryPath(repositoryPath);
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
    repository_path: normalizedRepositoryPath,
    head_sha: headSha,
    external_id: externalId,
    fixture_sha256: fixtureSha256,
    policy_sha256: policySha256,
    context,
    check_name: checkName,
    app_id: appId,
  };
}

export function assertRealCheckSuite(suite, identityOrOptions) {
  const identity = normalizeAdapterIdentity(identityOrOptions);
  if (!isRecord(suite)) throwApiError("malformed_response", "GitHub check suite must be an object");
  if (Object.hasOwn(suite, "runs") || Object.hasOwn(suite, "items"))
    throwApiError("malformed_response", "invented nested check-suite fields are not accepted");
  const repository = assertGitHubRepository(suite.repository, identity);
  const app = assertGitHubApp(suite.app, identity);
  assertHeadSha(suite.head_sha, identity);
  assertCheckState(suite.status, suite.conclusion, "check suite");
  if (suite.external_id !== undefined && suite.external_id !== identity.external_id)
    throwApiError("duplicate_refusal", "check suite external id is foreign");
  if (suite.name !== undefined && suite.name !== identity.check_name)
    throwApiError("duplicate_refusal", "check suite name is foreign");
  if (suite.repository_id !== undefined && suite.repository_id !== identity.repository_id)
    throwApiError("duplicate_refusal", "foreign repository identity");
  if (suite.repository_path !== undefined && suite.repository_path !== identity.repository_path)
    throwApiError("duplicate_refusal", "foreign repository identity");
  if (suite.app_id !== undefined && suite.app_id !== identity.app_id)
    throwApiError("duplicate_refusal", "foreign App identity");
  assertOptionalBoundIdentityFields(suite, identity);
  if (!Number.isSafeInteger(suite.id) || suite.id <= 0)
    throwApiError("malformed_response", "GitHub check suite id is invalid");
  return {
    id: suite.id,
    repository_id: repository.id,
    repository_path: repository.full_name,
    head_sha: identity.head_sha,
    external_id: identity.external_id,
    fixture_sha256: identity.fixture_sha256,
    policy_sha256: identity.policy_sha256,
    context: identity.context,
    check_name: identity.check_name,
    app_id: app.id,
    status: suite.status,
    conclusion: suite.conclusion,
  };
}

export function assertRealCheckRun(run, identityOrOptions) {
  const identity = normalizeAdapterIdentity(identityOrOptions);
  if (!isRecord(run)) throwApiError("malformed_response", "GitHub check run must be an object");
  if (Object.hasOwn(run, "runs") || Object.hasOwn(run, "items"))
    throwApiError("malformed_response", "invented nested check-run fields are not accepted");
  const repository = assertGitHubRepository(run.repository, identity);
  const app = assertGitHubApp(run.app, identity);
  assertHeadSha(run.head_sha, identity);
  if (run.name !== identity.check_name)
    throwApiError("duplicate_refusal", "check run name is foreign or missing");
  if (typeof run.external_id !== "string" || run.external_id !== identity.external_id)
    throwApiError("duplicate_refusal", "check run external id is foreign or missing");
  assertOptionalBoundIdentityFields(run, identity);
  assertCheckState(run.status, run.conclusion, "check run");
  if (!Number.isSafeInteger(run.id) || run.id <= 0)
    throwApiError("malformed_response", "GitHub check run id is invalid");
  if (!isRecord(run.check_suite))
    throwApiError("malformed_response", "GitHub check run suite is required");
  const suite = assertRealCheckSuite(run.check_suite, identity);
  const expectedSuiteId = readExpectedSuiteId(identityOrOptions);
  if (expectedSuiteId !== undefined && suite.id !== expectedSuiteId)
    throwApiError("duplicate_refusal", "check run is foreign to the requested suite");
  if (run.output !== undefined) assertSafePayload(run.output);
  return {
    id: run.id,
    suite_id: suite.id,
    repository_id: repository.id,
    repository_path: repository.full_name,
    head_sha: identity.head_sha,
    external_id: identity.external_id,
    fixture_sha256: identity.fixture_sha256,
    policy_sha256: identity.policy_sha256,
    context: identity.context,
    check_name: identity.check_name,
    app_id: app.id,
    status: run.status,
    conclusion: run.conclusion,
    ...(run.output === undefined ? {} : { output: run.output }),
  };
}

export function normalizeCheckSuitesResponse(responseOrOptions, options) {
  const { response, identity, headers } = resolveAdapterInput(responseOrOptions, options);
  const payload = unwrapGitHubResponse(response);
  if (Object.hasOwn(payload, "items") || Object.hasOwn(payload, "runs"))
    throwApiError("malformed_response", "invented nested GitHub response fields are not accepted");
  const verifiedIdentity = normalizeAdapterIdentity(identity);
  if (!isRecord(payload) || !Array.isArray(payload.check_suites))
    throwApiError("malformed_response", "GitHub response must contain check_suites");
  assertTotalCount(payload.total_count, payload.check_suites.length, "check suites");
  const items = payload.check_suites.map((suite) => assertRealCheckSuite(suite, verifiedIdentity));
  return markAdapterPage(
    {
      items,
      total_count: payload.total_count,
      headers: headers ?? response?.headers ?? {},
    },
    "check_suites",
  );
}

export function normalizeCheckRunsResponse(responseOrOptions, options) {
  const { response, identity, headers, suiteId } = resolveAdapterInput(responseOrOptions, options);
  const payload = unwrapGitHubResponse(response);
  if (Object.hasOwn(payload, "items") || Object.hasOwn(payload, "runs"))
    throwApiError("malformed_response", "invented nested GitHub response fields are not accepted");
  const verifiedIdentity = normalizeAdapterIdentity(identity);
  if (!isRecord(payload) || !Array.isArray(payload.check_runs))
    throwApiError("malformed_response", "GitHub response must contain check_runs");
  assertTotalCount(payload.total_count, payload.check_runs.length, "check runs");
  const rawRuns = payload.check_runs;
  const items = rawRuns.map((run) =>
    assertRealCheckRun(run, { identity: verifiedIdentity, suiteId }),
  );
  const suites = new Map();
  for (const run of items) {
    const suite = { id: run.suite_id };
    const existing = suites.get(suite.id);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(suite))
      throwApiError("duplicate_refusal", `conflicting duplicate check suite ${suite.id}`);
    if (existing === undefined) suites.set(suite.id, suite);
  }
  return markAdapterPage(
    {
      items,
      suites: [...suites.values()].sort((left, right) => left.id - right.id),
      total_count: payload.total_count,
      headers: headers ?? response?.headers ?? {},
    },
    "check_runs",
  );
}

function normalizeAdapterIdentity(identityOrOptions) {
  const identity =
    isRecord(identityOrOptions) && isRecord(identityOrOptions.identity)
      ? identityOrOptions.identity
      : identityOrOptions;
  return normalizeEvidenceIdentity(identity);
}

function resolveAdapterInput(responseOrOptions, options) {
  if (
    options === undefined &&
    isRecord(responseOrOptions) &&
    Object.hasOwn(responseOrOptions, "response")
  ) {
    return {
      response: responseOrOptions.response,
      identity: responseOrOptions.identity,
      headers: responseOrOptions.headers,
      suiteId: readSuiteIdOption(responseOrOptions),
    };
  }
  if (
    options === undefined &&
    isRecord(responseOrOptions) &&
    Object.hasOwn(responseOrOptions, "identity") &&
    (Object.hasOwn(responseOrOptions, "data") ||
      Object.hasOwn(responseOrOptions, "body") ||
      Object.hasOwn(responseOrOptions, "payload") ||
      Object.hasOwn(responseOrOptions, "check_runs") ||
      Object.hasOwn(responseOrOptions, "check_suites"))
  ) {
    return {
      response:
        responseOrOptions.response ??
        responseOrOptions.payload ??
        responseOrOptions.data ??
        responseOrOptions.body ??
        responseOrOptions,
      identity: responseOrOptions.identity,
      headers: responseOrOptions.headers,
      suiteId: readSuiteIdOption(responseOrOptions),
    };
  }
  if (
    options !== undefined &&
    isRecord(options) &&
    !Object.hasOwn(options, "identity") &&
    Object.hasOwn(options, "repository_id")
  ) {
    return { response: responseOrOptions, identity: options, suiteId: readSuiteIdOption(options) };
  }
  return {
    response: responseOrOptions,
    identity: isRecord(options) && Object.hasOwn(options, "identity") ? options.identity : options,
    headers: isRecord(options) ? options.headers : undefined,
    suiteId: isRecord(options) ? readSuiteIdOption(options) : undefined,
  };
}

function normalizeGitHubPageIfNeeded(response, identity) {
  if (!isRecord(response) || identity === undefined) return response;
  const payload = unwrapGitHubResponse(response);
  if (Array.isArray(payload.check_runs)) return normalizeCheckRunsResponse(response, { identity });
  if (Array.isArray(payload.check_suites))
    return normalizeCheckSuitesResponse(response, { identity });
  return response;
}
function unwrapGitHubResponse(response) {
  if (!isRecord(response)) throwApiError("malformed_response", "GitHub response is required");
  assertHttpSuccessStatus(response);
  if (
    isRecord(response.data) &&
    !Array.isArray(response.check_suites) &&
    !Array.isArray(response.check_runs)
  )
    return response.data;
  if (
    isRecord(response.body) &&
    !Array.isArray(response.check_suites) &&
    !Array.isArray(response.check_runs)
  )
    return response.body;
  return response;
}

/**
 * Fail closed when a transport/wrapper embeds a non-success HTTP status.
 * Missing status is allowed for already-normalized adapter pages.
 */
function assertHttpSuccessStatus(response) {
  const status =
    response.status ??
    response.statusCode ??
    response.status_code ??
    (isRecord(response.headers) ? response.headers.status : undefined);
  if (status === undefined || status === null) return;
  const numeric = typeof status === "number" ? status : Number(status);
  if (!Number.isSafeInteger(numeric))
    throwApiError("malformed_response", "GitHub response status is invalid");
  if (numeric === 401 || numeric === 403)
    throwApiError("unauthorized_response", `GitHub response status ${numeric} is not authorized`);
  if (numeric === 404)
    throwApiError("not_found_response", "GitHub response status 404 is not found");
  if (numeric === 409)
    throwApiError("conflict_response", "GitHub response status 409 is conflicted");
  if (numeric === 422)
    throwApiError("unprocessable_response", "GitHub response status 422 is unprocessable");
  if (numeric < 200 || numeric >= 300)
    throwApiError("malformed_response", `GitHub response status ${numeric} is not success`);
}

function markAdapterPage(page, kind) {
  Object.defineProperty(page, ADAPTER_PAGE, { value: true });
  Object.defineProperty(page, ADAPTER_KIND, { value: kind });
  return page;
}

function assertGitHubRepository(repository, identity) {
  if (
    !isRecord(repository) ||
    !Number.isSafeInteger(repository.id) ||
    repository.id <= 0 ||
    repository.full_name !== identity.repository_path
  )
    throwApiError("malformed_response", "GitHub response repository identity is required");
  if (repository.id !== identity.repository_id)
    throwApiError("duplicate_refusal", "foreign repository identity");
  return repository;
}

function assertGitHubApp(app, identity) {
  if (!isRecord(app) || !Number.isSafeInteger(app.id) || app.id <= 0)
    throwApiError("app_identity_missing", "GitHub response App identity is required");
  if (app.id !== identity.app_id) throwApiError("duplicate_refusal", "foreign App identity");
  return app;
}

function assertHeadSha(headSha, identity) {
  if (typeof headSha !== "string" || headSha !== identity.head_sha)
    throwApiError("duplicate_refusal", "foreign or moved head C");
}
function assertOptionalBoundIdentityFields(value, identity) {
  for (const field of [
    "repository_id",
    "repository_path",
    "app_id",
    "fixture_sha256",
    "policy_sha256",
    "context",
  ]) {
    if (value[field] !== undefined && value[field] !== identity[field])
      throwApiError("duplicate_refusal", "response identity is foreign");
  }
}

function assertCheckState(status, conclusion, label) {
  if (typeof status !== "string" || !CHECK_RUN_STATUSES.has(status))
    throwApiError("malformed_response", `${label} status is invalid`);
  if (conclusion === undefined)
    throwApiError("malformed_response", `${label} conclusion is required`);
  if (
    conclusion !== null &&
    (typeof conclusion !== "string" || !CHECK_RUN_CONCLUSIONS.has(conclusion))
  )
    throwApiError("malformed_response", `${label} conclusion is invalid`);
  if (status === "completed" && conclusion === null)
    throwApiError("malformed_response", `${label} completed state requires a conclusion`);
  if (status !== "completed" && conclusion !== null)
    throwApiError("malformed_response", `${label} non-completed state cannot have a conclusion`);
}
function readExpectedSuiteId(identityOrOptions) {
  if (!isRecord(identityOrOptions)) return undefined;
  const suiteId =
    identityOrOptions.suiteId ??
    identityOrOptions.suite_id ??
    identityOrOptions.checkSuiteId ??
    identityOrOptions.check_suite_id;
  if (suiteId === undefined) return undefined;
  if (!Number.isSafeInteger(suiteId) || suiteId <= 0)
    throwApiError("invalid_identity", "check suite id is invalid");
  return suiteId;
}
function readSuiteIdOption(value) {
  if (!isRecord(value)) return undefined;
  return value.suiteId ?? value.suite_id ?? value.checkSuiteId ?? value.check_suite_id;
}

function assertTotalCount(totalCount, itemCount, label) {
  if (!Number.isSafeInteger(totalCount) || totalCount < itemCount)
    throwApiError("malformed_response", `GitHub ${label} total_count is invalid`);
  if (itemCount > EXACT_PAGE_SIZE)
    throwApiError("malformed_response", `GitHub ${label} page exceeds per_page=100`);
}
function recordPageAggregate(aggregates, page) {
  if (page[ADAPTER_PAGE] !== true) return null;
  const kind = page[ADAPTER_KIND];
  if (kind !== "check_suites" && kind !== "check_runs")
    throwApiError("malformed_response", "unknown evidence adapter page");
  if (!Number.isSafeInteger(page.total_count) || page.total_count < 0)
    throwApiError("malformed_response", "GitHub aggregate total_count is invalid");
  let aggregate = aggregates.get(kind);
  if (aggregate === undefined) {
    aggregate = { totalCount: page.total_count, ids: new Set() };
    aggregates.set(kind, aggregate);
  } else if (aggregate.totalCount !== page.total_count) {
    throwApiError("malformed_response", `GitHub ${kind} total_count changed during pagination`);
  }
  for (const item of page.items) {
    const id = isRecord(item) && Number.isSafeInteger(item.id) ? item.id : canonicalJson(item);
    aggregate.ids.add(id);
  }
  if (aggregate.ids.size > aggregate.totalCount)
    throwApiError("malformed_response", `GitHub ${kind} unique count exceeds total_count`);
  return {
    totalCount: aggregate.totalCount,
    uniqueCount: aggregate.ids.size,
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
  const verifiedIdentity = normalizeEvidenceIdentity(identity);
  if (!Number.isSafeInteger(suiteCap) || suiteCap < 1 || suiteCap > CHECK_SUITE_CAP)
    throwApiError("cap_exceeded", "suite cap is invalid");
  const runs = new Map();
  const suites = new Map();
  let legacySuiteCount = 0;
  for (const page of pages) {
    assertPage(page);
    if (page[ADAPTER_PAGE] === true) {
      if (page[ADAPTER_KIND] === "check_runs") {
        if (!Array.isArray(page.suites))
          throwApiError("malformed_response", "normalized check-run suites are required");
        for (const suite of page.suites)
          registerNormalizedSuite(suites, suite, suiteCap, verifiedIdentity);
        for (const run of page.items) {
          assertNormalizedRun(run, verifiedIdentity);
          registerRun(runs, run);
        }
      } else if (page[ADAPTER_KIND] === "check_suites") {
        for (const suite of page.items)
          registerNormalizedSuite(suites, suite, suiteCap, verifiedIdentity);
        if (Array.isArray(page.runs)) {
          for (const run of page.runs) {
            assertNormalizedRun(run, verifiedIdentity);
            registerRun(runs, run);
          }
        }
      } else {
        throwApiError("malformed_response", "unknown evidence adapter page");
      }
      continue;
    }

    // Legacy pages are retained for internal predicate tests only. Receipts require
    // adapter-marked GitHub pages and therefore cannot accidentally trust this shape.
    for (const suite of page.items) {
      legacySuiteCount += 1;
      if (legacySuiteCount > suiteCap) throwApiError("cap_exceeded", "check suite cap exceeded");
      assertEvidenceRecord(suite, verifiedIdentity);
      if (!Array.isArray(suite.runs))
        throwApiError("malformed_response", "suite runs are required");
      for (const run of suite.runs) {
        if (!isRecord(run) || !Number.isSafeInteger(run.id) || run.id <= 0)
          throwApiError("malformed_response", "check run id is invalid");
        if (run.app_id !== verifiedIdentity.app_id || run.head_sha !== verifiedIdentity.head_sha)
          throwApiError("duplicate_refusal", "check run identity is foreign or moved");
        assertSafePayload(run);
        registerRun(runs, run);
      }
    }
  }
  return [...runs.values()].sort((left, right) => left.id - right.id);
}

function registerNormalizedSuite(suites, suite, suiteCap, identity) {
  if (!isRecord(suite) || !Number.isSafeInteger(suite.id) || suite.id <= 0)
    throwApiError("malformed_response", "normalized check suite id is invalid");
  if (identity !== undefined) assertNormalizedSuiteIdentity(suite, identity);
  const existing = suites.get(suite.id);
  if (existing !== undefined) {
    const merged = mergeNormalizedSuite(existing, suite);
    suites.set(suite.id, merged);
    return;
  }
  suites.set(suite.id, suite);
  if (suites.size > suiteCap) throwApiError("cap_exceeded", "check suite cap exceeded");
}

function assertNormalizedSuiteIdentity(suite, identity) {
  const fields = [
    "repository_id",
    "repository_path",
    "head_sha",
    "external_id",
    "fixture_sha256",
    "policy_sha256",
    "context",
    "check_name",
    "app_id",
  ];
  for (const field of fields) {
    if (suite[field] !== undefined && suite[field] !== identity[field])
      throwApiError("duplicate_refusal", "normalized check suite identity is foreign");
  }
}

function mergeNormalizedSuite(existing, incoming) {
  const merged = { ...existing };
  for (const key of Object.keys(incoming)) {
    if (merged[key] !== undefined && canonicalJson(merged[key]) !== canonicalJson(incoming[key]))
      throwApiError("duplicate_refusal", `conflicting duplicate check suite ${incoming.id}`);
    if (merged[key] === undefined) merged[key] = incoming[key];
  }
  return merged;
}

function assertNormalizedRun(run, identity) {
  if (!isRecord(run) || !Number.isSafeInteger(run.id) || run.id <= 0)
    throwApiError("malformed_response", "normalized check run id is invalid");
  if (
    run.repository_id !== identity.repository_id ||
    run.repository_path !== identity.repository_path ||
    run.head_sha !== identity.head_sha ||
    run.external_id !== identity.external_id ||
    run.fixture_sha256 !== identity.fixture_sha256 ||
    run.policy_sha256 !== identity.policy_sha256 ||
    run.context !== identity.context ||
    run.check_name !== identity.check_name ||
    run.app_id !== identity.app_id
  )
    throwApiError("duplicate_refusal", "normalized check run identity is foreign");
  assertCheckState(run.status, run.conclusion, "normalized check run");
  assertSafePayload(run);
}

function registerRun(runs, run) {
  const existing = runs.get(run.id);
  if (existing !== undefined && canonicalJson(existing) !== canonicalJson(run))
    throwApiError("duplicate_refusal", `conflicting duplicate check run ${run.id}`);
  if (existing === undefined) runs.set(run.id, run);
}
export const EVIDENCE_RECEIPT_SCHEMA = "product4-evidence-api-receipt-v1";

export function buildEvidenceReceipt({ query, pages, identity, observedAt }) {
  const verifiedIdentity = normalizeEvidenceIdentity(identity);
  assertExactCheckQuery(query);
  assertQueryBoundToIdentity(query, verifiedIdentity);
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > CHECK_SUITE_CAP)
    throwApiError("malformed_response", "evidence pages must be bounded and non-empty");
  if (pages.some((page) => page[ADAPTER_PAGE] !== true))
    throwApiError("malformed_response", "real GitHub adapter pages are required");
  assertCompleteAdapterPagination(pages);
  const runs = collectCheckRuns({ pages, identity: verifiedIdentity });
  if (runs.length === 0)
    throwApiError("malformed_response", "verified evidence must contain a check run");
  if (runs.length !== 1)
    throwApiError("duplicate_refusal", "exact C/name/App lookup returned multiple check runs");
  const [run] = runs;
  if (run.status !== "completed" || run.conclusion !== "success")
    throwApiError("terminal_refusal", "exact check run did not reach terminal success");
  const suites = collectIndependentSuites(pages, verifiedIdentity);
  if (suites.size === 0)
    throwApiError("malformed_response", "independent check-suite enumeration is required");
  if (!suites.has(run.suite_id))
    throwApiError("identity_conflict", "check run suite is missing from independent enumeration");
  const suite = suites.get(run.suite_id);
  if (suite.status !== "completed" || suite.conclusion !== "success")
    throwApiError("terminal_refusal", "check suite did not reach terminal success");
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
    suite_count: suites.size,
    run_ids: runs.map((run) => run.id),
    observed_at: observedAt,
  };
  const receipt = { ...unsigned, receipt_digest: digestJson(unsigned) };
  return assertEvidenceReceipt(receipt);
}

function assertQueryBoundToIdentity(query, identity) {
  const expectedPath = `${identity.repository_path}/commits/${identity.head_sha}/check-runs`;
  if (query.path !== expectedPath || query.query.check_name !== identity.check_name)
    throwApiError("identity_conflict", "query does not target the normalized C/name identity");
  assertQueryIdentity(query.identity, {
    repository_id: identity.repository_id,
    repository_path: identity.repository_path,
    head_sha: identity.head_sha,
    check_name: identity.check_name,
    fixture_sha256: identity.fixture_sha256,
    policy_sha256: identity.policy_sha256,
    context: identity.context,
  });
}

function assertQueryIdentity(actual, expected) {
  if (!isRecord(actual)) throwApiError("identity_conflict", "query identity is required");
  for (const key of Object.keys(actual)) {
    if (
      ![
        "repository_id",
        "repository_path",
        "head_sha",
        "check_name",
        "fixture_sha256",
        "policy_sha256",
        "context",
      ].includes(key)
    )
      throwApiError("identity_conflict", `query identity field ${key} is unsupported`);
  }
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key])
      throwApiError("identity_conflict", `query identity ${key} does not match`);
  }
}

function assertCompleteAdapterPagination(pages) {
  const aggregates = new Map();
  for (const page of pages) {
    const kind = page[ADAPTER_KIND];
    if (kind !== "check_suites" && kind !== "check_runs")
      throwApiError("malformed_response", "unknown evidence adapter page");
    if (!Number.isSafeInteger(page.total_count) || page.total_count < 0)
      throwApiError("malformed_response", "GitHub aggregate total_count is invalid");
    let aggregate = aggregates.get(kind);
    if (aggregate === undefined) {
      aggregate = {
        totalCount: page.total_count,
        ids: new Set(),
        terminal: false,
      };
      aggregates.set(kind, aggregate);
    } else if (aggregate.totalCount !== page.total_count || aggregate.terminal) {
      throwApiError("incomplete_pagination", `GitHub ${kind} pagination is not contiguous`);
    }
    for (const item of page.items) {
      if (!isRecord(item) || !Number.isSafeInteger(item.id) || item.id <= 0)
        throwApiError("malformed_response", `normalized ${kind} id is invalid`);
      aggregate.ids.add(item.id);
    }
    const next = parseNextLink(readLinkHeader(page.headers));
    if (next === null) aggregate.terminal = true;
  }
  for (const kind of ["check_suites", "check_runs"]) {
    const aggregate = aggregates.get(kind);
    if (aggregate === undefined)
      throwApiError("incomplete_pagination", `independent ${kind} enumeration is required`);
    if (!aggregate.terminal || aggregate.ids.size !== aggregate.totalCount)
      throwApiError(
        "incomplete_pagination",
        `terminal ${kind} page count does not reconcile with total_count`,
      );
  }
}

function collectIndependentSuites(pages, identity) {
  const suites = new Map();
  for (const page of pages) {
    if (page[ADAPTER_KIND] !== "check_suites") continue;
    for (const suite of page.items) {
      if (!isRecord(suite) || !Number.isSafeInteger(suite.id) || suite.id <= 0)
        throwApiError("malformed_response", "normalized check suite id is invalid");
      if (identity !== undefined) assertNormalizedSuiteIdentity(suite, identity);
      const existing = suites.get(suite.id);
      if (existing !== undefined) suites.set(suite.id, mergeNormalizedSuite(existing, suite));
      else suites.set(suite.id, suite);
    }
  }
  return suites;
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
    receipt.run_ids.length !== 1 ||
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
  freshGet,
  fetchPendingRun,
  getPendingRun,
  freshRun,
  freshPendingRun,
  fetchRun,
  getRun,
  freshQuery,
}) {
  if (!isRecord(pendingRun))
    throwApiError("invalid_reconciliation", "pending run identity is required");
  if (!isRecord(attemptedPatch))
    throwApiError("invalid_reconciliation", "attempted PATCH payload is required");
  if (!Number.isSafeInteger(retryCount) || retryCount < 0)
    throwApiError("invalid_reconciliation", "retry count is invalid");
  assertSafePayload(attemptedPatch);
  const verifiedIdentity = normalizeEvidenceIdentity(identity);
  const pendingIdentity = readReconciliationRun(pendingRun, verifiedIdentity);
  if (pendingIdentity === null || !isPendingState(pendingRun))
    return indeterminatePatch("pending run is foreign or no longer pending");
  const freshValue = freshRun ?? freshPendingRun;
  const freshReader = freshGet ?? fetchPendingRun ?? getPendingRun ?? fetchRun ?? getRun;
  if (freshReader !== undefined && typeof freshReader !== "function")
    throwApiError("invalid_reconciliation", "fresh pending-run GET must be a callback");

  const expectedQuery = freezeExactQuery(buildFreshRunQuery(verifiedIdentity, pendingRun.id));
  if (freshQuery !== undefined) assertFreshRunQuery(freshQuery, expectedQuery);

  if (freshReader === undefined && freshValue !== undefined)
    return reconcileFreshPatchResponse({
      value: freshValue,
      expectedQuery,
      verifiedIdentity,
      pendingRun,
      pendingIdentity,
      attemptedPatch,
      retryCount,
    });
  if (freshReader !== undefined) {
    let response;
    try {
      response = freshReader(expectedQuery, { identity: verifiedIdentity, pendingRun });
    } catch {
      return indeterminatePatch("fresh pending-run GET failed");
    }
    if (response !== null && typeof response?.then === "function") {
      return Promise.resolve(response)
        .then((value) =>
          reconcileFreshPatchResponse({
            value,
            expectedQuery,
            verifiedIdentity,
            pendingRun,
            pendingIdentity,
            attemptedPatch,
            retryCount,
          }),
        )
        .catch(() => indeterminatePatch("fresh pending-run GET failed"));
    }
    return reconcileFreshPatchResponse({
      value: response,
      expectedQuery,
      verifiedIdentity,
      pendingRun,
      pendingIdentity,
      attemptedPatch,
      retryCount,
    });
  }

  throwApiError(
    "fresh_lookup_required",
    "lost PATCH reconciliation requires a fresh exact check-run GET",
  );
}

function reconcileFreshPatchResponse({
  value,
  expectedQuery,
  verifiedIdentity,
  pendingRun,
  pendingIdentity,
  attemptedPatch,
  retryCount,
}) {
  try {
    if (isRecord(value) && Object.hasOwn(value, "query"))
      assertFreshRunQuery(value.query, expectedQuery);
    const freshMatches = extractFreshRunMatches(value, verifiedIdentity);
    if (freshMatches.length !== 1)
      return indeterminatePatch(
        freshMatches.length === 0
          ? "fresh pending run is missing"
          : "fresh pending-run GET returned conflicting runs",
      );
    const freshRun = readReconciliationRun(freshMatches[0], verifiedIdentity);
    if (freshRun === null || freshRun.id !== pendingRun.id)
      return indeterminatePatch("fresh pending-run GET returned a foreign run");
    if (isPendingState(freshRun)) {
      if (
        !samePendingIdentity(pendingIdentity, freshRun) ||
        !samePendingState(pendingRun, freshRun) ||
        !samePayloadIdentity(pendingRun, freshRun)
      )
        return indeterminatePatch("pending run state or payload identity changed");
      if (retryCount !== 0) return indeterminatePatch("lost PATCH retry limit exhausted");
      return {
        status: "retry_once",
        retry_allowed: true,
        retry_payload: clonePayload(attemptedPatch),
      };
    }
    if (
      samePendingIdentity(pendingIdentity, freshRun) &&
      matchesAttemptedPatch(pendingRun, freshRun, attemptedPatch)
    ) {
      return {
        status: "patch_reconciled",
        retry_allowed: false,
        requires_human_reconciliation: false,
        run: freshRun,
      };
    }
    return indeterminatePatch("fresh pending run is non-pending or annotation identity changed");
  } catch {
    return indeterminatePatch("fresh pending-run GET response was foreign or malformed");
  }
}

function buildFreshRunQuery(identity, runId) {
  if (!Number.isSafeInteger(runId) || runId <= 0)
    throwApiError("invalid_reconciliation", "pending run id is invalid");
  return {
    method: "GET",
    path: `${identity.repository_path}/check-runs/${runId}`,
    query: {},
    identity: {
      repository_id: identity.repository_id,
      repository_path: identity.repository_path,
      head_sha: identity.head_sha,
      check_name: identity.check_name,
      external_id: identity.external_id,
      fixture_sha256: identity.fixture_sha256,
      policy_sha256: identity.policy_sha256,
      context: identity.context,
      app_id: identity.app_id,
    },
  };
}
function freezeExactQuery(query) {
  Object.freeze(query.identity);
  Object.freeze(query.query);
  return Object.freeze(query);
}

function assertFreshRunQuery(actual, expected) {
  if (!isRecord(actual) || actual.method !== "GET" || actual.path !== expected.path)
    throwApiError("identity_conflict", "fresh lookup must target the same check run");
  if (!isRecord(actual.query) || Object.keys(actual.query).length !== 0)
    throwApiError("identity_conflict", "fresh check-run lookup contains unsupported parameters");
  if (!isRecord(actual.identity))
    throwApiError("identity_conflict", "fresh check-run lookup identity is required");
  const actualKeys = Object.keys(actual.identity).sort();
  const expectedKeys = Object.keys(expected.identity).sort();
  if (actualKeys.join(",") !== expectedKeys.join(","))
    throwApiError(
      "identity_conflict",
      "fresh check-run lookup identity contains unsupported fields",
    );
  for (const [key, value] of Object.entries(expected.identity))
    if (actual.identity[key] !== value)
      throwApiError("identity_conflict", `fresh check-run identity ${key} does not match`);
}

function extractFreshRunMatches(value, identity) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((run) => normalizeFreshRun(run, identity));
  if (value[ADAPTER_PAGE] === true) {
    assertPage(value);
    if (value[ADAPTER_KIND] !== "check_runs")
      throwApiError("malformed_response", "fresh lookup must return a check-run adapter page");
    return value.items.map((run) => normalizeFreshRun(run, identity));
  }
  if (!isRecord(value)) return [];
  if (Object.hasOwn(value, "run")) return extractFreshRunMatches(value.run, identity);
  if (Object.hasOwn(value, "response")) return extractFreshRunMatches(value.response, identity);
  if (Array.isArray(value.check_runs)) return normalizeCheckRunsResponse(value, { identity }).items;
  if (isRecord(value.data) || isRecord(value.body))
    return extractFreshRunMatches(value.data ?? value.body, identity);
  if (Number.isSafeInteger(value.id)) return [normalizeFreshRun(value, identity)];
  return [];
}

function normalizeFreshRun(run, identity) {
  if (!isRecord(run) || !Number.isSafeInteger(run.id) || run.id <= 0)
    throwApiError("malformed_response", "fresh check-run identity is required");
  if (run.repository_id !== undefined) {
    const normalized = assertEvidenceRecord(run, identity);
    if (!Number.isSafeInteger(normalized.suite_id) || normalized.suite_id <= 0)
      throwApiError("malformed_response", "fresh check-run suite identity is required");
    return normalized;
  }
  assertStrictGitHubRun(run, identity);
  return assertRealCheckRun(run, identity);
}

function assertStrictGitHubRun(run, identity) {
  if (!isRecord(run.repository) || !isRecord(run.app) || typeof run.head_sha !== "string")
    throwApiError("malformed_response", "fresh GitHub check-run identity is incomplete");
  if (
    run.name !== identity.check_name ||
    run.external_id !== identity.external_id ||
    run.head_sha !== identity.head_sha
  )
    throwApiError("duplicate_refusal", "fresh check-run identity is foreign");
  if (!Number.isSafeInteger(run.app.id) || run.app.id !== identity.app_id)
    throwApiError("app_identity_missing", "fresh GitHub check-run App identity is required");
  if (
    run.repository.id !== identity.repository_id ||
    run.repository.full_name !== identity.repository_path
  )
    throwApiError("duplicate_refusal", "fresh check-run repository identity is foreign");
  if (!isRecord(run.check_suite))
    throwApiError("malformed_response", "fresh GitHub check-run suite is required");
  assertStrictGitHubSuite(run.check_suite, identity);
}

function assertStrictGitHubSuite(suite, identity) {
  if (
    !isRecord(suite.repository) ||
    !isRecord(suite.app) ||
    typeof suite.head_sha !== "string" ||
    suite.head_sha !== identity.head_sha ||
    suite.repository.id !== identity.repository_id ||
    suite.repository.full_name !== identity.repository_path ||
    !Number.isSafeInteger(suite.app.id) ||
    suite.app.id !== identity.app_id
  )
    throwApiError("duplicate_refusal", "fresh check-run suite identity is foreign or incomplete");
}

function readReconciliationRun(run, identity) {
  try {
    return normalizeFreshRun(run, identity);
  } catch {
    return null;
  }
}

function isPendingState(run) {
  return (
    isRecord(run) &&
    typeof run.status === "string" &&
    CHECK_RUN_STATUSES.has(run.status) &&
    run.status !== "completed" &&
    (run.conclusion === null || run.conclusion === undefined || run.conclusion === "pending")
  );
}

function samePendingIdentity(left, right) {
  if (!isRecord(left) || !isRecord(right)) return false;
  const fields = [
    "id",
    "suite_id",
    "repository_id",
    "repository_path",
    "head_sha",
    "external_id",
    "fixture_sha256",
    "policy_sha256",
    "context",
    "check_name",
    "app_id",
  ];
  return fields.every((field) => {
    if (field === "suite_id" && (left[field] === undefined || right[field] === undefined))
      return true;
    return left[field] === right[field];
  });
}

function samePendingState(left, right) {
  return (
    isPendingState(left) &&
    isPendingState(right) &&
    left.status === right.status &&
    (left.conclusion ?? null) === (right.conclusion ?? null)
  );
}

function payloadIdentity(run) {
  if (!isRecord(run)) return undefined;
  const payload = {};
  for (const key of ["output", "payload", "annotations", "annotation_identity", "annotation"]) {
    if (Object.hasOwn(run, key)) payload[key] = run[key];
  }
  if (isRecord(run.output) && Object.hasOwn(run.output, "annotations"))
    payload.annotations = run.output.annotations;
  return Object.keys(payload).length === 0 ? undefined : payload;
}

function samePayloadIdentity(left, right) {
  return canonicalJson(payloadIdentity(left)) === canonicalJson(payloadIdentity(right));
}

function mergedPatchRun(pendingRun, attemptedPatch) {
  const merged = { ...pendingRun, ...attemptedPatch };
  if (isRecord(pendingRun.output) && isRecord(attemptedPatch.output))
    merged.output = { ...pendingRun.output, ...attemptedPatch.output };
  return merged;
}

function matchesAttemptedPatch(pendingRun, freshRun, attemptedPatch) {
  const expected = mergedPatchRun(pendingRun, attemptedPatch);
  if (!samePendingIdentity(pendingRun, freshRun)) return false;
  if (expected.status !== freshRun.status || expected.conclusion !== freshRun.conclusion)
    return false;
  const expectedPayload = payloadIdentity(expected);
  const actualPayload = payloadIdentity(freshRun);
  if (expectedPayload === undefined) return actualPayload === undefined;
  return canonicalJson(expectedPayload) === canonicalJson(actualPayload);
}

function clonePayload(value) {
  return isRecord(value) ? structuredClone(value) : value;
}

function indeterminatePatch(reason) {
  return {
    status: "patch_indeterminate",
    retry_allowed: false,
    requires_human_reconciliation: true,
    reason,
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
  if (page[ADAPTER_PAGE] === true) {
    if (page[ADAPTER_KIND] !== "check_suites" && page[ADAPTER_KIND] !== "check_runs")
      throwApiError("malformed_response", "unknown evidence adapter page");
    if (!Number.isSafeInteger(page.total_count) || page.total_count < 0)
      throwApiError("malformed_response", "normalized page total_count is invalid");
  }
}

function normalizeRepositoryPath(repositoryPath) {
  if (typeof repositoryPath !== "string")
    throwApiError("identity_conflict", "repository path is required");
  // Exact owner/name only. Reject traversal, absolute paths, empty segments, and extras.
  const trimmed = repositoryPath.trim();
  if (trimmed.length < 3 || trimmed.length > 200)
    throwApiError("identity_conflict", "repository path is invalid");
  if (trimmed.startsWith("/") || trimmed.includes("\\") || trimmed.includes("\0"))
    throwApiError("identity_conflict", "repository path is unsafe");
  const segments = trimmed.replace(/\/+$/, "").split("/");
  if (segments.length !== 2)
    throwApiError("identity_conflict", "repository path must be exactly owner/name");
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(segment)
    )
      throwApiError("identity_conflict", "repository path is unsafe");
  }
  return `${segments[0]}/${segments[1]}`;
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
