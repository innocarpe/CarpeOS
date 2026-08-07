# Agentic quality plane (ultragoal)

Status: **implemented substrate + measurement path** (quality ultragoal v2.1)  
Date: 2026-08-07  
SSOT plan: [../plans/agentic-quality-ultragoal.md](../plans/agentic-quality-ultragoal.md)

## North star

After normal agent sessions, without human review, the next agent’s default
search returns typed, cited decision/constraint/preference meaning — not session
plumbing metadata.

## Substrate contracts (shipped)

| ID | Contract |
| --- | --- |
| QD0 | Prepare pack once; Flash sees only `triage_view_text` / `extract_view_text`; verify binds to extract view |
| Q1.5′ | Default CLI/timer JSON redacts statements, quotes, pack views (`--verbose` opt-in) |
| QD9 / Q7′ | Live mode: no fake proposal pipeline before Flash; transient fail requeues feed |
| Q2.5′ | Admit TOOL_NOISE / SECRETISH are **line-scoped** (mixed sessions admit residual prose) |
| QD5 / Q3′ | Agentic transcript recovery: no `JSON.stringify` envelope body; agentic JSONL mode keeps “we will” |
| Q4′ | CJK-safe tokenize + NFC normalize for statement grounding |
| QD2 / Q5′ | Provenance-primary quality filter (quote ⊆ extract view; metadata restatement belt) |
| Q2′ | Quality corpus under `fixtures/agentic/v1/quality-ultragoal/` with exact expect |
| QD10 / Q8′ | Bulk retract by explicit event ids + dry-run; policy_version `agentic_v1.1` selection marker |

## Fences (unchanged)

- No capture LLM
- Flash-only model id
- No auto `AcceptanceDecision`
- Gate remains authority for promote

## Operator notes

```sh
carpeos agentic flush --limit 10          # redacted JSON by default
carpeos agentic flush --limit 10 --verbose
CARPEOS_AGENTIC_QUALITY_FILTERS=off      # disable post-extract quality filter only
```

## Definition of done pointers

Measurable criteria Q-S1–Q-S14 live in the plan §10. Automated suites:

- `@carpeos/agentic` unit tests (pack views, redaction, admit line-scope, quality corpus, CJK)
- Local `make preflight` before each work-unit PR
