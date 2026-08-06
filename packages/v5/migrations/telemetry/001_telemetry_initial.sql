-- TELEMETRY_DB only. Never apply to the canonical event store.
-- Local-first V5 telemetry ledger (SQLite-compatible).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS telemetry_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO telemetry_meta (key, value) VALUES
  ('schema', 'carpeos.telemetry-db/v1'),
  ('migration', '001_telemetry_initial');

-- Admitted request fingerprints (body-free). No request bodies, padding, or paths.
CREATE TABLE IF NOT EXISTS telemetry_admissions (
  request_id TEXT PRIMARY KEY NOT NULL,
  allocation_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('new', 'replay', 'conflict', 'expired')),
  send_ms INTEGER NOT NULL,
  admitted_at_ms INTEGER NOT NULL,
  vector_read_rows INTEGER NOT NULL,
  vector_write_units INTEGER NOT NULL,
  vector_stored_bytes INTEGER NOT NULL,
  vector_rows INTEGER NOT NULL,
  http_status INTEGER NOT NULL,
  d1_statements INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_telemetry_admissions_fingerprint
  ON telemetry_admissions (fingerprint);

CREATE INDEX IF NOT EXISTS idx_telemetry_admissions_client
  ON telemetry_admissions (client_id, send_ms);

-- Snapshot admission journal (digest + signature only; no allocation bodies stored here).
CREATE TABLE IF NOT EXISTS telemetry_snapshots (
  snapshot_digest TEXT PRIMARY KEY NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  signature TEXT NOT NULL,
  verified_at_ms INTEGER NOT NULL
);
