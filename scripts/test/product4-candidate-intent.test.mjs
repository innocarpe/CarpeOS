import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCandidateIntent,
  assertCandidateIntentWriteOnce,
  buildCandidateIntent,
  CANDIDATE_INTENT_KEYS,
  classifyCandidateIntent,
  computeClassificationDigest,
} from "../product4/candidate-intent.mjs";
import {
  MAINTENANCE_STUDY_FIXTURE_SHA256,
  PRODUCT4_CONTEXT,
  PRODUCT4_POLICY_SHA256,
  PRODUCT4_REPOSITORY_ID,
} from "../product4/policy-identity.mjs";

const baseInput = {
  repository_id: PRODUCT4_REPOSITORY_ID,
  head_sha: "a".repeat(40),
  tree_sha256: "b".repeat(64),
  fixture_sha256: MAINTENANCE_STUDY_FIXTURE_SHA256,
  intent_policy_sha256: PRODUCT4_POLICY_SHA256,
  context: PRODUCT4_CONTEXT,
  issuer_workflow_sha: "c".repeat(40),
};

function build(classification, overrides = {}) {
  return buildCandidateIntent({
    ...baseInput,
    classification,
    ...overrides,
  });
}

test("classifies immutable true intent as pending evidence", () => {
  const envelope = build({ intent: true, source: "base-synthetic" });
  assert.equal(envelope.intent, true);
  assert.equal(envelope.state, "pending_evidence");
  assert.deepEqual(Object.keys(envelope), CANDIDATE_INTENT_KEYS);
  assertCandidateIntent(envelope);
});

test("classifies immutable false intent as exactly not applicable", () => {
  const envelope = build({ candidate: false, source: "base-synthetic" });
  assert.deepEqual(
    classifyCandidateIntent({ ...baseInput, classification: { candidate: false } }),
    {
      intent: false,
      state: "not_applicable",
    },
  );
  assert.equal(envelope.intent, false);
  assert.equal(envelope.state, "not_applicable");
  assertCandidateIntent(envelope);
});

test("keeps missing and ambiguous immutable classifications pending", () => {
  const missing = build(undefined);
  const ambiguous = build({ intent: true, candidate: false });
  assert.equal(missing.state, "classification_pending");
  assert.equal(missing.intent, false);
  assert.equal(ambiguous.state, "classification_pending");
  assert.equal(ambiguous.intent, false);
  assertCandidateIntent(missing);
  assertCandidateIntent(ambiguous);
});

test("mutable pull-request metadata is ignored and cannot change intent", () => {
  const first = build(
    { intent: true },
    {
      mutableMetadata: {
        title: "synthetic candidate",
        labels: ["candidate"],
        comments: ["reported success"],
        candidate_reported_status: "green",
      },
    },
  );
  const second = build(
    { intent: true },
    {
      mutableMetadata: {
        title: "rewritten non-candidate",
        labels: ["not-a-candidate"],
        comments: ["reported failure"],
        candidate_reported_status: "red",
      },
    },
  );
  assert.deepEqual(second, first);
  assert.equal(second.state, "pending_evidence");
});

test("refuses inactive policy identities before classification", () => {
  assert.throws(
    () => build({ intent: true }, { intent_policy_sha256: "d".repeat(64) }),
    (error) => error.code === "policy_not_active" && /policy_not_active/.test(error.message),
  );
  const envelope = build({ intent: true });
  envelope.intent_policy_sha256 = "d".repeat(64);
  assert.throws(
    () => assertCandidateIntent(envelope),
    (error) => error.code === "policy_not_active",
  );
});

test("rejects malformed identities and mutable classification fields", () => {
  assert.throws(() => build({ intent: true }, { head_sha: "A".repeat(40) }), /invalid_identity/);
  assert.throws(() => build({ intent: true }, { tree_sha256: "not-a-tree" }), /invalid_identity/);
  assert.throws(
    () => build({ intent: true }, { issuer_workflow_sha: "short" }),
    /invalid_identity/,
  );
  assert.throws(() => build({ intent: true, title: "mutable" }), /mutable_metadata/);

  const envelope = build({ intent: true });
  envelope.extra = false;
  assert.throws(() => assertCandidateIntent(envelope), /exact contract/);
});

test("binds digest to unsigned identity and enforces write-once behavior", () => {
  const original = build({ intent: true });
  assert.equal(computeClassificationDigest(original), original.classification_digest);
  assert.equal(assertCandidateIntentWriteOnce(original, structuredClone(original)), original);

  const changedHead = build({ intent: true }, { head_sha: "e".repeat(40) });
  const changedTree = build({ intent: true }, { tree_sha256: "f".repeat(64) });
  assert.notEqual(changedHead.classification_digest, original.classification_digest);
  assert.notEqual(changedTree.classification_digest, original.classification_digest);
  assert.throws(
    () => assertCandidateIntentWriteOnce(original, changedHead),
    (error) => error.code === "identity_changed",
  );
  assert.throws(
    () => assertCandidateIntentWriteOnce(original, changedTree),
    (error) => error.code === "identity_changed",
  );

  const tampered = structuredClone(original);
  tampered.head_sha = "e".repeat(40);
  assert.throws(
    () => assertCandidateIntent(tampered),
    (error) => error.code === "identity_changed",
  );
});
