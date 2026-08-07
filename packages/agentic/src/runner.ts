/**
 * Product 6 agentic runner: drain capture feed → E1–E8 pipeline → optional materialize/project.
 * Capture never awaits this. Durable feed + job digests for idempotency.
 */

import type { LocalCaptureStore } from "@carpeos/local-store";
import { callAgenticFlash, createFlashSpendState, type FlashSpendState } from "./flash.js";
import { completeAgenticJob, enqueueAgenticJob, failAgenticJob, leaseAgenticJobs } from "./jobs.js";
import { materializeAgenticProposal } from "./materialize.js";
import { type AgenticPipelineResult, runAgenticProposalPipeline } from "./pipeline.js";
import { type AgenticProposalRecord, listAgenticProposals } from "./proposals.js";
import { addDaySpend, daySpendExceeded, loadDaySpend } from "./spend.js";
import type { SqlDatabase } from "./sql.js";

export type AgenticRunnerReport = {
  schema: "carpeos.agentic.runner-report/v1";
  ok: boolean;
  agentic_enabled: boolean;
  feed_seen: number;
  feed_done: number;
  feed_skipped: number;
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
  // Mutual exclusion: claim pending (and expired leased) rows before processing (ADR 0018 D5).
  const feed = input.store.claimAgenticCaptureFeed({
    limit,
    leaseMs: 120_000,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  report.feed_seen = feed.length;
  if (feed.length === 0) {
    report.reason_codes.push("feed_empty");
  }
  // Seed in-process spend from durable day caps so always-on timers share a budget.
  const dayCaps = {
    spend_cap_usd: input.spend?.spend_cap_usd ?? 1.0,
    max_calls: input.spend?.max_calls ?? 16,
  };
  const dayRow = loadDaySpend(input.agenticDb);
  if (daySpendExceeded(input.agenticDb, dayCaps, input.now)) {
    report.reason_codes.push("day_spend_cap_exceeded");
  }
  const spend = input.spend ?? createFlashSpendState(dayCaps);
  // Align in-memory counters with durable day totals when caller did not pass a custom spend.
  if (input.spend === undefined) {
    spend.spend_usd = dayRow.spend_usd;
    spend.calls = dayRow.calls;
  }
  const spendAtStart = { spend_usd: spend.spend_usd, calls: spend.calls };
  let allow_network = input.allow_network === true;
  if (allow_network && daySpendExceeded(input.agenticDb, dayCaps, input.now)) {
    allow_network = false;
    report.reason_codes.push("network_disabled_day_spend");
  }
  const observationIds: string[] = [];
  const trust_zone_id = input.store.trustZone.trust_zone_id;

  for (const row of feed) {
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

    const signal = signal_text.length > 0 ? signal_text : `(empty capture ${row.source_event_id})`;

    const structureContext = {
      artifact_id: row.artifact_id,
      subject_ref: input.store.projectId,
      sibling_unit_event_ids: observationIds,
    };

    // Offline-first pass (always valid product path).
    let pipeline = runAgenticProposalPipeline(input.agenticDb, {
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

    // Live Flash second pass when admitted and network allowed.
    // Extract is gated on triage keep (ADR 0018 D5) to avoid spend on drops.
    if (allow_network && pipeline.admit_decision === "admit") {
      const triageRes = await callAgenticFlash({
        stage: "triage",
        pack_text: signal,
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
      const triageKeep =
        flash_triage_text !== null &&
        !/"decision"\s*:\s*"drop"/i.test(flash_triage_text) &&
        !/\bdrop\b/i.test(flash_triage_text.slice(0, 80));
      // Prefer structured parse; fallback keep if triage failed open to extract for admit path
      let shouldExtract = triageRes.ok;
      if (triageRes.ok && flash_triage_text) {
        try {
          const parsed = JSON.parse(flash_triage_text) as { decision?: string };
          shouldExtract = parsed.decision === "keep" || parsed.decision === "need_context";
        } catch {
          shouldExtract = triageKeep;
        }
      }
      if (shouldExtract) {
        const extractRes = await callAgenticFlash({
          stage: "extract",
          pack_text: signal,
          allow_network: true,
          spend,
          ...(input.fetch_impl !== undefined ? { fetch_impl: input.fetch_impl } : {}),
        });
        report.flash_calls += 1;
        if (extractRes.ok) {
          flash_extract_text = extractRes.text;
          report.network_used = true;
        } else {
          report.reason_codes.push(`flash_extract_${extractRes.error}`);
        }
      }
      if (flash_triage_text !== null || flash_extract_text !== null) {
        pipeline = runAgenticProposalPipeline(input.agenticDb, {
          trust_zone_id: row.trust_zone_id,
          source_event_id: row.source_event_id,
          hook_event_name: row.hook_event_name,
          signal_text: signal,
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
      }
    }

    report.structure_edge_count += pipeline.structure_edge_count;
    report.pipelines.push(pipeline);

    if (lease !== undefined) {
      if (pipeline.ok) {
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

    if (pipeline.admit_decision === "drop" || pipeline.proposals.length === 0) {
      input.store.finishAgenticCaptureFeed({
        source_event_id: row.source_event_id,
        state: "skipped",
        skip_reason: pipeline.reason_codes.join(",") || "no_proposals",
      });
      report.feed_skipped += 1;
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
  }

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
    await input.on_project({
      trust_zone_id,
      observation_event_ids: observationIds,
    });
    report.project_invoked = true;
    report.reason_codes.push("project_hook_invoked");
  }

  return report;
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
