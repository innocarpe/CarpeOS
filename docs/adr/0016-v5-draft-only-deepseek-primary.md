# ADR 0016: V5 is opt-in draft-only with DeepSeek Direct as primary LLM path

Status: **Accepted for implementation on main (draft-lane complete; npm major tag not implied)**

Date: 2026-08-06

## Context

CarpeOS 5.0 adds optional LLM-assisted extraction. The frozen V5 plan requires:

- single-user / local-first;
- every V5 record `canonical_effect: "none"`;
- no LLM output becoming CanonicalEvent, KnowledgeCandidate, outbox, sequence, or retrieval authority;
- no LLM/network inside capture transactions;
- schema-v1 and adj_v3 unchanged;
- PRD-v4 independently releasable;
- provider boundary with fakes first, then gated real calls.

The original sketch was OpenRouter-first. Operator intent for completion is **DeepSeek Direct as the primary real route**; OpenRouter is optional and not required for 5.0.0 draft-lane completion.

## Decision

1. **V5 is a draft-only, opt-in lane** implemented in `@carpeos/v5`, not a change to the canonical event store or capture hot path.
2. **Provider adapters are provider-neutral:** `fake` | `deepseek_direct` | `openrouter`.
3. **Product primary extract route:** DeepSeek Direct, model id `deepseek-v4-flash`, base URL `https://api.deepseek.com`, auth via `DEEPSEEK_API_KEY` from the process environment only (operator private file under `~/.carpeos/`, never repo fixtures).
4. **Network is off by default.** Real calls require explicit consent + kill-switch configuration + (for the live cost CLI) `--allow-network`.
5. **No implicit provider fallback.** DeepSeek failure does not silently route to OpenRouter. OpenRouter `allow_fallbacks: false` when used.
6. **TELEMETRY_DB is separate** from the canonical store. Local in-process store + SQL migration under `packages/v5/migrations/telemetry/`; Cloudflare Worker deploy remains operator-optional.
7. **M8** may reference at most one body-free accepted 4.0 evidence seam; if none exists, status is `deferred` (not invented green). Draft-lane readiness may still pass.
8. **V5-off** remains a valid release path: disable opt-in, kill providers, continue capture/canonical/retrieval without draft authority.

## Consequences

- Capture, adjudication, retrieval, and OKF paths keep working with V5 disabled.
- Operators measure DeepSeek cost via the offline cost experiment runner without wiring LLM into hooks.
- OpenRouter and Luna escalation remain available as optional profiles for later experiments.
- Publishing `@innocarpe/carpeos@5.0.0` remains a separate versioning/release decision after maintainer authorization.

## Alternatives considered

- **OpenRouter-only primary:** rejected for this completion path; Direct billing/policy is the operator baseline.
- **Wire LLM into capture-hook:** rejected; violates no-network-in-capture and fail-open capture requirements.
- **Invent M8 4.0 acceptance:** rejected; fail closed / defer.

## Related

- `docs/PRD-v5.md`
- `docs/maintainers/v5-milestones.md`
- `docs/maintainers/v5-cost-experiment.md`
- `@carpeos/v5` (`pipeline`, `provider`, `telemetry-store`)
