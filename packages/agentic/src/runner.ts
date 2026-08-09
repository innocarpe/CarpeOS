/**
 * Product 6 agentic runner: drain capture feed → E1–E8 pipeline → optional materialize/project.
 * Capture never awaits this. Durable feed + job digests for idempotency.
 */

import type { LocalCaptureStore } from "@carpeos/local-store";
import { ruleAdmitEvidence } from "./admit.js";
import { callAgenticFlash, createFlashSpendState, type FlashSpendState } from "./flash.js";
import { completeAgenticJob, enqueueAgenticJob, failAgenticJob, leaseAgenticJobs } from "./jobs.js";
import { materializeAgenticProposal } from "./materialize.js";
import { makeAgenticPackId, packAgenticEvidence } from "./pack.js";
import { type AgenticPipelineResult, runAgenticProposalPipeline } from "./pipeline.js";
import { type AgenticProposalRecord, listAgenticProposals } from "./proposals.js";
import {
  addDaySpend,
  AGENTIC_DAY_MAX_CALLS,
  AGENTIC_DAY_SPEND_CAP_USD,
  AGENTIC_RUN_MAX_CALLS,
  daySpendExceeded,
  loadDaySpend,
} from "./spend.js";
import type { SqlDatabase } from "./sql.js";
import { runTriageStage } from "./stages.js";
import { AGENTIC_POLICY_VERSION } from "./types.js";

export type AgenticRunnerReport = {
  schema: "carpeos.agentic.runner-report/v1";
  ok: boolean;
  agentic_enabled: boolean;
  feed_seen: number;
  feed_done: number;
  feed_skipped: number;
  /**
   * DF3: admit-stage drops from deterministic front (subset of feed_skipped when
   * admit_decision=drop). Counts only this processAgenticOnce run.
   */
  front_drop: number;
  /** Reason-code histogram for front drops (no private statement text). */
  front_drop_by_reason: Record<string, number>;
  pipelines: AgenticPipelineResult[];
  materializations: number;
  /** P5 draft Claim materializations (never AcceptanceDecision). */
  draft_claims: number;
  /** P4 structure edge proposals across pipelines. */
  structure_edge_count: number;
  /** P4 E9 projection hook fired. */
  project_invoked: boolean;
  network_used: boolean;
  flash_calls: number;
  reason_codes: string[];
};

export type AgenticRunnerInput = {
  store: LocalCaptureStore;
  agenticDb: SqlDatabase;
  /** Default false. Live deepseek-v4-flash when true + DEEPSEEK_API_KEY. */
  allow_network?: boolean;
  agentic_enabled?: boolean;
  /** Materialize hold/promote Observations via local-store writers. */
  materialize?: boolean;
  /** Product default: promote-when-verified (true). */
  allow_auto_promote?: boolean;
  hold_first?: boolean;
  /**
   * Prefer SessionEnd/Stop/PreCompact when claiming feed rows (default true).
   * Legacy queues full of PostToolUse drain faster for meaning-bearing hooks.
   */
  prefer_lifecycle?: boolean;
  limit?: number;
  now?: Date;
  spend?: FlashSpendState;
  /** Optional projection rebuild after materialize (E9). */
  on_project?: (input: {
    trust_zone_id: string;
    observation_event_ids: string[];
  }) => void | Promise<void>;
  fetch_impl?: typeof fetch;
};

/**
 * Drain pending capture feed and run agentic stages once (bounded).
 */
export async function processAgenticOnce(input: AgenticRunnerInput): Promise<AgenticRunnerReport> {
  const agentic_enabled = input.agentic_enabled !== false;
  const report: AgenticRunnerReport = {
    schema: "carpeos.agentic.runner-report/v1",
    ok: true,
    agentic_enabled,
    feed_seen: 0,
    feed_done: 0,
    feed_skipped: 0,
    front_drop: 0,
    front_drop_by_reason: {},
    pipelines: [],
    materializations: 0,
    draft_claims: 0,
    structure_edge_count: 0,
    project_invoked: false,
    network_used: false,
    flash_calls: 0,
    reason_codes: [],
  };

  if (!agentic_enabled) {
    report.reason_codes.push("agentic_off");
    return report;
  }

  const limit = input.limit ?? 20;
  /**
   * Empty Stop/PreCompact rows would burn the entire --limit before SessionEnd
   * prose is reached. Scan up to 5× limit (capped at 100) while only counting
   * non-empty_signal rows toward the operator limit.
   */
  const maxScan = Math.min(Math.max(limit * 5, limit), 100);
  // Seed in-process spend from durable day caps so always-on timers share a budget.
  // Day caps are higher than a single-run budget so 30m batches + flush dogfood work.
  const dayCaps = {
    spend_cap_usd: input.spend?.spend_cap_usd ?? AGENTIC_DAY_SPEND_CAP_USD,
    max_calls: AGENTIC_DAY_MAX_CALLS,
  };
  const dayRow = loadDaySpend(input.agenticDb);
  if (daySpendExceeded(input.agenticDb, dayCaps, input.now)) {
    report.reason_codes.push("day_spend_cap_exceeded");
  }
  // Per-run Flash budget starts at 0. Day totals only gate network on/off via daySpendExceeded;
  // they are persisted as deltas at the end (multi-process share without starving each run).
  const spend =
    input.spend ??
    createFlashSpendState({
      spend_cap_usd: dayCaps.spend_cap_usd,
      max_calls: AGENTIC_RUN_MAX_CALLS,
    });
  if (spend.max_calls < AGENTIC_RUN_MAX_CALLS) {
    spend.max_calls = AGENTIC_RUN_MAX_CALLS;
  }
  const spendAtStart = { spend_usd: spend.spend_usd, calls: spend.calls };
  void dayRow;
  let allow_network = input.allow_network === true;
  if (allow_network && daySpendExceeded(input.agenticDb, dayCaps, input.now)) {
    allow_network = false;
    report.reason_codes.push("network_disabled_day_spend");
  }
  const observationIds: string[] = [];
  const trust_zone_id = input.store.trustZone.trust_zone_id;

  let usefulRemaining = limit;
  let scanBudget = maxScan;
  let claimedAny = false;
  const seenSourceIds = new Set<string>();
  while (usefulRemaining > 0 && scanBudget > 0) {
    const batch = Math.min(usefulRemaining, scanBudget, 8);
    const feed = input.store.claimAgenticCaptureFeed({
      limit: batch,
      leaseMs: 120_000,
      prefer_lifecycle: input.prefer_lifecycle !== false,
      ...(input.now !== undefined ? { now: input.now } : {}),
    });
    if (feed.length === 0) {
      if (!claimedAny) {
        report.reason_codes.push("feed_empty");
      }
      break;
    }
    claimedAny = true;

    for (const row of feed) {
      if (scanBudget <= 0) break;
      if (seenSourceIds.has(row.source_event_id)) continue;
      seenSourceIds.add(row.source_event_id);
      scanBudget -= 1;
      report.feed_seen += 1;
      const signal_text = input.store.readCaptureSignalText(row.source_event_id);
      const model_id = allow_network ? ("deepseek-v4-flash" as const) : ("fake" as const);

      const nowOpt = input.now !== undefined ? { now: input.now } : {};
      const admitJob = enqueueAgenticJob(input.agenticDb, {
        trust_zone_id: row.trust_zone_id,
        source_event_id: row.source_event_id,
        stage: "admit",
        model_id,
        ...nowOpt,
      });
      const leased = leaseAgenticJobs(input.agenticDb, {
        limit: 8,
        leaseMs: 120_000,
        trust_zone_id: row.trust_zone_id,
        ...nowOpt,
      });
      const lease = leased.find((l) => l.job.job_id === admitJob.job_id);

      // QD0 / H6: never invent an "(empty capture …)" placeholder that admits and
      // spends Flash. Empty signal stays empty → admit drops with empty_signal.
      const signal = signal_text;

      const structureContext = {
        artifact_id: row.artifact_id,
        subject_ref: input.store.projectId,
        sibling_unit_event_ids: observationIds,
      };

      /**
       * Q7′ / QD9 / H0d:
       * - Offline (!allow_network): fake pipeline is the product path.
       * - Live (allow_network): NEVER run a proposal-writing fake pipeline first.
       *   Flash-only proposals; transient Flash fail → requeue (retryable), zero
       *   fake materializations.
       */
      let pipeline: AgenticPipelineResult;
      let liveTransientRetry = false;

      if (!allow_network) {
        pipeline = runAgenticProposalPipeline(input.agenticDb, {
          trust_zone_id: row.trust_zone_id,
          source_event_id: row.source_event_id,
          hook_event_name: row.hook_event_name,
          signal_text: signal,
          mode: "fake",
          allow_network: false,
          allow_auto_promote: input.allow_auto_promote !== false,
          ...(input.hold_first === true ? { hold_first: true } : {}),
          agentic_enabled: true,
          ...structureContext,
          ...nowOpt,
        });
      } else {
        // Live: admit + pack only (no proposal writes) before Flash.
        const emptyPipeline = (): AgenticPipelineResult => ({
          schema: "carpeos.agentic.pipeline-result/v1",
          ok: true,
          stage: "admit",
          admit_decision: null,
          triage_decision: null,
          pack_digest: null,
          triage_view_text: null,
          extract_view_text: null,
          effective_view_digest: null,
          policy_version: AGENTIC_POLICY_VERSION,
          proposals: [],
          structure_edge_count: 0,
          reason_codes: [],
          canonical_effect: "none",
          network_used: false,
        });

        const admit = ruleAdmitEvidence({
          source_event_id: row.source_event_id,
          trust_zone_id: row.trust_zone_id,
          hook_event_name: row.hook_event_name,
          signal_text: signal,
        });
        if (admit.decision === "drop") {
          pipeline = {
            ...emptyPipeline(),
            admit_decision: "drop",
            reason_codes: admit.reason_codes,
          };
        } else {
          const body_text =
            admit.residual_signal_text !== undefined && admit.residual_signal_text.length > 0
              ? admit.residual_signal_text
              : signal;
          const prepared = packAgenticEvidence({
            pack_id: makeAgenticPackId({
              trust_zone_id: row.trust_zone_id,
              source_event_id: row.source_event_id,
              body_text,
            }),
            body_text,
            now_iso: (input.now ?? new Date()).toISOString(),
          });
          if (!prepared.ok) {
            report.reason_codes.push(`flash_prepare_${prepared.error_code}`);
            pipeline = {
              ...emptyPipeline(),
              ok: false,
              stage: "pack",
              admit_decision: "admit",
              reason_codes: [prepared.error_code, prepared.detail],
            };
          } else {
            const triageRes = await callAgenticFlash({
              stage: "triage",
              view_text: prepared.triage_view_text,
              allow_network: true,
              spend,
              ...(input.fetch_impl !== undefined ? { fetch_impl: input.fetch_impl } : {}),
            });
            let flash_triage_text: string | null = null;
            let flash_extract_text: string | null = null;
            report.flash_calls += 1;
            if (triageRes.ok) {
              flash_triage_text = triageRes.text;
              report.network_used = true;
            } else {
              report.reason_codes.push(`flash_triage_${triageRes.error}`);
            }

            // QD3/Q6: stage parser v2 + local decision override. need_context → no extract.
            let shouldExtract = false;
            {
              const triaged = runTriageStage({
                pack_text: prepared.triage_view_text,
                pack_digest: prepared.pack_digest,
                source_event_id: row.source_event_id,
                mode: "flash",
                allow_network: true,
                flash_response_text: flash_triage_text,
              });
              shouldExtract = triaged.decision === "keep";
              if (triaged.decision === "need_context") {
                report.reason_codes.push("triage_need_context_no_extract");
              }
              if (triaged.reason_codes.includes("local_override_decision_signal")) {
                report.reason_codes.push("local_override_decision_signal");
              }
            }

            let extractFailed = false;
            let extractError = "";
            if (shouldExtract) {
              const extractRes = await callAgenticFlash({
                stage: "extract",
                view_text: prepared.extract_view_text,
                allow_network: true,
                spend,
                ...(input.fetch_impl !== undefined ? { fetch_impl: input.fetch_impl } : {}),
              });
              report.flash_calls += 1;
              if (extractRes.ok) {
                flash_extract_text = extractRes.text;
                report.network_used = true;
              } else {
                extractFailed = true;
                extractError = extractRes.error;
                report.reason_codes.push(`flash_extract_${extractRes.error}`);
              }
            }

            const triageErr = triageRes.ok ? null : triageRes.error;
            const transient =
              isTransientFlashErrorCode(triageErr) ||
              (extractFailed && isTransientFlashErrorCode(extractError));

            if (transient && flash_triage_text === null && flash_extract_text === null) {
              liveTransientRetry = true;
              pipeline = {
                ...emptyPipeline(),
                admit_decision: "admit",
                pack_digest: prepared.pack_digest,
                triage_view_text: prepared.triage_view_text,
                extract_view_text: prepared.extract_view_text,
                effective_view_digest: prepared.effective_view_digest,
                reason_codes: ["flash_transient_retry", ...admit.reason_codes],
              };
              report.reason_codes.push("flash_transient_retry");
            } else if (flash_triage_text !== null || flash_extract_text !== null) {
              pipeline = runAgenticProposalPipeline(input.agenticDb, {
                trust_zone_id: row.trust_zone_id,
                source_event_id: row.source_event_id,
                hook_event_name: row.hook_event_name,
                signal_text: body_text,
                mode: "flash",
                allow_network: true,
                allow_auto_promote: input.allow_auto_promote !== false,
                ...(input.hold_first === true ? { hold_first: true } : {}),
                agentic_enabled: true,
                flash_triage_text,
                flash_extract_text,
                ...structureContext,
                ...nowOpt,
              });
            } else {
              pipeline = {
                ...emptyPipeline(),
                admit_decision: "admit",
                pack_digest: prepared.pack_digest,
                triage_view_text: prepared.triage_view_text,
                extract_view_text: prepared.extract_view_text,
                effective_view_digest: prepared.effective_view_digest,
                reason_codes: ["flash_no_usable_response", ...admit.reason_codes],
              };
            }
          }
        }
      }

      report.structure_edge_count += pipeline.structure_edge_count;
      report.pipelines.push(pipeline);

      if (lease !== undefined) {
        if (liveTransientRetry) {
          failAgenticJob(input.agenticDb, {
            jobId: lease.job.job_id,
            leaseId: lease.lease_id,
            error_code: "flash_transient_retry",
            ...nowOpt,
          });
        } else if (pipeline.ok) {
          completeAgenticJob(input.agenticDb, {
            jobId: lease.job.job_id,
            leaseId: lease.lease_id,
            output_digest: pipeline.pack_digest,
            canonical_effect: input.materialize === true ? "observation" : "none",
            ...nowOpt,
          });
        } else {
          failAgenticJob(input.agenticDb, {
            jobId: lease.job.job_id,
            leaseId: lease.lease_id,
            error_code: "pipeline_failed",
            ...nowOpt,
          });
        }
      }

      if (liveTransientRetry) {
        input.store.requeueAgenticCaptureFeed({
          source_event_id: row.source_event_id,
          skip_reason: "flash_transient_retry",
        });
        report.reason_codes.push("feed_requeued");
        // Count toward limit so a timeout does not re-claim the same row forever.
        usefulRemaining -= 1;
        continue;
      }

      if (pipeline.admit_decision === "drop" || pipeline.proposals.length === 0) {
        input.store.finishAgenticCaptureFeed({
          source_event_id: row.source_event_id,
          state: "skipped",
          skip_reason: pipeline.reason_codes.join(",") || "no_proposals",
        });
        report.feed_skipped += 1;
        if (pipeline.admit_decision === "drop") {
          report.front_drop += 1;
          for (const code of pipeline.reason_codes) {
            if (code.length === 0) continue;
            report.front_drop_by_reason[code] = (report.front_drop_by_reason[code] ?? 0) + 1;
          }
        }
        // empty_signal does not consume the operator --limit (scan more for SessionEnd).
        const emptyDrop =
          pipeline.admit_decision === "drop" && pipeline.reason_codes.includes("empty_signal");
        if (!emptyDrop) {
          usefulRemaining -= 1;
        }
        continue;
      }

      if (input.materialize === true) {
        for (const proposal of pipeline.proposals) {
          const mat = materializeAgenticProposal({
            store: input.store,
            agenticDb: input.agenticDb,
            proposal,
            artifact_id: row.artifact_id,
            allow_promote_materialize:
              input.hold_first === true ? false : input.allow_auto_promote !== false,
            subject_ref: input.store.projectId,
          });
          if (mat.ok) {
            if (mat.observation_event_id !== null) {
              report.materializations += 1;
              observationIds.push(mat.observation_event_id);
            }
            if (mat.claim_event_id !== null) {
              report.draft_claims += 1;
              // Claim is a meaning_unit for E9 graph density.
              observationIds.push(mat.claim_event_id);
              if (mat.observation_event_id === null) {
                report.materializations += 1;
              }
            }
          }
        }
      }

      input.store.finishAgenticCaptureFeed({
        source_event_id: row.source_event_id,
        state: "done",
      });
      report.feed_done += 1;
      usefulRemaining -= 1;
    }
  } // while usefulRemaining / scanBudget

  // Persist day spend deltas so multi-process timers share ADR 0018 D5 caps.
  const deltaSpend = Math.max(0, spend.spend_usd - spendAtStart.spend_usd);
  const deltaCalls = Math.max(0, spend.calls - spendAtStart.calls);
  if (deltaSpend > 0 || deltaCalls > 0) {
    addDaySpend(
      input.agenticDb,
      { spend_usd: deltaSpend, calls: deltaCalls },
      input.now ?? new Date(),
    );
    report.reason_codes.push("day_spend_persisted");
  }

  // E9 projection hook (rebuildable; never SoT).
  if (observationIds.length > 0 && input.on_project !== undefined) {
    try {
      await input.on_project({
        trust_zone_id,
        observation_event_ids: observationIds,
      });
      report.project_invoked = true;
      report.reason_codes.push("project_hook_invoked");
    } catch {
      // Retrieval rebuild must not fail-close a successful materialize drain.
      report.project_invoked = false;
      report.reason_codes.push("project_hook_failed");
    }
  }

  return report;
}

/** Transient Flash failures that should leave the feed row retryable (Q7′ / QD9). */
function isTransientFlashErrorCode(error: string | null | undefined): boolean {
  if (error == null || error.length === 0) return false;
  return (
    error === "transport_failure" ||
    error === "timeout" ||
    error === "http_429" ||
    error === "http_5xx" ||
    error === "empty_model_response" ||
    error === "spend_cap_exceeded"
  );
}

/** List proposals held under agentic_v1 for operator review. */
export function listAgenticHeldProposals(
  db: SqlDatabase,
  trust_zone_id?: string,
  limit = 50,
): AgenticProposalRecord[] {
  return listAgenticProposals(db, {
    ...(trust_zone_id !== undefined ? { trust_zone_id } : {}),
    gate_decision: "hold",
    limit,
  });
}
