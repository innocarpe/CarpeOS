# MCP Tools Contract (v1)

Status: **G7 inventory** — agent-facing public contract for the local CarpeOS
stdio MCP server.

Machine-readable twin: [`mcp-tools-v1.json`](mcp-tools-v1.json)  
Enforced by: `apps/carpeos-mcp-server/test/tool-inventory.test.ts`  
Operator guide: [MCP Server Guide](../guides/mcp-server.md)

This document freezes **tool names**, **list order**, **schema_version**,
**visibility/budget conventions**, and **safe error codes**. Detailed TypeScript
types live in `packages/schema`; runtime dispatch in
`apps/carpeos-mcp-server/src/tools.ts`.

## Contract rules

| Rule | Detail |
| --- | --- |
| Schema version | All tools use `schema_version: "v1"` on request and success/error envelopes |
| List order | `listTools` order **is** the contract (matches `CARPEOS_MCP_TOOLS`) |
| Visibility | Required on every tool; fail closed if missing/malformed/unauthorized |
| Protected values | `metadata_only` \| `allow_decrypt` \| `deny` only |
| Budget | Where required: `{ max_items, max_characters }` — character length is stable JSON size, not tokens |
| Writes | `memory_capture` / `memory_propose_claim` only; propose never auto-accepts |
| Pre-1.0 breaks | Renames/shape breaks → **MINOR** + CHANGELOG `### Breaking` |
| Post-1.0 breaks | Same → **MAJOR** |

## Tool inventory (8)

Order is intentional and locked.

| # | Tool | Kind | Budget | Purpose |
| --- | --- | --- | --- | --- |
| 1 | `memory_search` | read | required | Search visible memory → budgeted `records[]` |
| 2 | `memory_get` | read | no | One visible record by `record_id` |
| 3 | `memory_context_pack` | read | required | Expert-slot context pack for a `task` |
| 4 | `memory_trace` | read | required | Lineage from a root `record_id` |
| 5 | `memory_timeline` | read | required | Bitemporal timeline |
| 6 | `memory_related` | read | required | Related-record neighborhood |
| 7 | `memory_capture` | write | no | Capture evidence via local outbox |
| 8 | `memory_propose_claim` | write | no | Draft `Claim` only (`lifecycle_status: draft`) |

**Not implemented (must not appear in `listTools`):** `memory_open_loops`.

## Common input fields

### Visibility (all tools)

```json
{
  "visibility": {
    "visible_trust_zone_ids": ["tz_synthetic_example"],
    "protected_value_policy": "metadata_only"
  }
}
```

- `visible_trust_zone_ids` must include the server’s active local trust zone.
- Server also enforces that each id is in the process-configured allowlist
  (`CARPEOS_MCP_VISIBLE_TRUST_ZONES`).

### Context budget (search, context_pack, trace, timeline, related)

```json
{
  "context_budget": {
    "max_items": 8,
    "max_characters": 4000
  }
}
```

Success responses that use a budget include:

```json
{
  "budget": {
    "used": { "items": 0, "characters": 0 },
    "truncated": false,
    "omitted": { "items": 0, "characters": 0 }
  }
}
```

### Optional bitemporal filters

Where noted in JSON inventory: `valid_time`, `recorded_time` (interval objects
per schema).

## Per-tool contracts

### `memory_search`

**Required input:** `schema_version`, `tool`, `visibility`, `query`, `context_budget`  
**Success output:** `schema_version`, `tool: "memory_search"`, `records: McpRecordRef[]`, `budget`  
**Notes:** Results are rechecked against the canonical store; excluded/redacted candidates are not returned as visible records.

### `memory_get`

**Required input:** `schema_version`, `tool`, `visibility`, `record_id`  
**Success output:** `schema_version`, `tool: "memory_get"`, `record: McpRecordRef`  
**Errors:** `not_found` when missing or not visible.

### `memory_context_pack`

**Required input:** `schema_version`, `tool`, `visibility`, `task`, `context_budget`  
**Success output (section order is part of UX contract):**

1. `accepted_facts`
2. `conflicts`
3. `supersessions`
4. `observations`
5. `evidence_summaries`
6. `draft_claims`
7. `rejected_claims`
8. `erasures`
9. `verification_gaps`
10. `redactions`
11. `budget`

**Notes:** Only accepted claims enter `accepted_facts`. Default expert-slot
allocation is 16 sparse slots. See
[Context Pack Smoke](../guides/mcp-context-pack-smoke.md).

### `memory_trace`

**Required input:** `schema_version`, `tool`, `visibility`, `record_id`, `context_budget`  
**Optional:** `max_depth` (default 4)  
**Success output:** `records[]`, `budget`

### `memory_timeline`

**Required input:** `schema_version`, `tool`, `visibility`, `context_budget`  
**Success output:** `records[]`, `budget` (time-ordered)

### `memory_related`

**Required input:** `schema_version`, `tool`, `visibility`, `record_id`, `context_budget`  
**Optional:** `max_depth` (default 2)  
**Success output:** `records[]`, `budget`

### `memory_capture`

**Required input:** `schema_version`, `tool`, `visibility`, `provider`,
`hook_event_name`, `captured_at`, `media_type`, `subject_ref`, `payload`  
**Optional:** `idempotency_key` (`idem_[A-Za-z0-9_-]{16,128}`)  
**Success output:** `status: "captured" | "replay"`, `event_id`, `recorded_time`  
**Errors:** `idempotency_conflict` on key reuse with different content

### `memory_propose_claim`

**Required input:** `schema_version`, `tool`, `visibility`, `statement`, `support`  
**Optional:** `claim_type`, `confidence`, `subject_ref`, `valid_time`, `idempotency_key`  
**Success output:** `status: "proposed" | "replay"`, `event_id`, `claim_id`,
`lifecycle_status: "draft"`, `valid_time`, `recorded_time`,
`valid_time_defaulted`, `acceptance_decision_event_ids: []`  
**Notes:** Support refs must be visible; never grants acceptance.

## Safe error codes

Every tool may return an error envelope with `error: McpSafeError`:

| Code | Meaning |
| --- | --- |
| `invalid_schema` | Input failed validation |
| `unauthorized` | Visibility / zone policy denied |
| `not_found` | Record not found or not visible |
| `idempotency_conflict` | Idempotency key reused with different content |
| `protected_value_denied` | Protected value policy blocked access |
| `budget_exceeded` | Budget constraints (when applicable) |
| `internal_error` | Local operation failed without leaking internals |

Error payloads must not include private plaintext, absolute private paths, or
credentials.

## `McpRecordRef` (read tool record shape)

Canonical ref fields used in budgeted lists:

- `record_id`, `record_kind` (`event` \| `erasure` \| `projection`)
- `trust_zone_id`, `lifecycle_status`, `epistemic_authority`
- optional: `event_type`, `source_event_ids`, `redactions`

## Environment (server process)

Not tool JSON, but part of the MCP install contract:

| Variable | Required |
| --- | --- |
| `CARPEOS_MCP_STORE_PATH` | yes |
| `CARPEOS_MCP_WORKSPACE_ROOT` | yes |
| `CARPEOS_MCP_TRUST_ZONE` | yes |
| `CARPEOS_MCP_VISIBLE_TRUST_ZONES` | yes |
| `CARPEOS_MCP_RUNTIME_DIR` | no |
| `CARPEOS_MCP_PROJECT_ID` | no |

## Changing this contract

1. Update `packages/schema` types + validators.
2. Update `CARPEOS_MCP_TOOLS` and handlers in `tools.ts`.
3. Update **both** `mcp-tools-v1.json` and this markdown file in the **same PR**.
4. Extend/adjust tests (`tool-inventory.test.ts`, schema tests, MCP app tests).
5. Note breaks under CHANGELOG `### Breaking` (MINOR while `0.y.z`).

Do **not** invent alternate tool names in agents, skills, or docs.

## Drift protection

`tool-inventory.test.ts` asserts:

1. JSON `tools[].name` equals `CARPEOS_MCP_TOOLS` (order-sensitive).
2. JSON names equal the TypeScript `McpToolName` union surface used by schema tests.
3. `safe_error_codes` match the documented set.

If the test fails, the inventory and code have diverged — treat as a contract bug.
