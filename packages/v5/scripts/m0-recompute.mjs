#!/usr/bin/env node
/**
 * Independently recompute V5-M0 contract digests/signatures from literal fixtures.
 * Never trusts copied plan hashes without recomputation.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const FIX = path.join(ROOT, "fixtures/v5/m0");
const OUT = path.join(ROOT, "artifacts/v5/m0");

function jcs(x) {
  if (x === null) return "null";
  if (typeof x === "boolean") return x ? "true" : "false";
  if (typeof x === "number") {
    if (!Number.isFinite(x)) throw new Error("non-finite number in JCS");
    return String(x);
  }
  if (typeof x === "string") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(jcs).join(",") + "]";
  if (typeof x === "object") {
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + jcs(x[k]))
        .join(",") +
      "}"
    );
  }
  throw new Error("unsupported JCS type: " + typeof x);
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function auditFree(x) {
  if (Array.isArray(x)) return x.map(auditFree);
  if (x && typeof x === "object") {
    const out = {};
    for (const k of Object.keys(x)) {
      if (k === "audit_envelope") continue;
      out[k] = auditFree(x[k]);
    }
    return out;
  }
  return x;
}

function runtimeInfo() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    tool: "packages/v5/scripts/m0-recompute.mjs",
  };
}

function writeReceipt(name, body) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  return file;
}

// --- Redaction ---
const redactPath = path.join(FIX, "redact_v1_vectors.json");
const redactVectors = JSON.parse(fs.readFileSync(redactPath, "utf8"));
if (!Array.isArray(redactVectors) || redactVectors.length !== 24) {
  throw new Error(`expected exactly 24 redact vectors, got ${redactVectors?.length}`);
}
// Literal pair validation: no wrapper reconstruction
for (const v of redactVectors) {
  if (typeof v.raw_outer_b64 !== "string") throw new Error(`${v.id}: missing raw_outer_b64`);
  if (!(v.decoded_inner_b64 === null || typeof v.decoded_inner_b64 === "string")) {
    throw new Error(`${v.id}: decoded_inner_b64 must be string|null`);
  }
  if (v.decoded_inner_b64 !== null) {
    const outer = Buffer.from(v.raw_outer_b64, "base64");
    const outerText = outer.toString("utf8");
    let recordsB64 = null;
    try {
      const env = JSON.parse(outerText);
      recordsB64 = env.records_b64 ?? null;
    } catch {
      /* outer may be non-JSON for schema vectors */
    }
    if (recordsB64 != null) {
      const decoded = Buffer.from(recordsB64, "base64");
      const expected = Buffer.from(v.decoded_inner_b64, "base64");
      if (!decoded.equals(expected)) {
        throw new Error(`${v.id}: records_b64 decode != decoded_inner_b64 (byte-for-byte)`);
      }
    }
  }
}
const redactComputed = "sha256:" + sha256Hex(jcs(redactVectors));
const redactExpected = "sha256:a020e5cbb35a3249c0e5060e2094aa225a14f99a193673249f6a461a5dfd6eeb";
const redactPass = redactComputed === redactExpected;

const redactionReceipt = {
  schema: "carpeos.v5.m0-computation-receipt/v1",
  contract: "redact_v1",
  timestamp: new Date().toISOString(),
  runtime: runtimeInfo(),
  canonical_input: {
    path: "fixtures/v5/m0/redact_v1_vectors.json",
    vector_count: redactVectors.length,
  },
  canonicalization: {
    procedure:
      "RFC 8785-style sorted-key UTF-8 JCS over the exact 24-vector array; no wrapper reconstruction",
    jcs: "packages/v5/scripts/m0-recompute.mjs#jcs",
  },
  command: "node packages/v5/scripts/m0-recompute.mjs  # redaction branch: sha256(jcs(vectors))",
  computed_value: redactComputed,
  expected_value: redactExpected,
  pass: redactPass,
  notes: [
    "P0 schema errors precede ordering/policy checks (enforced by vector expected fields).",
    "Post-P0 policy errors use byte_offset:null in expected fixtures.",
  ],
};
writeReceipt("redaction-computation-receipt.json", redactionReceipt);

// --- Reducer ---
const reducerFixtures = [
  "reorder_v1",
  "duplicate_overlap_v1",
  "no_candidate_v1",
  "prior_reviewable_v1",
];
const reducerExpected = {
  reorder_v1: "ee7f8e42019cb4f0e3318869cfa7dd9263b7fa5e2a0a7613b882bd06994dc8ea",
  duplicate_overlap_v1: "1ab98680ead8df03baa1e16c863261993cfeff63e22d16f68d047b42b7fd9d23",
  no_candidate_v1: "93325460c5072d00f25a1b2dc02a148dcf31f7bc63e3b89b128004d8476fe156",
  prior_reviewable_v1: "7358225464e3defec3adba8d6b92316e3b3fea02d155667a5a71132ea4cba7f0",
};
const reducerResults = [];
for (const name of reducerFixtures) {
  const p = path.join(FIX, `reducer_${name}.json`);
  const fixture = JSON.parse(fs.readFileSync(p, "utf8"));
  const free = auditFree(fixture.output);
  const computed = sha256Hex(jcs(free));
  const expected = reducerExpected[name];
  // Audit timestamp mutation must not alter hash
  const mutated = structuredClone(fixture.output);
  if (mutated.proposal_row?.audit_envelope) {
    mutated.proposal_row.audit_envelope.updated_at = "2099-01-01T00:00:00Z";
  }
  const mutatedHash = sha256Hex(jcs(auditFree(mutated)));
  reducerResults.push({
    fixture: name,
    path: `fixtures/v5/m0/reducer_${name}.json`,
    computed_value: computed,
    expected_value: expected,
    declared_output_sha256: fixture.expected?.output_sha256 ?? null,
    pass: computed === expected,
    audit_timestamp_mutation_invariant: mutatedHash === computed,
  });
}
const reducerPass = reducerResults.every((r) => r.pass && r.audit_timestamp_mutation_invariant);
const reducerReceipt = {
  schema: "carpeos.v5.m0-computation-receipt/v1",
  contract: "proposal_reduce_v1",
  timestamp: new Date().toISOString(),
  runtime: runtimeInfo(),
  canonical_input: {
    paths: reducerFixtures.map((n) => `fixtures/v5/m0/reducer_${n}.json`),
  },
  canonicalization: {
    procedure:
      "audit_free recursively removes only audit_envelope; output hash = sha256(JCS(audit_free(ReducerOutput)))",
    jcs: "packages/v5/scripts/m0-recompute.mjs#jcs",
  },
  command:
    "node packages/v5/scripts/m0-recompute.mjs  # reducer branch: sha256(jcs(audit_free(output)))",
  results: reducerResults,
  pass: reducerPass,
};
writeReceipt("reducer-computation-receipt.json", reducerReceipt);

// --- Telemetry ---
const require = createRequire(import.meta.url);
const genPath = path.join(FIX, "telemetry_generator_normative.js");
const genSrc = fs.readFileSync(genPath, "utf8");
const module = { exports: {} };
const wrapped = `${genSrc}
module.exports = {
  ALLOCATIONS,
  REQUESTS,
  SNAPSHOTS,
  sha,
  allocation_manifest: "sha256:" + sha(ALLOCATIONS),
};
`;
const fn = new Function("require", "module", "exports", "console", wrapped);
fn(require, module, module.exports, {
  log() {},
  assert(c, m) {
    if (!c) throw new Error("telemetry generator assert failed: " + (m || ""));
  },
});
const tel = module.exports;
const expectedManifest = "sha256:e525906cc32b62d7e5c5c1657a947eee32b172d77aac2b81b5215c196394256a";
const expectedSpki = "MCowBQYDK2VwAyEAA6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
const SEED_BYTES = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
);
const PRIVATE = crypto.createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), SEED_BYTES]),
  format: "der",
  type: "pkcs8",
});
const PUBLIC = crypto.createPublicKey(PRIVATE);
const pubSpki = PUBLIC.export({ type: "spki", format: "der" }).toString("base64");
const expectedSchedule = JSON.parse(
  fs.readFileSync(path.join(FIX, "telemetry_schedule_manifest_expected.json"), "utf8"),
);

let sigOk = 0;
const snapshotRows = [];
for (let i = 0; i < tel.SNAPSHOTS.length; i++) {
  const s = tel.SNAPSHOTS[i];
  const unsigned = {
    schema: s.schema,
    account_id: s.account_id,
    issuer_key_id: s.issuer_key_id,
    authorization_epoch: s.authorization_epoch,
    issued_at: s.issued_at,
    expires_at: s.expires_at,
    allocations: s.allocations,
    revoked_allocation_ids: s.revoked_allocation_ids,
  };
  const bytes = Buffer.from(jcs(unsigned));
  const dig = "sha256:" + sha256Hex(bytes);
  const sigBuf = Buffer.from(s.signature.replace(/^ed25519:/, ""), "base64");
  const verified = dig === s.snapshot_digest && crypto.verify(null, bytes, PUBLIC, sigBuf);
  if (verified) sigOk++;
  const exp = expectedSchedule.snapshot_manifest[i];
  snapshotRows.push({
    index: i,
    issued_at: s.issued_at,
    computed_digest: s.snapshot_digest,
    expected_digest: exp.digest,
    digest_match: s.snapshot_digest === exp.digest,
    signature_match: s.signature === exp.signature,
    signature_verified: verified,
  });
}

const counts = {
  new: tel.REQUESTS.filter((x) => x.request_kind === "new").length,
  replay: tel.REQUESTS.filter((x) => x.request_kind === "replay").length,
  conflict: tel.REQUESTS.filter((x) => x.request_kind === "conflict").length,
  expired: tel.REQUESTS.filter((x) => x.request_kind === "expired").length,
};
const bodySizesOk = tel.REQUESTS.every((r) => Buffer.byteLength(jcs(r.body)) === 16384);
const grants = tel.ALLOCATIONS.reduce((n, x) => n + x.request_grants.length, 0);
const telemetryPass =
  tel.allocation_manifest === expectedManifest &&
  pubSpki === expectedSpki &&
  tel.ALLOCATIONS.length === 96 &&
  grants === 576 &&
  tel.REQUESTS.length === 576 &&
  tel.SNAPSHOTS.length === 30 &&
  sigOk === 30 &&
  snapshotRows.every((r) => r.digest_match && r.signature_match && r.signature_verified) &&
  counts.new === 384 &&
  counts.replay === 128 &&
  counts.conflict === 32 &&
  counts.expired === 32 &&
  bodySizesOk;

const telemetryReceipt = {
  schema: "carpeos.v5.m0-computation-receipt/v1",
  contract: "telemetry_admission_workload_v1",
  timestamp: new Date().toISOString(),
  runtime: runtimeInfo(),
  canonical_input: {
    generator: "fixtures/v5/m0/telemetry_generator_normative.js",
    expected_manifest: "fixtures/v5/m0/telemetry_schedule_manifest_expected.json",
    synthetic_seed: "v5-contract-closure-20260806-synthetic-01",
  },
  canonicalization: {
    procedure:
      "Normative generator JCS; allocation_manifest=sha256(JCS(ALLOCATIONS)); snapshot digests/signatures over JCS(unsigned snapshot) with fixed test Ed25519 key",
    jcs: "fixtures/v5/m0/telemetry_generator_normative.js#jcs",
  },
  command: "node packages/v5/scripts/m0-recompute.mjs  # telemetry branch",
  computed: {
    allocation_manifest: tel.allocation_manifest,
    public_spki_der_b64: pubSpki,
    allocation_count: tel.ALLOCATIONS.length,
    grant_count: grants,
    request_count: tel.REQUESTS.length,
    snapshot_count: tel.SNAPSHOTS.length,
    counts,
    body_size_bytes_all_16384: bodySizesOk,
    signatures_verified: sigOk,
  },
  expected: {
    allocation_manifest: expectedManifest,
    public_spki_der_b64: expectedSpki,
    allocation_count: 96,
    grant_count: 576,
    request_count: 576,
    snapshot_count: 30,
    counts: { new: 384, replay: 128, conflict: 32, expired: 32 },
  },
  snapshot_rows: snapshotRows,
  pass: telemetryPass,
  privacy: {
    credentials: "none — fixed synthetic test key only",
    provider_bodies: "none",
    private_paths: "none",
  },
};
writeReceipt("telemetry-computation-receipt.json", telemetryReceipt);

const summary = {
  redaction: redactPass,
  reducer: reducerPass,
  telemetry: telemetryPass,
  m0_pass: redactPass && reducerPass && telemetryPass,
};
console.log(JSON.stringify(summary, null, 2));
if (!summary.m0_pass) {
  console.error("M0 BLOCKED: one or more computations failed to reproduce expected values");
  process.exit(2);
}
console.log("M0 computation receipts written under artifacts/v5/m0/");
