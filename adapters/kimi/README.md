# Kimi / frontier MCP consumer adapter

CarpeOS is the private knowledge plane. Kimi K3-class (or other frontier) agents
are **consumers** of that plane through the local MCP server — not the memory
backend itself.

This directory documents how to point a frontier coding agent at local CarpeOS
MCP tools without coupling the canonical store to one model vendor.

## What CarpeOS provides

| MCP tool | Typical use for a frontier agent |
| --- | --- |
| `memory_context_pack` | Bounded active working memory (expert-slot pack) |
| `memory_search` / `memory_get` | Candidate recall + drill-down |
| `memory_capture` | Store evidence / procedure traces |
| `memory_propose_claim` | Draft claims only (never auto-accept) |

## Preserved thinking note

Some models (including Kimi K3) were trained to require **preserved thinking
history** on multi-turn tool use. CarpeOS can store procedure traces as
protected `EvidenceArtifact` records (`kind: procedure_trace`), but:

1. Host harnesses must still replay host-native `reasoning_content` when the
   model API requires it.
2. Procedure traces are **not** accepted facts.
3. Do not switch models mid-session without capturing and restoring procedure
   state.

## Local MCP wiring (synthetic example)

Use the public-safe stdio MCP server from this monorepo after `pnpm build`:

```json
{
  "mcpServers": {
    "carpeos": {
      "command": "node",
      "args": [
        "/absolute/path/to/carpeos/apps/carpeos-mcp-server/dist/index.js"
      ],
      "env": {
        "CARPEOS_HOME": "/absolute/path/to/private-carpeos-home",
        "CARPEOS_VISIBLE_TRUST_ZONES": "tz_local_default"
      }
    }
  }
}
```

Replace paths with your private runtime paths. Never commit real home paths,
credentials, or session transcripts into this repository.

See also:

- `docs/guides/mcp-server.md`
- `docs/architecture/memory-capacity.md`
- `docs/plans/k3-memory-capacity-master-plan.md`

## Kimi Code CLI

If using Kimi Code as the agent harness:

1. Select the model (for example Kimi K3) with the harness `/model` command.
2. Register CarpeOS as a local MCP server using the harness's MCP config file
   (shape varies by version — prefer the harness docs over hard-coding).
3. Prefer `memory_context_pack` at task start, then `memory_capture` on
   session/turn end for procedure continuity.

## Non-goals

- Hosting 2.8T open weights inside CarpeOS.
- Fine-tuning personal knowledge into model parameters as the primary memory path.
- Treating vector hits or pack membership as acceptance.
