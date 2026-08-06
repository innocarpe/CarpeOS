const crypto = require("crypto");
const SEED = "v5-contract-closure-20260806-synthetic-01",
  BASE = Date.parse("2026-08-06T00:00:00.000Z"),
  N = 32;
const WINDOWS = [
  [0, 240000],
  [240000, 480000],
  [480000, 720000],
];
const jcs = (x) =>
  x === null
    ? "null"
    : typeof x === "boolean"
      ? x
        ? "true"
        : "false"
      : typeof x === "number"
        ? String(x)
        : typeof x === "string"
          ? JSON.stringify(x)
          : Array.isArray(x)
            ? "[" + x.map(jcs).join(",") + "]"
            : "{" +
              Object.keys(x)
                .sort()
                .map((k) => JSON.stringify(k) + ":" + jcs(x[k]))
                .join(",") +
              "}";
const sha = (x) => crypto.createHash("sha256").update(jcs(x)).digest("hex");
const raw = (...p) =>
  crypto
    .createHash("sha256")
    .update([SEED, ...p].join("|"))
    .digest("hex");
const id = (prefix, ...p) => prefix + raw(...p).slice(0, 24),
  iso = (ms) => new Date(BASE + ms).toISOString();
const source_j = (j) => ([0, 6, 8, 16].includes(j) ? 0 : [1, 7, 17].includes(j) ? 1 : j);
const send_ms = (i, j) => 10000 + 250 * i + 30000 * j;
const window_for = (t) => WINDOWS.find(([a, b]) => t >= a && t < b);
const row = (i, sj, k) => ({
  batch_id: id("bat_", "batch", i, sj),
  client_id: id("cli_", "client", i),
  observed_at_ms: send_ms(i, sj),
  row_id: id("row_", "row", i, sj, k),
  row_index: k,
  status: "ok",
  trust_zone_id: "tz_synthetic",
  value_int: i * 1000 + k,
  value_text: "synthetic-" + i + "-" + sj + "-" + k + "A",
});
function body(i, sj) {
  const rows = Array.from({ length: 25 }, (_, k) => row(i, sj, k)).sort((a, b) =>
    a.row_id.localeCompare(b.row_id),
  );
  const out = {
    batch_id: id("bat_", "batch", i, sj),
    client_id: id("cli_", "client", i),
    observed_at_ms: send_ms(i, sj),
    padding: "",
    rows,
    trust_zone_id: "tz_synthetic",
  };
  let q = 16384;
  for (let n = 0; n < 8; n++) {
    out.padding = "A".repeat(Math.max(0, q - Buffer.byteLength(jcs(out))));
    const size = Buffer.byteLength(jcs(out));
    if (size === 16384) return out;
    q -= size - 16384;
  }
  throw Error("padding did not converge");
}
function request(i, j) {
  const send = send_ms(i, j),
    sj = source_j(j),
    b = body(i, sj);
  if (j === 8) {
    const r = b.rows.find((x) => x.row_index === 0);
    r.value_text = r.value_text.slice(0, -1) + "B";
  }
  const [window_start] = window_for(send);
  const expires_at_ms = j === 9 ? send - 1 : send + 30000;
  return {
    allocation_id: id("alloc_", "allocation", window_start, i, j),
    budget_scope_id: id("budget_", "budget", window_start, i),
    request_id: id("req_", "request", i, j),
    client_id: id("cli_", "client", i),
    send_ms: send,
    source_j: sj,
    request_kind:
      j % 10 <= 5 ? "new" : j % 10 <= 7 ? "replay" : j % 10 === 8 ? "conflict" : "expired",
    grant_expires_ms: expires_at_ms,
    idempotency_key: "idempotency_v1|" + id("cli_", "client", i) + "|" + id("bat_", "batch", i, sj),
    fingerprint: "sha256:" + crypto.createHash("sha256").update(jcs(b)).digest("hex"),
    body: b,
  };
}
const RESIDUAL = [
    [312, 1712, 264704, 810],
    [309, 1711, 264448, 810],
    [138, 398, 68096, 330],
  ],
  RESERVE = [
    [264, 792, 135168, 660],
    [264, 792, 135168, 660],
    [132, 396, 67584, 330],
  ],
  vec = (a) => ({ read_rows: a[0], write_units: a[1], stored_bytes: a[2], rows: a[3] });
function allocations() {
  const out = [];
  for (let w = 0; w < 3; w++)
    for (let i = 0; i < N; i++) {
      const [start, end] = WINDOWS[w],
        grants = [];
      for (let j = 0; j < 18; j++) {
        const r = request(i, j);
        if (r.send_ms < start || r.send_ms >= end) continue;
        const g = {
          allocation_id: r.allocation_id,
          request_id: r.request_id,
          request_kind: r.request_kind,
          send_ms: r.send_ms,
          expires_at_ms: r.grant_expires_ms,
        };
        grants.push({ ...g, grant_digest: "sha256:" + sha(g) });
      }
      const e = {
        schema: "telemetry-allocation/v1",
        allocation_id: id("alloc_scope_", "scope", start, i),
        account_id: "acct_synthetic",
        client_id: id("cli_", "client", i),
        trust_zone_id: "tz_synthetic",
        authorization_epoch: 9000,
        window_start_ms: start,
        window_end_ms: end,
        issued_at: iso(start),
        refresh_at_ms: start,
        expires_at: iso(end),
        residual: vec(RESIDUAL[w]),
        sync_reserve: vec(RESERVE[w]),
        headroom: vec([0, 0, 0, 0]),
        batch_cap: 25,
        budget_scope_id: id("budget_", "budget", start, i),
        request_grants: grants,
      };
      out.push({ ...e, allocation_digest: "sha256:" + sha(e) });
    }
  return out;
}
const ALLOCATIONS = allocations(),
  SEED_BYTES = Buffer.from(
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    "hex",
  ),
  PRIVATE = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), SEED_BYTES]),
    format: "der",
    type: "pkcs8",
  });
function snapshots() {
  const out = [];
  for (let t = 0; t < 600000; t += 20000) {
    const u = {
      schema: "TELEMETRY_REVOCATION_V1",
      account_id: "acct_synthetic",
      issuer_key_id: "issuer_fixture_01",
      authorization_epoch: 9000,
      issued_at: iso(t),
      expires_at: iso(t + 30000),
      allocations: ALLOCATIONS,
      revoked_allocation_ids: [],
    };
    const bytes = Buffer.from(jcs(u));
    out.push({
      ...u,
      snapshot_digest: "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex"),
      signature: "ed25519:" + crypto.sign(null, bytes, PRIVATE).toString("base64"),
    });
  }
  return out;
}
const REQUESTS = Array.from({ length: N }, (_, i) =>
    Array.from({ length: 18 }, (_, j) => request(i, j)),
  ).flat(),
  SNAPSHOTS = snapshots();
const byteDiff = (a, b) => {
  const x = Buffer.from(a.body.rows.find((r) => r.row_index === 0).value_text),
    y = Buffer.from(b.body.rows.find((r) => r.row_index === 0).value_text);
  return x.reduce((n, v, i) => n + (v !== y[i]), 0);
};
console.assert(
  ALLOCATIONS.length === 96 &&
    ALLOCATIONS.reduce((n, x) => n + x.request_grants.length, 0) === 576 &&
    REQUESTS.length === 576 &&
    SNAPSHOTS.length === 30,
);
console.assert(
  REQUESTS.filter((x) => x.request_kind === "new").length === 384 &&
    REQUESTS.filter((x) => x.request_kind === "replay").length === 128 &&
    REQUESTS.filter((x) => x.request_kind === "conflict").length === 32 &&
    REQUESTS.filter((x) => x.request_kind === "expired").length === 32,
);
console.assert(
  request(0, 0).fingerprint === request(0, 6).fingerprint &&
    request(0, 1).fingerprint === request(0, 7).fingerprint &&
    request(0, 0).fingerprint === request(0, 16).fingerprint &&
    request(0, 1).fingerprint === request(0, 17).fingerprint &&
    byteDiff(request(0, 0), request(0, 8)) === 1 &&
    request(0, 9).grant_expires_ms < request(0, 9).send_ms,
);
console.log({
  allocation_manifest: "sha256:" + sha(ALLOCATIONS),
  first: SNAPSHOTS[0].snapshot_digest,
  last: SNAPSHOTS.at(-1).snapshot_digest,
});
