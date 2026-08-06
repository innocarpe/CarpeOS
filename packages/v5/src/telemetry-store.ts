/**
 * Local TELEMETRY_DB facade (in-memory).
 * Applies the same admission semantics as admitTelemetry, persists body-free rows only.
 * SQL migrations live under packages/v5/migrations/telemetry/ for operator deploy.
 */

import {
  admitTelemetry,
  type AdmissionResult,
  type SignedSnapshot,
  type TelemetryRequest,
  type TelemetryRuntime,
  createTelemetryRuntime,
} from "./telemetry.js";

export type TelemetryAdmissionRow = {
  request_id: string;
  allocation_id: string;
  client_id: string;
  fingerprint: string;
  request_kind: string;
  send_ms: number;
  admitted_at_ms: number;
  vector_read_rows: number;
  vector_write_units: number;
  vector_stored_bytes: number;
  vector_rows: number;
  http_status: number;
  d1_statements: number;
};

export type LocalTelemetryStore = {
  runtime: TelemetryRuntime;
  admissions: TelemetryAdmissionRow[];
  snapshots: Array<{
    snapshot_digest: string;
    issued_at: string;
    expires_at: string;
    signature: string;
    verified_at_ms: number;
  }>;
  disabled: boolean;
};

export function createLocalTelemetryStore(public_spki_der_b64: string): LocalTelemetryStore {
  return {
    runtime: createTelemetryRuntime(public_spki_der_b64),
    admissions: [],
    snapshots: [],
    disabled: false,
  };
}

/**
 * Admit a request into the local TELEMETRY_DB projection.
 * On HTTP 200, append a body-free admission row (no request body stored).
 */
export function admitAndStore(
  store: LocalTelemetryStore,
  input: {
    snapshot: SignedSnapshot | null;
    request: TelemetryRequest;
    now_ms: number;
    pre_d1_timeout?: boolean;
    post_first_statement_failure?: boolean;
  },
): AdmissionResult {
  if (store.disabled || store.runtime.telemetry_disabled) {
    return {
      http_status: 503,
      kind: "telemetry_unavailable",
      reason: "post_first_statement_failure",
      vector: { read_rows: 0, write_units: 0, stored_bytes: 0, rows: 0 },
      d1_statements: 0,
      telemetry_disabled: true,
    };
  }

  const admitInput: {
    runtime: typeof store.runtime;
    snapshot: typeof input.snapshot;
    request: typeof input.request;
    now_ms: number;
    pre_d1_timeout?: boolean;
    post_first_statement_failure?: boolean;
  } = {
    runtime: store.runtime,
    snapshot: input.snapshot,
    request: input.request,
    now_ms: input.now_ms,
  };
  if (input.pre_d1_timeout !== undefined) admitInput.pre_d1_timeout = input.pre_d1_timeout;
  if (input.post_first_statement_failure !== undefined) {
    admitInput.post_first_statement_failure = input.post_first_statement_failure;
  }
  const result = admitTelemetry(admitInput);

  if (result.telemetry_disabled) {
    store.disabled = true;
  }

  if (input.snapshot && result.http_status === 200) {
    const dig = input.snapshot.snapshot_digest;
    if (!store.snapshots.some((s) => s.snapshot_digest === dig)) {
      store.snapshots.push({
        snapshot_digest: dig,
        issued_at: input.snapshot.issued_at,
        expires_at: input.snapshot.expires_at,
        signature: input.snapshot.signature,
        verified_at_ms: input.now_ms,
      });
    }
  }

  if (result.http_status === 200) {
    store.admissions.push({
      request_id: input.request.request_id,
      allocation_id: input.request.allocation_id,
      client_id: input.request.client_id,
      fingerprint: input.request.fingerprint,
      request_kind: result.kind,
      send_ms: input.request.send_ms,
      admitted_at_ms: input.now_ms,
      vector_read_rows: result.vector.read_rows,
      vector_write_units: result.vector.write_units,
      vector_stored_bytes: result.vector.stored_bytes,
      vector_rows: result.vector.rows,
      http_status: 200,
      d1_statements: result.d1_statements,
    });
  }

  return result;
}

/** Export body-free snapshot of the local store (for receipts / tests). */
export function exportTelemetryStoreView(store: LocalTelemetryStore): {
  schema: "carpeos.telemetry-store-view/v1";
  disabled: boolean;
  admission_count: number;
  snapshot_count: number;
  total_vector: {
    read_rows: number;
    write_units: number;
    stored_bytes: number;
    rows: number;
  };
  canonical_effect: "none";
} {
  const total = store.admissions.reduce(
    (acc, a) => ({
      read_rows: acc.read_rows + a.vector_read_rows,
      write_units: acc.write_units + a.vector_write_units,
      stored_bytes: acc.stored_bytes + a.vector_stored_bytes,
      rows: acc.rows + a.vector_rows,
    }),
    { read_rows: 0, write_units: 0, stored_bytes: 0, rows: 0 },
  );
  return {
    schema: "carpeos.telemetry-store-view/v1",
    disabled: store.disabled,
    admission_count: store.admissions.length,
    snapshot_count: store.snapshots.length,
    total_vector: total,
    canonical_effect: "none",
  };
}

/** Migration file list for operators (TELEMETRY_DB only). */
export const TELEMETRY_MIGRATIONS = ["migrations/telemetry/001_telemetry_initial.sql"] as const;
