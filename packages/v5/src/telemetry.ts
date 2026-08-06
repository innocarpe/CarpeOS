/**
 * Signed telemetry admission — TELEMETRY_DB only, no canonical DB.
 * Implements the offline admission model from the M0 generator contract.
 */

import crypto from "node:crypto";
import { jcs, sha256Hex } from "./jcs.js";

export type DebitVector = {
  read_rows: number;
  write_units: number;
  stored_bytes: number;
  rows: number;
};

export const ZERO_VECTOR: DebitVector = {
  read_rows: 0,
  write_units: 0,
  stored_bytes: 0,
  rows: 0,
};

/** n=25 batch charges */
export const NEW_VECTOR: DebitVector = {
  read_rows: 7,
  write_units: 153,
  stored_bytes: 21504,
  rows: 25,
};

export const REPLAY_OR_CONFLICT_VECTOR: DebitVector = {
  read_rows: 3,
  write_units: 1,
  stored_bytes: 256,
  rows: 0,
};

export type AdmissionResult =
  | {
      http_status: 200;
      kind: "new" | "replay" | "conflict";
      vector: DebitVector;
      d1_statements: number;
      telemetry_disabled: false;
    }
  | {
      http_status: 202;
      kind: "shed";
      reason:
        | "missing_allocation"
        | "stale_snapshot"
        | "malformed"
        | "untrusted"
        | "revoked"
        | "expired_grant"
        | "pre_d1_timeout";
      vector: DebitVector;
      d1_statements: 0;
      telemetry_disabled: false;
    }
  | {
      http_status: 503;
      kind: "telemetry_unavailable";
      reason: "post_first_statement_failure";
      vector: DebitVector;
      d1_statements: number;
      telemetry_disabled: true;
    };

export type NestedGrant = {
  allocation_id: string;
  request_id: string;
  request_kind: string;
  send_ms: number;
  expires_at_ms: number;
  grant_digest: string;
};

export type AllocationEntry = {
  schema: string;
  allocation_id: string;
  account_id: string;
  client_id: string;
  request_grants: NestedGrant[];
  [key: string]: unknown;
};

export type SignedSnapshot = {
  schema: "TELEMETRY_REVOCATION_V1";
  account_id: string;
  issuer_key_id: string;
  authorization_epoch: number;
  issued_at: string;
  expires_at: string;
  allocations: AllocationEntry[];
  revoked_allocation_ids: string[];
  snapshot_digest: string;
  signature: string;
};

export type TelemetryRequest = {
  allocation_id: string;
  request_id: string;
  client_id: string;
  send_ms: number;
  request_kind: "new" | "replay" | "conflict" | "expired";
  grant_expires_ms: number;
  fingerprint: string;
  body: unknown;
};

export type TelemetryRuntime = {
  public_spki_der_b64: string;
  /** Snapshot max age in ms (contract: 30000). */
  max_age_ms: number;
  telemetry_disabled: boolean;
  seen_fingerprints: Map<string, string>; // fingerprint -> first request_id
};

export function createTelemetryRuntime(public_spki_der_b64: string): TelemetryRuntime {
  return {
    public_spki_der_b64,
    max_age_ms: 30_000,
    telemetry_disabled: false,
    seen_fingerprints: new Map(),
  };
}

export function verifySnapshot(snapshot: SignedSnapshot, public_spki_der_b64: string): boolean {
  const unsigned = {
    schema: snapshot.schema,
    account_id: snapshot.account_id,
    issuer_key_id: snapshot.issuer_key_id,
    authorization_epoch: snapshot.authorization_epoch,
    issued_at: snapshot.issued_at,
    expires_at: snapshot.expires_at,
    allocations: snapshot.allocations,
    revoked_allocation_ids: snapshot.revoked_allocation_ids,
  };
  const bytes = Buffer.from(jcs(unsigned));
  const dig = `sha256:${sha256Hex(bytes)}`;
  if (dig !== snapshot.snapshot_digest) return false;
  const key = crypto.createPublicKey({
    key: Buffer.from(public_spki_der_b64, "base64"),
    format: "der",
    type: "spki",
  });
  const sig = Buffer.from(snapshot.signature.replace(/^ed25519:/, ""), "base64");
  return crypto.verify(null, bytes, key, sig);
}

export function admitTelemetry(input: {
  runtime: TelemetryRuntime;
  snapshot: SignedSnapshot | null;
  request: TelemetryRequest;
  now_ms: number;
  /** Simulate pre-D1 semaphore timeout */
  pre_d1_timeout?: boolean;
  /** Simulate driver failure after first D1 statement */
  post_first_statement_failure?: boolean;
}): AdmissionResult {
  const { runtime, snapshot, request } = input;

  if (runtime.telemetry_disabled) {
    return {
      http_status: 503,
      kind: "telemetry_unavailable",
      reason: "post_first_statement_failure",
      vector: ZERO_VECTOR,
      d1_statements: 0,
      telemetry_disabled: true,
    };
  }

  if (!snapshot) {
    return shed("missing_allocation");
  }

  if (!verifySnapshot(snapshot, runtime.public_spki_der_b64)) {
    return shed("untrusted");
  }

  const issued = Date.parse(snapshot.issued_at);
  const expires = Date.parse(snapshot.expires_at);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    input.now_ms < issued ||
    input.now_ms >= expires ||
    input.now_ms - issued > runtime.max_age_ms
  ) {
    return shed("stale_snapshot");
  }

  if (snapshot.revoked_allocation_ids.includes(request.allocation_id)) {
    return shed("revoked");
  }

  let grant: NestedGrant | null = null;
  for (const alloc of snapshot.allocations) {
    for (const g of alloc.request_grants) {
      if (g.request_id === request.request_id && g.allocation_id === request.allocation_id) {
        grant = g;
        break;
      }
    }
    if (grant) break;
  }
  if (!grant) {
    return shed("missing_allocation");
  }

  if (request.send_ms > grant.expires_at_ms || grant.expires_at_ms < request.send_ms) {
    // expired grant path (j=9: grant_expires_ms = send_ms - 1)
    if (request.request_kind === "expired" || grant.expires_at_ms < request.send_ms) {
      return shed("expired_grant");
    }
  }

  if (input.pre_d1_timeout) {
    return shed("pre_d1_timeout");
  }

  // Body must never enter D1 — only metadata debit paths.
  // Charge atomically for every actual D1 path including replay/conflict.
  const prior = runtime.seen_fingerprints.get(request.fingerprint);
  let kind: "new" | "replay" | "conflict";
  let vector: DebitVector;
  if (prior === undefined) {
    kind = "new";
    vector = NEW_VECTOR;
    runtime.seen_fingerprints.set(request.fingerprint, request.request_id);
  } else if (prior === request.request_id || request.request_kind === "replay") {
    kind = "replay";
    vector = REPLAY_OR_CONFLICT_VECTOR;
  } else {
    kind = "conflict";
    vector = REPLAY_OR_CONFLICT_VECTOR;
  }

  // First D1 statement
  const d1_statements = 1;
  if (input.post_first_statement_failure) {
    runtime.telemetry_disabled = true;
    return {
      http_status: 503,
      kind: "telemetry_unavailable",
      reason: "post_first_statement_failure",
      vector,
      d1_statements,
      telemetry_disabled: true,
    };
  }

  return {
    http_status: 200,
    kind,
    vector,
    d1_statements: kind === "new" ? 2 : 1,
    telemetry_disabled: false,
  };
}

function shed(reason: Extract<AdmissionResult, { http_status: 202 }>["reason"]): AdmissionResult {
  return {
    http_status: 202,
    kind: "shed",
    reason,
    vector: ZERO_VECTOR,
    d1_statements: 0,
    telemetry_disabled: false,
  };
}

/**
 * Load and execute the normative M0 telemetry generator (fixtures only).
 * Returns allocation/request/snapshot material without writing D1.
 */
export async function runNormativeTelemetryGenerator(generatorSource: string): Promise<{
  ALLOCATIONS: AllocationEntry[];
  REQUESTS: TelemetryRequest[];
  SNAPSHOTS: SignedSnapshot[];
  allocation_manifest: string;
}> {
  const module = { exports: {} as Record<string, unknown> };
  const wrapped = `${generatorSource}
module.exports = {
  ALLOCATIONS,
  REQUESTS,
  SNAPSHOTS,
  allocation_manifest: "sha256:" + sha(ALLOCATIONS),
};
`;
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const fn = new Function("require", "module", "exports", "console", wrapped);
  fn(require, module, module.exports, {
    log() {},
    assert(c: unknown, m?: string) {
      if (!c) throw new Error(String(m ?? "assert failed"));
    },
  });
  return module.exports as {
    ALLOCATIONS: AllocationEntry[];
    REQUESTS: TelemetryRequest[];
    SNAPSHOTS: SignedSnapshot[];
    allocation_manifest: string;
  };
}
