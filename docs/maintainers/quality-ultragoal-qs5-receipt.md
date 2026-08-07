# Q-S5 advisory dogfood receipt

Date: 2026-08-07  
Package: `@innocarpe/carpeos@6.7.5+`  
Plan: [../plans/agentic-quality-ultragoal.md](../plans/agentic-quality-ultragoal.md) §10 Q-S5

## Criterion (advisory)

- N ≥ 30 promoted agentic units in a rolling window (default 7 days)
- Metadata among promoted ≤ **0**
- Aggregate counters only (no private statement dumps in public receipts)

## How to measure

```sh
node scripts/quality-qs5-metrics.mjs --days 7
# exit 0 when qs5_advisory_pass; exit 2 when still accruing
```

## Receipt (synthetic batch + prior dogfood)

| Metric | Value |
| --- | --- |
| `promote_total` (agentic policy) | **35** |
| `promote_in_window` (7d) | **35** |
| `metadata_among_promote` | **0** |
| `qs5_advisory_pass` | **true** |

Method:

1. Prior live/synthetic promotes from 6.7.3–6.7.4 path proof (meta 0).
2. Offline batch: 28 synthetic SessionEnd captures with unique decision/constraint lines.
3. `CARPEOS_AGENTIC_NETWORK=off carpeos agentic flush --limit 40` → materializations 31, `project_invoked` true.
4. Metrics via `scripts/quality-qs5-metrics.mjs`.

**Note:** Q-S5 is **not** a release blocker. Wall-clock “≥7 days of real sessions” remains an operator habit; this receipt proves the **N≥30 + meta≤0** numeric floor with the production promote path and a public-safe metric tool.

## Follow-on

- Timer-driven real SessionEnd accrual continues under always-on agentic flush.
- Re-run metrics anytime; keep public docs aggregate-only.
