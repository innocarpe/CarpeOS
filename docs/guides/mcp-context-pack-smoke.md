# MCP Context Pack Smoke Guide

Status: local developer smoke only. Synthetic placeholders. Not a hosted
service and not a token-exact evaluation harness.

This guide shows how to verify `memory_context_pack` behavior after a workspace
build: expert-slot allocation, section order, budgets, and acceptance lineage.
Use only synthetic project names and temporary directories.

## What “context pack” means

`memory_context_pack` is **active capacity** (ADR 0009 L2): a deterministic,
bounded projection for an agent task. It is not the full private store.

| Property | Behavior |
| --- | --- |
| Source of truth | Still the append-only canonical event stream |
| Acceptance | Only claims with visible `AcceptanceDecision: accepted` enter `accepted_facts` |
| Budget | `max_items` + `max_characters` (character count is stable JSON length, not tokens) |
| Expert slots | Default 16 sparse slots across pack sections |
| Order | Cache-friendly: accepted facts and conflicts before high-churn draft/erasure |
| Procedure traces | Compete for procedure slots; folded into `evidence_summaries` |
| Authority | Pack membership never grants acceptance |

Implementation: `apps/carpeos-mcp-server/src/expert-slots.ts` and
`memory_context_pack` in `apps/carpeos-mcp-server/src/tools.ts`.

## Prerequisites

```sh
pnpm install
pnpm build
```

Node.js ≥ 22.22 and pnpm ≥ 11.16, same as the root README.

## Automated smoke (recommended) — G5 gate

Named maintainers/CI gate (tool list + search + context-pack):

```sh
pnpm build          # once, if dist is cold
pnpm smoke:mcp      # scripts/smoke-mcp.mjs
```

What it runs:

1. **Unit / app** — MCP stdio tool list, `memory_context_pack` classification,
   expert slots, CLI retrieval+context-pack vitests
2. **CLI process** — temp synthetic home: `init` → `capture-hook` →
   `retrieval rebuild` → `memory search` → `memory context-pack`

Flags: `--cli-only`, `--unit-only`, `--help`.

CI runs `pnpm smoke:mcp` as **“Run MCP smoke (G5)”** after `pnpm check`
(see `.github/workflows/ci.yml`).

### Manual / focused commands

```sh
# CLI context-pack only (requires local store + trust zone from init)
node apps/carpeos-cli/dist/index.js memory context-pack \
  --task "Summarize synthetic Alpha work" \
  --trust-zone tz_synthetic_example \
  --visible-trust-zone tz_synthetic_example \
  --max-items 16 \
  --max-characters 8000

# individual packages (also covered by smoke:mcp)
pnpm --filter @carpeos/mcp-server exec vitest run test/expert-slots.test.ts
pnpm --filter @carpeos/mcp-server exec vitest run test/mcp-app.test.ts
pnpm --filter @carpeos/cli exec vitest run test/retrieval-cli.test.ts
pnpm --filter @carpeos/mcp-server exec vitest run test/stdio.test.ts
```

Expected: `smoke-mcp: PASS`; CLI JSON includes `command: "memory context-pack"`
and a `pack` object. Classification asserts that accepted, draft, rejected,
conflict, supersession, erasure, and redaction sections stay separate, and that
non-accepted claims never appear in `accepted_facts`.

## Adjacent CLI smoke (store + retrieval)

These CLI steps prove local capture and hybrid retrieval still work for the same
synthetic store shape agents later read through MCP. They do not call
`memory_context_pack` directly.

Use a temporary directory outside the git tree for real private runs. The
commands below use a synthetic name under `/tmp` for illustration only — do not
commit that directory.

```sh
# pick a private temp path on your machine
export CARPEOS_SMOKE_HOME="/tmp/carpeos-context-pack-smoke-synthetic"
mkdir -p "$CARPEOS_SMOKE_HOME"
cd /path/to/carpeos   # repository root after clone

# if your CLI expects a home/runtime via flags or env, follow local-capture.md.
# Minimal synthetic capture using the built CLI entrypoint:
node apps/carpeos-cli/dist/index.js init
node apps/carpeos-cli/dist/index.js project identify

node apps/carpeos-cli/dist/index.js capture-hook --provider codex --input argv \
  '{"hook_event_name":"SessionEnd","session_id":"session_synthetic_pack","timestamp":"2026-01-01T00:00:00Z","message":"synthetic context pack smoke"}'

node apps/carpeos-cli/dist/index.js outbox status

# retrieval projection (dev embeddings are synthetic quality only)
# Use the trust zone printed by init / your local runtime (example id only):
node apps/carpeos-cli/dist/index.js retrieval rebuild \
  --trust-zone tz_synthetic_example
```

If trust-zone flags differ in your checkout, use the exact flags from
[Local Capture Guide](local-capture.md) and [Retrieval Guide](retrieval.md).
Prefer the trust-zone id from your local `init` output rather than inventing
production zone names in public docs.

A typical retrieval smoke after rebuild:

```sh
node apps/carpeos-cli/dist/index.js memory search \
  --query "synthetic" \
  --trust-zone tz_synthetic_example \
  --visible-trust-zone tz_synthetic_example \
  --limit 8
```

Replace `tz_synthetic_example` with the active local trust zone from your
runtime if different. Search results are candidate retrieval — still not
accepted facts by themselves.

## Expected `memory_context_pack` shape

Successful structured content includes (key order is intentional for host prefix
caching):

```json
{
  "schema_version": "v1",
  "tool": "memory_context_pack",
  "accepted_facts": [],
  "conflicts": [],
  "supersessions": [],
  "observations": [],
  "evidence_summaries": [],
  "draft_claims": [],
  "rejected_claims": [],
  "erasures": [],
  "verification_gaps": [],
  "redactions": [],
  "budget": {
    "used": { "items": 0, "characters": 0 },
    "truncated": false,
    "omitted": { "items": 0, "characters": 0 }
  }
}
```

Default expert-slot policy (soft structure inside the hard budget):

| Section | Default slots |
| --- | --- |
| `accepted_facts` | 6 |
| `conflicts` | 2 |
| `supersessions` | 1 |
| procedure traces (into `evidence_summaries`) | 3 |
| `observations` | 2 |
| general `evidence_summaries` | 2 |
| draft / rejected / erasure | leftover budget only |

Hard limits still win: if `max_items` or `max_characters` is hit, responses set
`budget.truncated` and report `omitted`.

## Failure cases worth checking

| Case | Expected |
| --- | --- |
| Missing visibility | Fail closed (`unauthorized` / invalid input) |
| Trust zone outside allowlist | Fail closed |
| Draft claim without acceptance | Appears under `draft_claims`, never `accepted_facts` |
| Conflicting accept+reject | Surfaces under `conflicts` (not as a single accepted fact) |
| Protected-value deny policy | Redactions metadata; no raw payload leak |
| Over-budget pack | `truncated: true` with omitted counts |

These are covered by `test/mcp-app.test.ts` and `test/expert-slots.test.ts`.

## MCP server process smoke

Start the local stdio server only with explicit env (see
[MCP Server Guide](mcp-server.md)):

```sh
export CARPEOS_MCP_STORE_PATH=./.carpeos-example/carpeos.sqlite
export CARPEOS_MCP_RUNTIME_DIR=./.carpeos-example
export CARPEOS_MCP_WORKSPACE_ROOT=.
export CARPEOS_MCP_TRUST_ZONE=tz_synthetic_example
export CARPEOS_MCP_VISIBLE_TRUST_ZONES=tz_synthetic_example

node apps/carpeos-mcp-server/dist/index.js
```

The process speaks MCP JSON-RPC on stdio. Interactive client registration is
documented in the MCP server guide for Codex / Claude Code / Grok / Kimi-style
consumers. Do not commit real store paths or credentials.

## Related

- [MCP Server Guide](mcp-server.md)
- [Retrieval Guide](retrieval.md)
- [Memory capacity architecture](../architecture/memory-capacity.md)
- [ADR 0009 Memory capacity model](../adr/0009-memory-capacity-model.md)
- [Kimi / frontier consumer adapter](../../adapters/kimi/README.md)
