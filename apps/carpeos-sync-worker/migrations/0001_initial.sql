CREATE TABLE IF NOT EXISTS client_authorizations (
  client_id TEXT NOT NULL,
  trust_zone_id TEXT NOT NULL,
  token_hash_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  PRIMARY KEY (client_id, trust_zone_id, token_hash_sha256)
);

CREATE INDEX IF NOT EXISTS idx_client_authorizations_lookup
  ON client_authorizations(client_id, trust_zone_id, revoked_at);

CREATE TABLE IF NOT EXISTS sync_requests (
  trust_zone_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  accepted_event_ids_json TEXT NOT NULL DEFAULT '[]',
  accepted_erasure_ids_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  PRIMARY KEY (trust_zone_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS zone_counters (
  trust_zone_id TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 1),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS canonical_events (
  trust_zone_id TEXT NOT NULL,
  zone_sequence INTEGER NOT NULL CHECK (zone_sequence >= 1),
  event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  recorded_time_start TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (trust_zone_id, event_id),
  UNIQUE (trust_zone_id, zone_sequence),
  FOREIGN KEY (trust_zone_id, idempotency_key)
    REFERENCES sync_requests(trust_zone_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_canonical_events_pull
  ON canonical_events(trust_zone_id, zone_sequence, event_id);

CREATE TABLE IF NOT EXISTS erasure_ledger (
  trust_zone_id TEXT NOT NULL,
  zone_sequence INTEGER NOT NULL CHECK (zone_sequence >= 1),
  erasure_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  erasure_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (trust_zone_id, erasure_id),
  UNIQUE (trust_zone_id, zone_sequence),
  FOREIGN KEY (trust_zone_id, idempotency_key)
    REFERENCES sync_requests(trust_zone_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_erasure_ledger_pull
  ON erasure_ledger(trust_zone_id, zone_sequence, erasure_id);

CREATE TABLE IF NOT EXISTS protected_value_uploads (
  protected_value_id TEXT PRIMARY KEY,
  trust_zone_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_ciphertext_digest_algorithm TEXT NOT NULL,
  original_ciphertext_digest_value TEXT NOT NULL,
  original_ciphertext_size_bytes INTEGER NOT NULL CHECK (original_ciphertext_size_bytes >= 1),
  encryption_algorithm TEXT NOT NULL,
  encoding TEXT NOT NULL,
  ciphertext_nonce TEXT NOT NULL,
  ciphertext_auth_tag TEXT NOT NULL,
  nonce_ref TEXT,
  tag_ref TEXT,
  vault_ref TEXT NOT NULL,
  key_ref TEXT NOT NULL,
  wrapped_device_key_json TEXT NOT NULL,
  upload_receipt_id TEXT NOT NULL UNIQUE,
  uploaded_at TEXT NOT NULL,
  linked_at TEXT,
  status TEXT NOT NULL DEFAULT 'orphaned' CHECK (status IN ('orphaned', 'linked'))
);

CREATE INDEX IF NOT EXISTS idx_protected_value_uploads_trust_zone
  ON protected_value_uploads(trust_zone_id, status);

CREATE TABLE IF NOT EXISTS protected_value_links (
  protected_value_id TEXT NOT NULL,
  trust_zone_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (protected_value_id, event_id),
  FOREIGN KEY (protected_value_id) REFERENCES protected_value_uploads(protected_value_id)
);
