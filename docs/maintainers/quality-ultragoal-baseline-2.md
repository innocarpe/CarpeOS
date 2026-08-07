# Quality ultragoal baseline #2 receipt

Date: 2026-08-07  
Package plane: `@innocarpe/carpeos@6.7.4` (+ this DoD closeout)  
Manifest: `fixtures/agentic/v1/quality-ultragoal/manifest.json`  
Baseline id: `quality-baseline-2`

## Delta vs baseline #1

| Area | Baseline #1 | Baseline #2 |
| --- | --- | --- |
| Case count | 11 | ≥40 |
| Per-kind decision/constraint/preference | sparse | ≥10 each |
| Recorded-Flash inject | none | triage drop override + paraphrase clamp cases |
| Report metrics | pass/fail counters | + `per_kind_recall`, `signal_source_counts` |
| Extract cite belt | triage v2 only | clamp statement to quote; pack-meta skip |
| Gate | majority promote ≥50% | full exact-expect green + recall ≥80% |

## How to re-run

```sh
pnpm --filter './packages/agentic' exec vitest run test/quality-corpus.test.ts test/flash-budget.test.ts
```

Expect: all tests pass; corpus `report.pass === true`; `must_not_promote_leaks === 0`.

## Advisory (not blocking)

- Q-S5 live dogfood accrual (N≥30 promotes over ≥7 days, metadata among promoted ≤0)
- Privacy scrub residual broaden (`/opt`, hostnames, emails) — known residual from QD0
