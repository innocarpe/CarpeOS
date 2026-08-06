#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  AGENTIC_FLASH_MODEL_ID,
  AGENTIC_PLANE,
  AGENTIC_POLICY_VERSION,
  computeGraphDensityMetrics,
  countAgenticJobs,
  createFlashSpendState,
  evaluateAutoPromotePrecisionFromPath,
  evaluateGoldenManifest,
  getAgenticProposal,
  listAgenticHeldProposals,
  listAgenticProposals,
  loadGoldenManifest,
  materializeAgenticProposal,
  migrateAgenticJobs,
  migrateAgenticProposals,
  processAgenticOnce,
  runAgenticProposalPipeline,
} from "@carpeos/agentic";
import { ADJUDICATION_POLICY_VERSION, isIdempotencyKey } from "@carpeos/capture";
import {
  IdempotencyConflictError,
  isTrustZoneId,
  LocalCaptureStore,
  runtimeDirFromEnv,
  withLocalRetrievalDatabase,
} from "@carpeos/local-store";
import { createCarpeosMcpApplication } from "@carpeos/mcp-server";
import {
  buildOkfProjectionPlan,
  checkOkfConformance,
  rebuildOkfProjection,
} from "@carpeos/okf-projection";
import {
  ackEmbeddingJob,
  buildGraphProjection,
  defaultEmbeddingProvider,
  ensureEmbeddingJob,
  leaseEmbeddingJobs,
  makeEmbeddingRecord,
  rebuildLocalRetrievalIndex,
  searchLocalRetrievalIndex,
  storeLocalVector,
} from "@carpeos/retrieval";
import type { RetrievalChunk, RetrievalQuery } from "@carpeos/schema";
import {
  type FetchLike,
  OutboxSyncCoordinator,
  SyncHttpError,
  SyncHttpTransport,
} from "@carpeos/sync-client";
import {
  buildFinalV5Decision,
  createDraftPipelineDeps,
  decideM8,
  ProviderBoundary,
  runAll200Evaluation,
  runDraftPipeline,
  v5DraftLaneReadiness,
  verifyV5OffReleasePath,
} from "@carpeos/v5";
import {
  HookInputError,
  isSupportedProvider,
  normalizeHookEnvelope,
  normalizeProviderId,
  supportedProviderHelpList,
} from "./adapters.js";
import {
  CycleFailure,
  type CyclePreflight,
  type CycleSyncResult,
  hashPath,
  hashText,
  runSyncCycle,
} from "./cycle.js";
import { packageName, packageVersion } from "./package-version.js";

type JsonObject = Record<string, unknown>;

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let failOpen = false;

  try {
    const { command, rest } = splitCommand(argv);

    // Human-readable help on stdout (not JSON) — empty argv / --help / help [cmd]
    if (command === undefined || command === "help") {
      const topic = rest[0];
      process.stdout.write(topic ? formatCommandHelp(topic) : formatRootHelp());
      return 0;
    }
    if (rest.some((token) => isHelpToken(token))) {
      if (
        command === "adjudicate" &&
        rest[0] === "reconcile-policy" &&
        rest.some((token) => isHelpToken(token)) &&
        rest.some(
          (token) =>
            token.startsWith("--") &&
            !isHelpToken(token) &&
            !["--from-policy", "--to-policy", "--trust-zone", "--limit"].includes(
              token.split("=", 1)[0] as string,
            ),
        )
      ) {
        return runReconcilePolicy(rest.slice(1), env);
      }
      process.stdout.write(formatCommandHelp(command));
      return 0;
    }

    failOpen = command === "capture-hook" && rest.includes("--fail-open");
    switch (command) {
      case "version":
        return runVersion(rest);
      case "init":
        return runInit(rest, env);
      case "project":
        return runProject(rest, env);
      case "capture-hook":
        return await runCaptureHook(rest, env);
      case "extract":
        return runExtract(rest, env);
      case "adjudicate":
        return runAdjudicate(rest, env);
      case "outbox":
        return runOutbox(rest, env);
      case "sync":
        return await runSync(rest, env);
      case "retrieval":
        return runRetrieval(rest, env);
      case "memory":
        return await runMemory(rest, env);
      case "okf":
        return runOkf(rest, env);
      case "v5":
        return await runV5(rest, env);
      case "agentic":
        return await runAgentic(rest, env);
      case "setup":
      case "doctor":
        throw new CliUsageError(
          "setup/doctor are provided by the package entrypoint: carpeos setup … (npm) or node scripts/install-local.mjs … (git checkout). Try: carpeos setup --help",
        );
      default:
        throw new CliUsageError(`unknown command: ${command}\nRun: carpeos --help`);
    }
  } catch (error) {
    if (failOpen) {
      writeJson(process.stderr, {
        ok: false,
        warning: {
          code: "capture_failed_open",
          message: "CarpeOS capture failed open; the provider workflow may continue.",
        },
      });
      return 0;
    }

    const publicError = toPublicError(error);
    writeJson(process.stderr, {
      ok: false,
      error: {
        code: publicError.code,
        message: publicError.message,
      },
    });
    return publicError.exitCode;
  }
}

function runRetrieval(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new CliUsageError("retrieval requires rebuild or embed (see: carpeos help retrieval)");
  }
  const parsed = parseArgs({
    args: rest,
    allowPositionals: false,
    strict: true,
    options: {
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      provider: { type: "string", default: "local-lexical-hash" },
      limit: { type: "string", default: "10" },
      "lease-ms": { type: "string", default: "30000" },
    },
  });
  const trustZone = requireStoreTrustZone(parsed.values["trust-zone"]);
  const store = openStore(
    compactCommonOptions(parsed.values.home, parsed.values["project-id"], trustZone),
    env,
  );
  try {
    switch (subcommand) {
      case "rebuild": {
        const rebuilt = withLocalRetrievalDatabase(store, (db) =>
          rebuildLocalRetrievalIndex(db, new Date()),
        );
        writeJson(process.stdout, {
          ok: true,
          command: "retrieval rebuild",
          chunks: rebuilt.chunks.length,
          freshness: rebuilt.freshness,
          trust_zone_id: store.trustZone.trust_zone_id,
        });
        return 0;
      }
      case "embed": {
        const embedProvider = defaultEmbeddingProvider();
        const requested = String(parsed.values.provider ?? embedProvider.info.id);
        if (requested !== embedProvider.info.id && requested !== "local-lexical-hash") {
          throw new CliUsageError(
            `retrieval embed requires --provider ${embedProvider.info.id} (offline default)`,
          );
        }
        const embedded = withLocalRetrievalDatabase(store, (db) => {
          const rebuilt = rebuildLocalRetrievalIndex(db, new Date());
          for (const chunk of rebuilt.chunks.filter((item) => item.status === "active")) {
            ensureEmbeddingJob(db, {
              chunkId: chunk.chunk_id,
              embeddingModel: embedProvider.info.model,
              embeddingVersion: embedProvider.info.version,
              pooling: embedProvider.info.pooling,
            });
          }
          const leased = leaseEmbeddingJobs(db, {
            limit: parseInteger(parsed.values.limit, "--limit", 1),
            leaseMs: parseInteger(parsed.values["lease-ms"], "--lease-ms", 1),
          });
          let count = 0;
          for (const item of leased) {
            const chunk = rebuilt.chunks.find(
              (candidate) => candidate.chunk_id === item.job.chunk_id,
            );
            if (chunk === undefined) {
              continue;
            }
            const embeddedVector = embedProvider.embed(chunk.text);
            if (embeddedVector instanceof Promise) {
              throw new Error("async embedding providers are not supported in CLI embed yet");
            }
            const vector = embeddedVector;
            const record = makeEmbeddingRecord({
              chunkId: chunk.chunk_id,
              vector,
              embeddingModel: embedProvider.info.model,
              embeddingVersion: embedProvider.info.version,
              pooling: embedProvider.info.pooling,
              inputTextSha256: chunk.text_digest,
              createdAt: new Date().toISOString(),
            });
            storeLocalVector(db, { record, vector });
            if (ackEmbeddingJob(db, { jobId: item.job.job_id, leaseId: item.lease_id, record })) {
              count += 1;
            }
          }
          return { leased: leased.length, embedded: count };
        });
        writeJson(process.stdout, {
          ok: true,
          command: "retrieval embed",
          provider: embedProvider.info.id,
          semantic_quality: embedProvider.info.semantic_quality,
          ...embedded,
        });
        return 0;
      }
      default:
        throw new CliUsageError(`unknown retrieval subcommand: ${subcommand}`);
    }
  } finally {
    store.close();
  }
}
function runOkf(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "export" && subcommand !== "rebuild") {
    throw new CliUsageError("okf requires export or rebuild (see: carpeos help okf)");
  }

  const parsed = parseArgs({
    args: rest,
    allowPositionals: false,
    strict: true,
    options: {
      out: { type: "string" },
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      "visible-trust-zone": { type: "string", multiple: true },
      "include-held": { type: "boolean", default: false },
    },
  });
  const visibleTrustZoneIds = parsed.values["visible-trust-zone"];
  if (visibleTrustZoneIds === undefined || visibleTrustZoneIds.length === 0) {
    throw new CliUsageError("okf commands require --visible-trust-zone");
  }
  for (const trustZoneId of visibleTrustZoneIds) {
    if (!isTrustZoneId(trustZoneId)) {
      throw new CliUsageError("--visible-trust-zone must match tz_[a-z0-9][a-z0-9_-]{2,63}");
    }
  }

  const outputRoot = resolve(requireString(parsed.values.out, "--out"));
  const store = openStore(
    compactCommonOptions(
      parsed.values.home,
      parsed.values["project-id"],
      parsed.values["trust-zone"],
    ),
    env,
  );
  try {
    const activeTrustZoneId = store.trustZone.trust_zone_id;
    if (!visibleTrustZoneIds.includes(activeTrustZoneId)) {
      throw new CliUsageError("--visible-trust-zone must include the active trust zone");
    }

    const sortedVisibleTrustZoneIds = [...new Set(visibleTrustZoneIds)].sort();
    const snapshot = store.getRetrievalInputSnapshot({
      visibleTrustZoneIds: sortedVisibleTrustZoneIds,
    });
    const config = {
      outputRoot,
      visibleTrustZoneIds: sortedVisibleTrustZoneIds,
      generatedAt: new Date().toISOString(),
      includeHeld: parsed.values["include-held"],
      pathPolicy: "delete_missing" as const,
    };
    const plan = buildOkfProjectionPlan({ snapshot, config });
    const conformance = checkOkfConformance({
      files: plan.files,
      manifest: plan.manifest,
    });
    if (!conformance.valid) {
      throw new Error("OKF projection plan is not conformant");
    }

    const rebuilt = rebuildOkfProjection({ snapshot, config });
    writeJson(process.stdout, {
      ok: true,
      command: `okf ${subcommand}`,
      projection: "okf-export/v1",
      okf_version: "0.2",
      output_root: outputRoot,
      visible_trust_zone_ids: sortedVisibleTrustZoneIds,
      include_held: parsed.values["include-held"],
      concept_count: plan.files.filter((file) => file.path !== "index.md" && file.path !== "log.md")
        .length,
      file_count: plan.files.length,
      manifest_status: rebuilt.manifestStatus,
      manifest_path: rebuilt.manifestPath,
      written: rebuilt.written,
      deleted: rebuilt.deleted,
      preserved_deletion_because_manifest_corrupt: rebuilt.preservedDeletionBecauseManifestCorrupt,
      conformance_warning_count: conformance.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "warning",
      ).length,
    });
    return 0;
  } finally {
    store.close();
  }
}

async function runMemory(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new CliUsageError(
      "memory requires search, get, or context-pack (see: carpeos help memory)",
    );
  }
  const parsed = parseArgs({
    args: rest,
    allowPositionals: false,
    strict: true,
    options: {
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      query: { type: "string" },
      "chunk-id": { type: "string" },
      task: { type: "string" },
      limit: { type: "string", default: "10" },
      "max-items": { type: "string", default: "16" },
      "max-characters": { type: "string", default: "8000" },
      "protected-value-policy": { type: "string", default: "metadata_only" },
      "visible-trust-zone": { type: "string", multiple: true },
      "include-held": { type: "boolean", default: false },
      "scope-project": { type: "string", multiple: true },
      "scope-worktree": { type: "string", multiple: true },
      "all-worktrees": { type: "boolean", default: false },
    },
  });
  const trustZone = requireStoreTrustZone(parsed.values["trust-zone"]);
  const visibleTrustZones = requireVisibleTrustZones(
    parsed.values["visible-trust-zone"],
    trustZone,
  );
  const store = openStore(
    compactCommonOptions(parsed.values.home, parsed.values["project-id"], trustZone),
    env,
  );
  try {
    switch (subcommand) {
      case "search": {
        const queryText = requireString(parsed.values.query, "--query");
        const result = withLocalRetrievalDatabase(store, (db) =>
          searchLocalRetrievalIndex(db, {
            query: makeRetrievalQuery({
              text: queryText,
              visibleTrustZones,
              limit: parseInteger(parsed.values.limit, "--limit", 1),
              includeHeld: parsed.values["include-held"] === true,
              ...(parsed.values["scope-project"] === undefined
                ? {}
                : { projectIds: parsed.values["scope-project"] }),
              ...(parsed.values["scope-worktree"] === undefined
                ? {}
                : { worktreeIds: parsed.values["scope-worktree"] }),
              // Current checkout ranks higher unless the operator opts out.
              ...(parsed.values["all-worktrees"] === true
                ? {}
                : { boostWorktreeId: store.worktree.worktree_id }),
            }),
          }),
        );
        writeJson(process.stdout, {
          ok: true,
          command: "memory search",
          result,
        });
        return 0;
      }
      case "get": {
        const chunkId = requireString(parsed.values["chunk-id"], "--chunk-id");
        const result = withLocalRetrievalDatabase(store, (db) => {
          const row = db
            .prepare("SELECT chunk_json FROM retrieval_chunks WHERE chunk_id = ?")
            .get(chunkId) as { chunk_json: string } | undefined;
          const chunk =
            row === undefined ? undefined : (JSON.parse(row.chunk_json) as RetrievalChunk);
          if (chunk === undefined) {
            return undefined;
          }
          return searchLocalRetrievalIndex(db, {
            query: makeRetrievalQuery({
              text: chunk.text,
              visibleTrustZones,
              limit: 100,
              includeHeld: parsed.values["include-held"] === true,
            }),
          });
        });
        if (result === undefined) {
          writeJson(process.stdout, {
            ok: false,
            command: "memory get",
            item: undefined,
          });
          return 2;
        }
        const item = result.results.find((candidate) => candidate.chunk_id === chunkId);
        writeJson(process.stdout, {
          ok: item !== undefined,
          command: "memory get",
          item,
          freshness: result.projection_freshness,
          filters_applied: result.filters_applied,
        });
        return item === undefined ? 2 : 0;
      }
      case "context-pack": {
        const task = requireString(parsed.values.task, "--task");
        const protectedValuePolicy = parseProtectedValuePolicy(
          parsed.values["protected-value-policy"],
        );
        const maxItems = parseInteger(parsed.values["max-items"], "--max-items", 1);
        const maxCharacters = parseInteger(parsed.values["max-characters"], "--max-characters", 1);
        const app = createCarpeosMcpApplication({
          store,
          config: { visibleTrustZoneIds: visibleTrustZones },
        });
        const result = await app.dispatch("memory_context_pack", {
          schema_version: "v1",
          visibility: {
            visible_trust_zone_ids: visibleTrustZones,
            protected_value_policy: protectedValuePolicy,
          },
          task,
          include_held: parsed.values["include-held"] === true,
          context_budget: {
            max_items: maxItems,
            max_characters: maxCharacters,
          },
        });
        writeJson(process.stdout, {
          ok: !result.isError,
          command: "memory context-pack",
          pack: result.structuredContent,
        });
        return result.isError ? 2 : 0;
      }
      default:
        throw new CliUsageError(`unknown memory subcommand: ${subcommand}`);
    }
  } finally {
    store.close();
  }
}

function runInit(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const options = parseCommonOptions(argv);
  const store = openStore(options, env);
  try {
    writeJson(process.stdout, {
      ok: true,
      command: "init",
      runtime_dir: store.runtimeDir,
      database_path: store.dbPath,
      project_id: store.projectId,
      client_id: store.clientId,
      trust_zone_id: store.trustZone.trust_zone_id,
    });
    return 0;
  } finally {
    store.close();
  }
}

function runProject(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "identify") {
    throw new CliUsageError("project requires the identify subcommand (see: carpeos help project)");
  }
  const options = parseCommonOptions(rest);
  const runtimeDir = options.home ?? runtimeDirFromEnv(env);
  const resolution = resolveTrustZoneResolution(options.trustZone, env, runtimeDir);
  const store = openStore(options, env);
  try {
    writeJson(process.stdout, {
      ok: true,
      command: "project identify",
      project_id: store.projectId,
      client_id: store.clientId,
      trust_zone_id: store.trustZone.trust_zone_id,
      trust_zone_source: resolution.source,
      worktree_id: store.worktree.worktree_id,
      worktree_name: store.worktree.worktree_name,
      worktree_basis: store.worktree.basis_kind,
      is_linked_worktree: store.worktree.is_linked_worktree,
      ...(store.worktree.git_branch === undefined ? {} : { git_branch: store.worktree.git_branch }),
    });
    return 0;
  } finally {
    store.close();
  }
}

async function runCaptureHook(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const parsed = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      provider: { type: "string" },
      input: { type: "string", default: "stdin" },
      "fail-open": { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      "idempotency-key": { type: "string" },
      "no-extract": { type: "boolean", default: false },
    },
  });
  const providerRaw = parsed.values.provider;
  if (providerRaw === undefined || !isSupportedProvider(providerRaw)) {
    throw new CliUsageError(`capture-hook requires --provider ${supportedProviderHelpList()}`);
  }
  const provider = normalizeProviderId(providerRaw) ?? providerRaw;
  if (parsed.values.input !== "stdin" && parsed.values.input !== "argv") {
    throw new CliUsageError("--input must be stdin or argv");
  }
  const explicitIdempotencyKey = parsed.values["idempotency-key"];
  if (explicitIdempotencyKey !== undefined && !isIdempotencyKey(explicitIdempotencyKey)) {
    throw new CliUsageError("--idempotency-key must match idem_[A-Za-z0-9_-]{16,128}");
  }

  const rawText =
    parsed.values.input === "argv" ? parseArgvInput(parsed.positionals) : await readStdin();
  const raw = parseJsonObject(rawText);
  const store = openStore(
    compactCommonOptions(
      parsed.values.home,
      parsed.values["project-id"],
      parsed.values["trust-zone"],
    ),
    env,
  );
  try {
    const envelope = normalizeHookEnvelope({
      provider,
      raw,
      subjectRef: store.projectId,
      fallbackCapturedAt: new Date().toISOString(),
      ...(explicitIdempotencyKey === undefined ? {} : { explicitIdempotencyKey }),
    });
    // Product default: extract meaningful Observation when hook is eligible.
    const result = store.captureHook(envelope, {
      extract: parsed.values["no-extract"] !== true,
    });
    if (!parsed.values.quiet) {
      writeJson(process.stdout, {
        ok: true,
        command: "capture-hook",
        status: result.status,
        event_id: result.event.event_id,
        event_type: result.event.event_type,
        local_sequence: result.local_sequence,
        outbox_id: result.outbox_id,
        request_fingerprint: result.request_fingerprint,
        trust_zone_id: result.event.trust_zone.trust_zone_id,
        project_id: store.projectId,
        ...(result.extraction === undefined
          ? {}
          : {
              extraction: {
                status: result.extraction.status,
                ...(result.extraction.status === "extracted" ||
                result.extraction.status === "replay"
                  ? {
                      observation_event_id: result.extraction.event.event_id,
                      observation_id: result.extraction.event.payload.observation_id,
                    }
                  : {}),
                ...(result.extraction.status === "skipped"
                  ? { reason: result.extraction.reason }
                  : {}),
                ...(result.extraction.status === "failed"
                  ? { error: result.extraction.error }
                  : {}),
              },
            }),
      });
    }
    return 0;
  } finally {
    store.close();
  }
}

function runExtract(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const parsed = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      "event-id": { type: "string" },
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
    },
  });
  const eventId = parsed.values["event-id"];
  if (eventId === undefined || eventId.trim().length === 0) {
    throw new CliUsageError("extract requires --event-id <evt_…>");
  }
  const store = openStore(
    compactCommonOptions(
      parsed.values.home,
      parsed.values["project-id"],
      parsed.values["trust-zone"],
    ),
    env,
  );
  try {
    const result = store.extractFromEventId(eventId.trim());
    writeJson(process.stdout, {
      ok: result.status !== "failed",
      command: "extract",
      ...result,
    });
    return result.status === "failed" ? 1 : 0;
  } finally {
    store.close();
  }
}

function runAdjudicate(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  if (argv[0] === "reconcile-policy") {
    return runReconcilePolicy(argv.slice(1), env);
  }
  const [requestedMode, ...rest] = argv;
  const mode =
    requestedMode === "list-held" ||
    requestedMode === "promote-held" ||
    requestedMode === "reject-held" ||
    requestedMode === "history"
      ? requestedMode
      : undefined;
  const parsed = parseArgs({
    args: mode === undefined ? [...argv] : rest,
    allowPositionals: false,
    strict: true,
    options: {
      "event-id": { type: "string" },
      "signal-text": { type: "string" },
      "policy-version": { type: "string" },
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      stats: { type: "boolean", default: false },
      limit: { type: "string", default: "50" },
    },
  });

  const store = openStore(
    compactCommonOptions(
      parsed.values.home,
      parsed.values["project-id"],
      parsed.values["trust-zone"],
    ),
    env,
  );
  try {
    if (mode === "list-held") {
      const policyVersion = parseHeldPolicyVersion(parsed.values["policy-version"]);
      const limit = parseInteger(parsed.values.limit, "--limit", 1);
      if (limit > 200) {
        throw new CliUsageError("--limit must be less than or equal to 200");
      }
      const receipt = store.listHeldDispositions(policyVersion, limit);
      writeJson(process.stdout, {
        ok: true,
        command: "adjudicate",
        mode,
        ...receipt,
      });
      return 0;
    }

    if (mode === "history") {
      const eventId = parsed.values["event-id"]?.trim();
      if (eventId === undefined || eventId.length === 0) {
        throw new CliUsageError("history requires --event-id <evt_…>");
      }
      const history = store.listDispositionHistory(eventId);
      writeJson(process.stdout, {
        ok: true,
        command: "adjudicate",
        mode,
        source_event_id: eventId,
        count: history.length,
        history,
      });
      return 0;
    }

    if (mode === "promote-held" || mode === "reject-held") {
      const eventId = parsed.values["event-id"]?.trim();
      if (eventId === undefined || eventId.length === 0) {
        throw new CliUsageError(`${mode} requires --event-id <evt_…>`);
      }
      const policyVersion = parseHeldPolicyVersion(parsed.values["policy-version"]);
      const result = store.reviewHeldDisposition(
        eventId,
        mode === "promote-held" ? "promote" : "reject",
        policyVersion,
      );
      writeJson(process.stdout, {
        ok: result.status !== "failed",
        command: "adjudicate",
        mode,
        ...result,
      });
      return result.status === "failed" ? 1 : 0;
    }

    if (parsed.values.stats === true) {
      writeJson(process.stdout, {
        ok: true,
        command: "adjudicate",
        mode: "stats",
        counts: store.listDispositionCounts(),
      });
      return 0;
    }

    const eventId = parsed.values["event-id"];
    if (eventId === undefined || eventId.trim().length === 0) {
      throw new CliUsageError(
        "adjudicate requires --event-id <evt_…>, --stats, or a held-review subcommand (see: carpeos help adjudicate)",
      );
    }
    const signalText = parsed.values["signal-text"];
    const policyVersion = parsed.values["policy-version"];
    const result = store.adjudicateFromEventId(eventId.trim(), {
      ...(signalText === undefined || signalText.trim().length === 0
        ? {}
        : { signalText: signalText.trim() }),
      ...(policyVersion === undefined || policyVersion.trim().length === 0
        ? {}
        : { policyVersion: policyVersion.trim() }),
    });
    writeJson(process.stdout, {
      ok: result.status !== "failed",
      command: "adjudicate",
      ...result,
      ...(result.status === "promoted" ||
      result.status === "held" ||
      (result.status === "replay" && result.extraction !== undefined)
        ? {
            extraction: {
              status: result.extraction?.status,
              ...(result.extraction !== undefined &&
              (result.extraction.status === "extracted" || result.extraction.status === "replay")
                ? {
                    observation_event_id: result.extraction.event.event_id,
                    observation_id: result.extraction.event.payload.observation_id,
                    lifecycle_status: result.extraction.event.lifecycle_status,
                  }
                : {}),
            },
          }
        : {}),
    });
    return result.status === "failed" ? 1 : 0;
  } finally {
    store.close();
  }
}

function runReconcilePolicy(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  function assertUniqueReconciliationFlags(argv: readonly string[]): void {
    const seen = new Set<string>();
    for (const token of argv) {
      if (!token.startsWith("--")) continue;
      const flag = token.split("=", 1)[0] as string;
      if (seen.has(flag)) throw new CliUsageError(`duplicate reconciliation flag: ${flag}`);
      seen.add(flag);
    }
  }

  assertUniqueReconciliationFlags(argv);
  const parsed = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      "from-policy": { type: "string" },
      "to-policy": { type: "string" },
      "trust-zone": { type: "string" },
      limit: { type: "string" },
    },
  });
  const fromPolicy = parsed.values["from-policy"];
  const toPolicy = parsed.values["to-policy"];
  const trustZoneId = parsed.values["trust-zone"];
  const limitValue = parsed.values.limit;
  const policyPattern = /^[a-z][a-z0-9_-]{2,63}$/;
  if (
    fromPolicy === undefined ||
    toPolicy === undefined ||
    trustZoneId === undefined ||
    limitValue === undefined ||
    fromPolicy.normalize("NFC") !== fromPolicy ||
    toPolicy.normalize("NFC") !== toPolicy ||
    trustZoneId.normalize("NFC") !== trustZoneId ||
    !policyPattern.test(fromPolicy) ||
    !policyPattern.test(toPolicy) ||
    !isTrustZoneId(trustZoneId)
  ) {
    throw new CliUsageError(
      "reconcile-policy requires valid --from-policy, --to-policy, --trust-zone, and --limit",
    );
  }
  const limit = parseInteger(limitValue, "--limit", 1);
  if (limit > 200) throw new CliUsageError("--limit must be less than or equal to 200");
  const store = LocalCaptureStore.openExistingPreview({
    runtimeDir: runtimeDirFromEnv(env),
    workspaceRoot: process.cwd(),
    trustZoneId,
  });
  try {
    writeJson(
      process.stdout,
      store.previewPolicyReconciliation({
        from_policy: fromPolicy,
        to_policy: toPolicy,
        trust_zone_id: trustZoneId,
        limit,
      }),
    );
    return 0;
  } finally {
    store.close();
  }
}
function runOutbox(argv: readonly string[], env: NodeJS.ProcessEnv): number {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new CliUsageError(
      "outbox requires status, lease, ack, or retry (see: carpeos help outbox)",
    );
  }

  const parsed = parseArgs({
    args: rest,
    allowPositionals: false,
    strict: true,
    options: {
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      limit: { type: "string", default: "10" },
      "lease-ms": { type: "string", default: "30000" },
      "outbox-id": { type: "string" },
      "lease-id": { type: "string" },
      "delay-ms": { type: "string", default: "1000" },
      error: { type: "string", default: "retry requested by operator" },
    },
  });
  const store = openStore(
    compactCommonOptions(
      parsed.values.home,
      parsed.values["project-id"],
      parsed.values["trust-zone"],
    ),
    env,
  );
  try {
    switch (subcommand) {
      case "status":
        writeJson(process.stdout, {
          ok: true,
          command: "outbox status",
          status: store.outboxStatus(),
          errors: store.listOutboxErrors(),
        });
        return 0;
      case "lease": {
        const lease = store.leaseOutbox(
          parseInteger(parsed.values.limit, "--limit", 1),
          parseInteger(parsed.values["lease-ms"], "--lease-ms", 1),
        );
        writeJson(process.stdout, {
          ok: true,
          command: "outbox lease",
          lease,
        });
        return 0;
      }
      case "ack": {
        const outboxId = parseRequiredInteger(parsed.values["outbox-id"], "--outbox-id");
        const leaseId = requireString(parsed.values["lease-id"], "--lease-id");
        const acknowledged = store.ackOutbox(outboxId, leaseId);
        writeJson(process.stdout, {
          ok: acknowledged,
          command: "outbox ack",
          acknowledged,
          outbox_id: outboxId,
        });
        return acknowledged ? 0 : 2;
      }
      case "retry": {
        const outboxId = parseRequiredInteger(parsed.values["outbox-id"], "--outbox-id");
        const leaseId = requireString(parsed.values["lease-id"], "--lease-id");
        const scheduled = store.retryOutbox(
          outboxId,
          leaseId,
          parseInteger(parsed.values["delay-ms"], "--delay-ms", 0),
          parsed.values.error ?? "retry requested by operator",
        );
        writeJson(process.stdout, {
          ok: scheduled,
          command: "outbox retry",
          scheduled,
          outbox_id: outboxId,
        });
        return scheduled ? 0 : 2;
      }
      default:
        throw new CliUsageError(`unknown outbox subcommand: ${subcommand}`);
    }
  } finally {
    store.close();
  }
}

async function runSync(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined) {
    throw new CliUsageError(
      "sync requires status, push, pull, once, cycle, or credential-hash (see: carpeos help sync)",
    );
  }

  const parsed = parseArgs({
    args: rest,
    allowPositionals: false,
    strict: true,
    options: {
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
      url: { type: "string" },
      "credential-file": { type: "string" },
      "sync-key-file": { type: "string" },
      limit: { type: "string", default: "1" },
      "max-pages": { type: "string", default: "1" },
      "lease-ms": { type: "string", default: "30000" },
      "retry-delay-ms": { type: "string", default: "1000" },
      "pull-limit": { type: "string", default: "100" },
      json: { type: "boolean", default: false },
    },
  });
  const store = openStore(
    compactCommonOptions(
      parsed.values.home,
      parsed.values["project-id"],
      parsed.values["trust-zone"],
    ),
    env,
  );

  try {
    switch (subcommand) {
      case "status": {
        const config = resolveSyncConfig(parsed.values, env, store.runtimeDir, false);
        const cursor = store.getSyncCursor();
        const storeTrustZoneId = store.trustZone.trust_zone_id;
        const trustZoneSource = resolveTrustZoneResolution(
          parsed.values["trust-zone"],
          env,
          store.runtimeDir,
        ).source;
        const outboxTrustZoneIds = store.listOutboxTrustZones();
        const outboxTrustZoneMismatch = outboxTrustZoneIds.some(
          (zoneId: string) => zoneId !== storeTrustZoneId,
        );
        const warnings: Array<{
          code: string;
          message: string;
          active_trust_zone_id?: string;
          outbox_trust_zone_ids?: string[];
        }> = [];
        if (outboxTrustZoneMismatch) {
          warnings.push({
            code: "outbox_trust_zone_mismatch",
            message:
              "Pending or leased outbox items target a different trust_zone_id than the active store zone. Re-run sync with --trust-zone matching the outbox zone(s).",
            active_trust_zone_id: storeTrustZoneId,
            outbox_trust_zone_ids: outboxTrustZoneIds,
          });
        }
        writeJson(process.stdout, {
          ok: true,
          command: "sync status",
          sync: {
            url_configured: config.urlConfigured,
            credential_file_configured: config.credentialFileConfigured,
            sync_key_file_configured: config.syncKeyFileConfigured,
          },
          local: {
            outbox: store.outboxStatus(),
            outbox_trust_zone_ids: outboxTrustZoneIds,
            outbox_trust_zone_mismatch: outboxTrustZoneMismatch,
            outbox_errors: store.listOutboxErrors(),
            cursor,
            trust_zone_id: storeTrustZoneId,
            trust_zone_source: trustZoneSource,
            client_id: store.clientId,
          },
          ...(warnings.length === 0 ? {} : { warnings }),
        });
        return 0;
      }
      case "push": {
        const coordinator = createSyncCoordinator(parsed.values, env, store);
        const limit = parseInteger(parsed.values.limit, "--limit", 1);
        const results = [];
        let exitCode = 0;
        for (let index = 0; index < limit; index += 1) {
          const result = await coordinator.pushOne();
          if (result === undefined) {
            break;
          }
          results.push(redactPushResult(result));
          if (result.status !== "acked") {
            exitCode = result.status === "retried" ? Math.max(exitCode, 1) : 4;
            break;
          }
        }
        writeJson(process.stdout, {
          ok: exitCode === 0,
          command: "sync push",
          processed: results.length,
          results,
          status: store.outboxStatus(),
        });
        return exitCode;
      }
      case "pull": {
        const coordinator = createSyncCoordinator(parsed.values, env, store);
        const maxPages = parseInteger(parsed.values["max-pages"], "--max-pages", 1);
        const results = [];
        for (let index = 0; index < maxPages; index += 1) {
          const page = await coordinator.pullPage();
          results.push(page);
          if (!page.has_more) {
            break;
          }
        }
        writeJson(process.stdout, {
          ok: true,
          command: "sync pull",
          pages: results.length,
          results,
          cursor: store.getSyncCursor(),
        });
        return 0;
      }
      case "once": {
        const coordinator = createSyncCoordinator(parsed.values, env, store);
        const limit = parseInteger(parsed.values.limit, "--limit", 1);
        const maxPages = parseInteger(parsed.values["max-pages"], "--max-pages", 1);
        const once = await runBoundedSyncOnce(coordinator, store, { limit, maxPages });
        writeJson(process.stdout, {
          ok: once.exitCode === 0,
          command: "sync once",
          pushed: once.pushed,
          pulled: once.pulled,
          status: store.outboxStatus(),
          cursor: store.getSyncCursor(),
        });
        return once.exitCode;
      }
      case "cycle": {
        const limit = parseInteger(parsed.values.limit, "--limit", 1);
        const maxPages = parseInteger(parsed.values["max-pages"], "--max-pages", 1);
        const pullLimit = parseInteger(parsed.values["pull-limit"], "--pull-limit", 1);
        let coordinator: OutboxSyncCoordinator | undefined;
        let transportCounts: Record<string, number> = {};
        const result = await runSyncCycle({
          home: store.runtimeDir,
          projectId: store.projectId,
          trustZoneId: store.trustZone.trust_zone_id,
          bounds: { limit, maxPages, pullLimit },
          commandArgv: ["sync", subcommand, ...rest],
          distribution: "unknown",
          preflight: () => {
            const resolved = resolveCycleSyncConfig(parsed.values, env, store.runtimeDir);
            transportCounts = {};
            coordinator = createSyncCoordinatorFromConfig(
              parsed.values,
              store,
              resolved,
              (input: string | URL | Request, init?: RequestInit) => {
                const method = init?.method ?? "GET";
                transportCounts[method] = (transportCounts[method] ?? 0) + 1;
                return globalThis.fetch(input, init);
              },
            );
            return resolved.preflight;
          },
          syncOnce: async (): Promise<CycleSyncResult> => {
            if (coordinator === undefined) {
              throw new CycleFailure(
                "config_invalid",
                "preflight",
                3,
                "sync config was not resolved",
              );
            }
            const once = await runBoundedSyncOnce(coordinator, store, { limit, maxPages });
            if (once.exitCode !== 0) {
              throw new CycleFailure("sync_failed", "sync", 7, "bounded sync push or pull failed");
            }
            return {
              pushed: once.pushed,
              pulled: once.pulled,
              pushedCount: once.pushed.length,
              pulledPages: once.pulled.length,
              cursor: store.getSyncCursor(),
              outboxStatus: store.outboxStatus(),
              transportCounts,
            };
          },
          rebuildRetrieval: () => {
            try {
              const rebuilt = withLocalRetrievalDatabase(store, (db) =>
                rebuildLocalRetrievalIndex(db, new Date()),
              );
              return { chunks: rebuilt.chunks.length, freshness: rebuilt.freshness };
            } catch (error) {
              throw new CycleFailure(
                "retrieval_failed",
                "retrieval",
                8,
                error instanceof Error ? error.message : "retrieval rebuild failed",
              );
            }
          },
        });
        writeJson(process.stdout, result);
        return result.health.exit_code;
      }
      case "credential-hash": {
        const credentialFile =
          firstConfigured(
            parsed.values["credential-file"],
            env.CARPEOS_SYNC_CREDENTIAL_FILE,
            join(store.runtimeDir, "sync-credential"),
          ) ?? join(store.runtimeDir, "sync-credential");
        const credential = readCredentialFile(credentialFile);
        writeJson(process.stdout, {
          ok: true,
          command: "sync credential-hash",
          hash_algorithm: "sha-256",
          token_hash_sha256: sha256Hex(credential),
        });
        return 0;
      }
      default:
        throw new CliUsageError(`unknown sync subcommand: ${subcommand}`);
    }
  } finally {
    store.close();
  }
}

type CommonOptions = {
  home?: string;
  projectId?: string;
  trustZone?: string;
};

function parseCommonOptions(argv: readonly string[]): CommonOptions {
  const parsed = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      home: { type: "string" },
      "project-id": { type: "string" },
      "trust-zone": { type: "string" },
    },
  });
  return compactCommonOptions(
    parsed.values.home,
    parsed.values["project-id"],
    parsed.values["trust-zone"],
  );
}

function compactCommonOptions(
  home: string | undefined,
  projectId: string | undefined,
  trustZone: string | undefined,
): CommonOptions {
  return {
    ...(home === undefined ? {} : { home }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(trustZone === undefined ? {} : { trustZone }),
  };
}

type TrustZoneSource = "flag" | "env" | "config" | "device_default";

type TrustZoneResolution = {
  /** Undefined means LocalCaptureStore will derive the device-local default. */
  trustZoneId: string | undefined;
  source: TrustZoneSource;
};

function openStore(options: CommonOptions, env: NodeJS.ProcessEnv): LocalCaptureStore {
  const runtimeDir = options.home ?? runtimeDirFromEnv(env);
  const resolution = resolveTrustZoneResolution(options.trustZone, env, runtimeDir);
  if (resolution.trustZoneId !== undefined && !isTrustZoneId(resolution.trustZoneId)) {
    throw new CliUsageError(
      "trust zone must match tz_[a-z0-9][a-z0-9_-]{2,63} (--trust-zone, CARPEOS_TRUST_ZONE / CARPEOS_MCP_TRUST_ZONE, or config.json trust_zone_id)",
    );
  }
  return new LocalCaptureStore({
    runtimeDir,
    workspaceRoot: process.cwd(),
    ...(options.projectId === undefined ? {} : { explicitProjectId: options.projectId }),
    ...(resolution.trustZoneId === undefined ? {} : { trustZoneId: resolution.trustZoneId }),
  });
}

/**
 * Resolve the active trust zone for a CLI command.
 *
 * Precedence:
 * 1. explicit `--trust-zone`
 * 2. `CARPEOS_TRUST_ZONE` or `CARPEOS_MCP_TRUST_ZONE` (installer writes the latter)
 * 3. `~/.carpeos/config.json` `trust_zone_id` (installer default `tz_local_default`)
 * 4. omit → LocalCaptureStore device-derived `tz_local_<client_suffix>`
 */
function resolveTrustZoneResolution(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
): TrustZoneResolution {
  if (explicit !== undefined) {
    return { trustZoneId: explicit, source: "flag" };
  }
  const fromEnv = firstConfigured(env.CARPEOS_TRUST_ZONE, env.CARPEOS_MCP_TRUST_ZONE);
  if (fromEnv !== undefined) {
    return { trustZoneId: fromEnv, source: "env" };
  }
  const fromConfig = readTrustZoneFromHomeConfig(runtimeDir);
  if (fromConfig !== undefined) {
    return { trustZoneId: fromConfig, source: "config" };
  }
  return { trustZoneId: undefined, source: "device_default" };
}

function readTrustZoneFromHomeConfig(runtimeDir: string): string | undefined {
  try {
    const raw = readFileSync(join(runtimeDir, "config.json"), "utf8");
    const parsed = JSON.parse(raw) as { trust_zone_id?: unknown };
    if (typeof parsed.trust_zone_id === "string" && parsed.trust_zone_id.trim().length > 0) {
      return parsed.trust_zone_id.trim();
    }
  } catch {
    // Missing or unreadable config is fine; fall through to device default.
  }
  return undefined;
}

function isHelpToken(value: string | undefined): boolean {
  return value === "--help" || value === "-h" || value === "help";
}

function isVersionToken(value: string | undefined): boolean {
  return value === "--version" || value === "-V";
}

function splitCommand(argv: readonly string[]): {
  command: string | undefined;
  rest: readonly string[];
} {
  if (argv.length === 0) {
    return { command: undefined, rest: [] };
  }
  const [head, ...tail] = argv;
  // `carpeos --version` / `-V`
  if (isVersionToken(head)) {
    return { command: "version", rest: tail };
  }
  // `carpeos --help`, `carpeos -h`, `carpeos help [topic]`
  if (isHelpToken(head)) {
    if (head === "help") {
      return { command: "help", rest: tail };
    }
    // `--help` / `-h` always mean root help (flags after are ignored)
    return { command: "help", rest: [] };
  }
  return { command: head, rest: tail };
}

function runVersion(argv: readonly string[]): number {
  for (const arg of argv) {
    // Output is always JSON; --json is accepted as a no-op for scripting symmetry.
    if (arg === "--json") continue;
    throw new CliUsageError(`unexpected argument for version: ${arg}\nRun: carpeos help version`);
  }
  writeJson(process.stdout, {
    ok: true,
    command: "version",
    name: packageName(),
    version: packageVersion(),
    node: process.version,
  });
  return 0;
}

/**
 * Product 6 agentic operator surface (post-capture brain). Never runs inside capture.
 * Subcommands: status | run | golden | list-held | materialize
 */
async function runAgentic(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || isHelpToken(subcommand)) {
    throw new CliUsageError(
      "agentic requires a subcommand (status|run|golden|list-held|materialize|precision|graph-metrics). See: carpeos help agentic",
    );
  }

  switch (subcommand) {
    case "status": {
      const parsed = parseArgs({
        args: [...rest],
        options: {
          home: { type: "string" },
          "trust-zone": { type: "string" },
          "project-id": { type: "string" },
        },
        allowPositionals: false,
        strict: true,
      });
      const options = compactCommonOptions(
        parsed.values.home,
        parsed.values["project-id"],
        parsed.values["trust-zone"],
      );
      const runtimeDir = options.home ?? runtimeDirFromEnv(env);
      const agenticEnabled = env.CARPEOS_AGENTIC !== "0" && env.CARPEOS_AGENTIC !== "off";
      const db = openAgenticDb(runtimeDir);
      try {
        const jobs = countAgenticJobs(db, options.trustZone);
        const proposals = listAgenticProposals(db, {
          ...(options.trustZone !== undefined ? { trust_zone_id: options.trustZone } : {}),
          limit: 200,
        });
        const byGate = { hold: 0, promote: 0, reject: 0 };
        for (const p of proposals) {
          byGate[p.gate.decision] += 1;
        }
        writeJson(process.stdout, {
          ok: true,
          command: "agentic.status",
          plane: AGENTIC_PLANE,
          policy_version: AGENTIC_POLICY_VERSION,
          model_id: AGENTIC_FLASH_MODEL_ID,
          agentic_enabled: agenticEnabled,
          network_disabled_by_default: true,
          capture_llm: false,
          auto_acceptance_decision: false,
          jobs,
          proposals: {
            listed: proposals.length,
            by_gate: byGate,
          },
          agentic_db: agenticDbPath(runtimeDir),
        });
        return 0;
      } finally {
        db.close();
      }
    }
    case "run": {
      const parsed = parseArgs({
        args: [...rest],
        options: {
          home: { type: "string" },
          "trust-zone": { type: "string" },
          "project-id": { type: "string" },
          once: { type: "boolean", default: true },
          "allow-network": { type: "boolean", default: false },
          materialize: { type: "boolean", default: true },
          "allow-auto-promote": { type: "boolean", default: false },
          "spend-cap-usd": { type: "string" },
          text: { type: "string" },
          "source-event-id": { type: "string" },
          "hook-event": { type: "string" },
          golden: { type: "boolean", default: false },
          "golden-path": { type: "string" },
          limit: { type: "string" },
        },
        allowPositionals: false,
        strict: true,
      });
      const options = compactCommonOptions(
        parsed.values.home,
        parsed.values["project-id"],
        parsed.values["trust-zone"],
      );
      const runtimeDir = options.home ?? runtimeDirFromEnv(env);
      const agenticEnabled = env.CARPEOS_AGENTIC !== "0" && env.CARPEOS_AGENTIC !== "off";
      const allowNetwork = parsed.values["allow-network"] === true;
      if (allowNetwork && !(env.DEEPSEEK_API_KEY ?? "").trim()) {
        throw new CliUsageError(
          "agentic run --allow-network requires DEEPSEEK_API_KEY in the environment (never commit keys).",
        );
      }
      const db = openAgenticDb(runtimeDir);
      try {
        if (parsed.values.golden === true || parsed.values["golden-path"] !== undefined) {
          const goldenPath =
            parsed.values["golden-path"] ??
            resolve(process.cwd(), "fixtures/agentic/v1/golden-12/manifest.json");
          const manifest = loadGoldenManifest(goldenPath);
          const report = evaluateGoldenManifest(db, manifest, {
            ...(options.trustZone !== undefined ? { trust_zone_id: options.trustZone } : {}),
            agentic_enabled: agenticEnabled,
          });
          writeJson(process.stdout, {
            ok: report.pass,
            command: "agentic.run.golden",
            report,
            agentic_enabled: agenticEnabled,
            network_used: report.network_used,
            canonical_effect: "none",
          });
          return report.pass ? 0 : 1;
        }

        const text = parsed.values.text;
        if (text !== undefined && text.trim().length > 0) {
          // Manual one-shot on operator-provided text (no capture feed).
          const trust_zone_id = options.trustZone ?? "tz_local_default";
          const result = runAgenticProposalPipeline(db, {
            trust_zone_id,
            source_event_id: parsed.values["source-event-id"] ?? `evt_cli_${Date.now()}`,
            hook_event_name: parsed.values["hook-event"] ?? "SessionEnd",
            signal_text: text,
            agentic_enabled: agenticEnabled,
            mode: allowNetwork ? "flash" : "fake",
            allow_network: allowNetwork,
            allow_auto_promote: parsed.values["allow-auto-promote"] === true,
          });
          writeJson(process.stdout, {
            ok: result.ok,
            command: "agentic.run.text",
            result,
            model_id: AGENTIC_FLASH_MODEL_ID,
            network_used: result.network_used,
            canonical_effect: "none",
          });
          return result.ok ? 0 : 1;
        }

        // Default product path: drain capture feed + lease jobs + optional materialize.
        const store = openStore(options, env);
        try {
          const spendCap = Number(parsed.values["spend-cap-usd"] ?? "1");
          const limit = Number(parsed.values.limit ?? "20");
          const report = await processAgenticOnce({
            store,
            agenticDb: db,
            allow_network: allowNetwork,
            agentic_enabled: agenticEnabled,
            materialize: parsed.values.materialize !== false,
            allow_auto_promote: parsed.values["allow-auto-promote"] === true,
            limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20,
            spend: createFlashSpendState({
              spend_cap_usd: Number.isFinite(spendCap) && spendCap > 0 ? spendCap : 1,
            }),
            // E9: rebuild retrieval + graph_v2 projection after materialize (never SoT).
            on_project: () => {
              withLocalRetrievalDatabase(store, (retrievalDb) =>
                rebuildLocalRetrievalIndex(retrievalDb, new Date()),
              );
            },
          });
          writeJson(process.stdout, {
            ok: report.ok,
            command: "agentic.run",
            once: true,
            report,
            model_id: AGENTIC_FLASH_MODEL_ID,
            allow_network: allowNetwork,
            network_used: report.network_used,
            structure_edge_count: report.structure_edge_count,
            project_invoked: report.project_invoked,
          });
          return report.ok ? 0 : 1;
        } finally {
          store.close();
        }
      } finally {
        db.close();
      }
    }
    case "list-held": {
      const parsed = parseArgs({
        args: [...rest],
        options: {
          home: { type: "string" },
          "trust-zone": { type: "string" },
          limit: { type: "string" },
        },
        allowPositionals: false,
        strict: true,
      });
      const options = compactCommonOptions(
        parsed.values.home,
        undefined,
        parsed.values["trust-zone"],
      );
      const runtimeDir = options.home ?? runtimeDirFromEnv(env);
      const db = openAgenticDb(runtimeDir);
      try {
        const limit = Number(parsed.values.limit ?? "50");
        const held = listAgenticHeldProposals(
          db,
          options.trustZone,
          Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50,
        );
        writeJson(process.stdout, {
          ok: true,
          command: "agentic.list-held",
          policy_version: AGENTIC_POLICY_VERSION,
          count: held.length,
          proposals: held.map((p) => ({
            proposal_id: p.proposal_id,
            source_event_id: p.source_event_id,
            kind: p.candidate.kind,
            statement: p.candidate.statement,
            gate: p.gate.decision,
            reason_codes: p.gate.reason_codes,
            materialized_event_id: p.materialized_event_id,
          })),
        });
        return 0;
      } finally {
        db.close();
      }
    }
    case "precision": {
      const parsed = parseArgs({
        args: [...rest],
        options: {
          home: { type: "string" },
          path: { type: "string" },
        },
        allowPositionals: false,
        strict: true,
      });
      const runtimeDir = parsed.values.home ?? runtimeDirFromEnv(env);
      const goldenPath =
        parsed.values.path ?? resolve(process.cwd(), "fixtures/agentic/v1/golden-12/manifest.json");
      const db = openAgenticDb(runtimeDir);
      try {
        const report = evaluateAutoPromotePrecisionFromPath(db, goldenPath);
        writeJson(process.stdout, {
          ok: report.pass,
          command: "agentic.precision",
          report: {
            schema: report.schema,
            pass: report.pass,
            precision: report.precision,
            precision_min: report.precision_min,
            promote_count: report.promote_count,
            true_promote_count: report.true_promote_count,
            false_promote_count: report.false_promote_count,
            must_not_promote_leaks: report.must_not_promote_leaks,
            case_count: report.case_count,
            reason_codes: report.reason_codes,
          },
          path: goldenPath,
        });
        return report.pass ? 0 : 1;
      } finally {
        db.close();
      }
    }
    case "materialize": {
      const parsed = parseArgs({
        args: [...rest],
        options: {
          home: { type: "string" },
          "trust-zone": { type: "string" },
          "proposal-id": { type: "string" },
          "artifact-id": { type: "string" },
          "allow-promote": { type: "boolean", default: false },
        },
        allowPositionals: false,
        strict: true,
      });
      const proposalId = parsed.values["proposal-id"];
      const artifactId = parsed.values["artifact-id"];
      if (proposalId === undefined || artifactId === undefined) {
        throw new CliUsageError(
          "agentic materialize requires --proposal-id <id> and --artifact-id <id>",
        );
      }
      const options = compactCommonOptions(
        parsed.values.home,
        undefined,
        parsed.values["trust-zone"],
      );
      const runtimeDir = options.home ?? runtimeDirFromEnv(env);
      const db = openAgenticDb(runtimeDir);
      const store = openStore(options, env);
      try {
        const proposal = getAgenticProposal(db, proposalId);
        if (proposal === undefined) {
          throw new CliUsageError(`proposal not found: ${proposalId}`);
        }
        const mat = materializeAgenticProposal({
          store,
          agenticDb: db,
          proposal,
          artifact_id: artifactId,
          allow_promote_materialize: parsed.values["allow-promote"] === true,
        });
        writeJson(process.stdout, {
          ok: mat.ok,
          command: "agentic.materialize",
          result: mat,
        });
        return mat.ok ? 0 : 1;
      } finally {
        store.close();
        db.close();
      }
    }
    case "golden": {
      const parsed = parseArgs({
        args: [...rest],
        options: {
          home: { type: "string" },
          path: { type: "string" },
          "trust-zone": { type: "string" },
        },
        allowPositionals: false,
        strict: true,
      });
      const options = compactCommonOptions(
        parsed.values.home,
        undefined,
        parsed.values["trust-zone"],
      );
      const runtimeDir = options.home ?? runtimeDirFromEnv(env);
      const goldenPath =
        parsed.values.path ?? resolve(process.cwd(), "fixtures/agentic/v1/golden-12/manifest.json");
      const db = openAgenticDb(runtimeDir);
      try {
        const report = evaluateGoldenManifest(db, loadGoldenManifest(goldenPath), {
          ...(options.trustZone !== undefined ? { trust_zone_id: options.trustZone } : {}),
          agentic_enabled: env.CARPEOS_AGENTIC !== "0" && env.CARPEOS_AGENTIC !== "off",
        });
        writeJson(process.stdout, {
          ok: report.pass,
          command: "agentic.golden",
          report,
          path: goldenPath,
        });
        return report.pass ? 0 : 1;
      } finally {
        db.close();
      }
    }
    case "graph-metrics": {
      const parsed = parseArgs({
        args: [...rest],
        options: {
          home: { type: "string" },
          "trust-zone": { type: "string" },
          "project-id": { type: "string" },
          rebuild: { type: "boolean", default: true },
        },
        allowPositionals: false,
        strict: true,
      });
      const options = compactCommonOptions(
        parsed.values.home,
        parsed.values["project-id"],
        parsed.values["trust-zone"],
      );
      const store = openStore(options, env);
      try {
        if (parsed.values.rebuild !== false) {
          withLocalRetrievalDatabase(store, (retrievalDb) =>
            rebuildLocalRetrievalIndex(retrievalDb, new Date()),
          );
        }
        const events = store
          .listCanonicalEventSnapshots({
            visibleTrustZoneIds: [store.trustZone.trust_zone_id],
          })
          .map((row) => row.event);
        const snapshot = buildGraphProjection({
          events,
          origins: new Map(),
        });
        const metrics = computeGraphDensityMetrics(snapshot);
        writeJson(process.stdout, {
          ok: true,
          command: "agentic.graph-metrics",
          trust_zone_id: store.trustZone.trust_zone_id,
          project_id: store.projectId,
          metrics,
          rebuilt: parsed.values.rebuild !== false,
        });
        return 0;
      } finally {
        store.close();
      }
    }
    default:
      throw new CliUsageError(
        `unknown agentic subcommand: ${subcommand}\nRun: carpeos help agentic`,
      );
  }
}

function agenticDbPath(runtimeDir: string): string {
  return join(runtimeDir, "agentic", "agentic.sqlite");
}

function openAgenticDb(runtimeDir: string): DatabaseSync {
  const path = agenticDbPath(runtimeDir);
  mkdirSync(join(runtimeDir, "agentic"), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  migrateAgenticJobs(db);
  migrateAgenticProposals(db);
  return db;
}

/**
 * V5 draft-only operator surface (opt-in). Never touches capture hot path or canonical write APIs.
 * Subcommands: status | readiness | eval-all200 | draft | m8
 */
async function runV5(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  void env;
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || isHelpToken(subcommand)) {
    throw new CliUsageError(
      "v5 requires a subcommand (status|readiness|eval-all200|draft|m8). See: carpeos help v5",
    );
  }

  switch (subcommand) {
    case "status": {
      if (rest.length > 0) {
        throw new CliUsageError(`unexpected argument for v5 status: ${rest[0]}`);
      }
      const provider = new ProviderBoundary();
      const route = provider.defaultExtractRoute();
      writeJson(process.stdout, {
        ok: true,
        command: "v5.status",
        opt_in: true,
        draft_only: true,
        canonical_effect: "none",
        network_disabled_by_default: true,
        primary_provider: route.provider_id,
        primary_model: route.model_id,
        primary_profile: route.profile_id,
        openrouter_required: false,
        capture_hot_path_wired: false,
        m8_status: "deferred",
      });
      return 0;
    }
    case "readiness": {
      if (rest.length > 0) {
        throw new CliUsageError(`unexpected argument for v5 readiness: ${rest[0]}`);
      }
      const provider = new ProviderBoundary();
      const deepseek_primary = provider.defaultExtractRoute().provider_id === "deepseek_direct";
      const v5_off = verifyV5OffReleasePath({
        v5_enabled: false,
        provider_network_used: false,
        canonical_writes: 0,
        telemetry_db_only: true,
      });
      const m8 = decideM8({
        opt_in: true,
        v5_off_release_path_verified: v5_off.pass,
        four_zero_seam: null,
      });
      const all200 = runAll200Evaluation();
      const readiness = v5DraftLaneReadiness({
        m0_pass: true,
        pipeline_offline_pass: true,
        deepseek_primary,
        telemetry_local_store_pass: true,
        v5_off_path_pass: v5_off.pass,
        m8,
      });
      writeJson(process.stdout, {
        ok: readiness.ready && all200.pass,
        command: "v5.readiness",
        readiness,
        m7_all200: {
          pass: all200.pass,
          case_count: all200.case_count,
          quality_rate: all200.gates.quality_rate,
        },
        m8,
        canonical_effect: "none",
      });
      return readiness.ready && all200.pass ? 0 : 1;
    }
    case "eval-all200": {
      if (rest.length > 0) {
        throw new CliUsageError(`unexpected argument for v5 eval-all200: ${rest[0]}`);
      }
      const receipt = runAll200Evaluation();
      writeJson(process.stdout, {
        ok: receipt.pass,
        command: "v5.eval-all200",
        receipt,
      });
      return receipt.pass ? 0 : 1;
    }
    case "draft": {
      const parsed = parseArgs({
        args: rest,
        allowPositionals: false,
        strict: true,
        options: {
          envelope: { type: "string" },
          "pack-id": { type: "string" },
          "allow-network": { type: "boolean", default: false },
        },
      });
      const envelopePath = parsed.values.envelope;
      if (typeof envelopePath !== "string" || envelopePath.length === 0) {
        throw new CliUsageError(
          "v5 draft requires --envelope <path-to-raw-outer-json-or-b64-file>",
        );
      }
      const packId =
        typeof parsed.values["pack-id"] === "string" && parsed.values["pack-id"].length > 0
          ? parsed.values["pack-id"]
          : "pack-cli-draft";
      const allowNetwork = parsed.values["allow-network"] === true;
      const rawText = readFileSync(resolve(envelopePath), "utf8").trim();
      let rawOuter: Uint8Array;
      try {
        // Prefer JSON outer object bytes; if single base64 line, decode that.
        if (rawText.startsWith("{")) {
          rawOuter = Buffer.from(rawText, "utf8");
        } else {
          rawOuter = Buffer.from(rawText, "base64");
        }
      } catch {
        throw new CliUsageError("v5 draft: could not read envelope as JSON object or base64");
      }

      const provider = new ProviderBoundary({
        kill: {
          network_disabled: !allowNetwork,
        },
      });
      const deps = createDraftPipelineDeps({ provider, v5_enabled: true });
      const result = await runDraftPipeline(
        rawOuter,
        {
          pack_id: packId,
          prefer_deepseek_direct: true,
        },
        deps,
      );
      writeJson(process.stdout, {
        ok: result.ok,
        command: "v5.draft",
        stage: result.stage,
        errors: result.errors,
        provider_network_used: result.provider_network_used,
        pack_digest: result.pack?.pack_digest ?? null,
        draft_status: result.draft?.status ?? null,
        proposal_id: result.draft?.proposal_id ?? null,
        canonical_effect: result.canonical_effect,
        // Body-free: do not dump redaction values / provider bodies
      });
      return result.ok ? 0 : 1;
    }
    case "m8": {
      if (rest.length > 0) {
        throw new CliUsageError(`unexpected argument for v5 m8: ${rest[0]}`);
      }
      // Resolve monorepo root when running from apps/carpeos-cli/dist
      const repoRoot = resolve(import.meta.dirname, "../../..");
      const decision = buildFinalV5Decision({
        repoRoot,
        opt_in: true,
      });
      writeJson(process.stdout, {
        ok: decision.draft_lane_shippable,
        command: "v5.m8",
        decision,
      });
      return decision.draft_lane_shippable ? 0 : 1;
    }
    default:
      throw new CliUsageError(`unknown v5 subcommand: ${subcommand}\nRun: carpeos help v5`);
  }
}

/** Root help text for humans and agents. Keep in sync with real commands. */
export function formatRootHelp(): string {
  return `carpeos — local knowledge OS CLI (capture, memory, sync)

USAGE
  carpeos <command> [options]
  carpeos help [command]
  carpeos --help

MACHINE SETUP (npm package entry — not the monorepo CLI bundle)
  carpeos setup plan|run|doctor|show|help
  carpeos setup run --apply
  carpeos setup --help

COMMANDS
  version              Print package name + version (JSON)
  init                 Initialize local runtime store (~/.carpeos by default)
  project identify     Print resolved project_id / client_id / trust zone
  capture-hook         Ingest a provider hook envelope (claude|codex|grok|gjc|deepcode|reasonix|deepseek_build)
  extract              Extract Observation from an EvidenceArtifact event (via adjudicate)
  adjudicate           Knowledge adjudication and preview-only policy reconciliation
  outbox               Local durable outbox (status|lease|ack|retry)
  sync                 Push/pull with a remote sync edge (status|push|pull|once|cycle)
  retrieval            Rebuild local retrieval index or run embed jobs
  memory               Search / get / context-pack over local memory
  okf                  Export OKF v0.2 (export|rebuild; explicit zones; held off; no canonical mutation)
  v5                   Opt-in draft-only lane (status|readiness|eval-all200|draft); DeepSeek primary; not capture
  agentic              Product 6 post-capture brain (status|run|golden); Flash-only; not capture
  help                 Show this help or help for a command

COMMON OPTIONS (most store commands)
  --home <path>        Runtime home (default: $CARPEOS_HOME or ~/.carpeos)
  --project-id <id>    Override project id
  --trust-zone <id>    Trust zone (tz_…). Default: flag → CARPEOS_TRUST_ZONE /
                       CARPEOS_MCP_TRUST_ZONE → config.json → device-local tz

GLOBAL FLAGS
  -h, --help           Show help
  -V, --version        Same as: carpeos version

EXAMPLES
  carpeos version
  carpeos init --home "$HOME/.carpeos" --trust-zone tz_local_default
  carpeos memory context-pack \\
    --task "Summarize current work" \\
    --trust-zone tz_local_default \\
    --visible-trust-zone tz_local_default
  carpeos outbox status --home "$HOME/.carpeos"
  carpeos help memory
  carpeos okf export --out ./okf --visible-trust-zone tz_local_default

OUTPUT
  Successful command results are JSON on stdout.
  Help is plain text on stdout with exit code 0.
  Errors are JSON on stderr.

EXIT CODES
  0   success (including help)
  1   retryable failure or internal error
  2   invalid usage / validation
  3   idempotency conflict
  4   non-retryable sync / remote block

Docs: https://github.com/innocarpe/carpeos#readme
v1 readiness: https://github.com/innocarpe/carpeos/blob/main/docs/maintainers/v1-readiness.md
`;
}

export function formatCommandHelp(command: string): string {
  switch (command) {
    case "agentic":
      return `carpeos agentic — Product 6 post-capture Agentic Layer (ADR 0017)

USAGE
  carpeos agentic status [--home <path>] [--trust-zone <id>]
  carpeos agentic run --once [--materialize] [--allow-network] [--limit N]
  carpeos agentic run --once --text <signal> [--hook-event SessionEnd]
  carpeos agentic run --once --golden [--golden-path <manifest.json>]
  carpeos agentic golden [--path <manifest.json>]
  carpeos agentic list-held [--limit N]
  carpeos agentic materialize --proposal-id <id> --artifact-id <id> [--allow-promote]
  carpeos agentic precision [--path <golden-manifest.json>]
  carpeos agentic graph-metrics [--home <path>] [--rebuild]

SUBCOMMANDS
  status       Job + proposal counts; plane fences (Flash-only, no capture LLM)
  run          Drain capture feed → stages → optional materialize (default product path)
  golden       Evaluate fixtures/agentic/v1/golden-12 offline
  list-held    List agentic_v1 hold proposals for human review
  materialize  Materialize one proposal to draft Observation + disposition
  precision    P3 offline auto-promote precision suite (must ≥ 0.90; zero must_not leaks)
  graph-metrics  P4 meaning graph density (rebuild graph_v2; projection only)

HARD FENCES
  - Capture inserts feed only (no LLM/network/await in capture transaction)
  - Real model id only: deepseek-v4-flash (live requires --allow-network + DEEPSEEK_API_KEY)
  - No automatic AcceptanceDecision
  - Kill switch: CARPEOS_AGENTIC=0|off (skips feed + runner)
  - Sidecar DB: <home>/agentic/agentic.sqlite

See: docs/adr/0017-agentic-layer-write-time-knowledge.md, docs/maintainers/v6-milestones.md
`;
    case "v5":
      return `carpeos v5 — opt-in draft-only lane (DeepSeek Direct primary)

USAGE
  carpeos v5 status
  carpeos v5 readiness
  carpeos v5 eval-all200
  carpeos v5 m8
  carpeos v5 draft --envelope <path> [--pack-id <id>] [--allow-network]

SUBCOMMANDS
  status         Print primary provider/model and fence summary (JSON)
  readiness      Draft-lane readiness + M7 all-200 summary + M8 deferred status
  eval-all200    Run frozen 200-case offline evaluation ledger
  m8             Classify body-free 4.0 receipt refs + final draft-lane decision (no invented accept)
  draft          Run redact→pack→extract→reduce pipeline on a synthetic envelope file
                 Network stays off unless --allow-network (requires DEEPSEEK_API_KEY)

HARD FENCES
  - Does not write CanonicalEvents, outbox, sequences, or retrieval authority
  - Does not run inside capture-hook
  - canonical_effect is always "none"
  - OpenRouter is not required

See: docs/PRD-v5.md, docs/maintainers/v5-milestones.md, docs/adr/0016-v5-draft-only-deepseek-primary.md
`;
    case "version":
      return `carpeos version — print the installed package version

USAGE
  carpeos version
  carpeos --version
  carpeos -V

OUTPUT (JSON on stdout)
  {
    "ok": true,
    "command": "version",
    "name": "@innocarpe/carpeos",
    "version": "X.Y.Z",
    "node": "v22.…"
  }

EXIT CODES
  0   success
`;
    case "init":
      return `carpeos init — create/open the local runtime store

USAGE
  carpeos init [--home <path>] [--project-id <id>] [--trust-zone <id>]

OPTIONS
  --home <path>        Runtime directory (default: $CARPEOS_HOME or ~/.carpeos)
  --project-id <id>    Explicit project id (otherwise derived from cwd/git)
  --trust-zone <id>    Trust zone id (tz_[a-z0-9][a-z0-9_-]{2,63})

EXAMPLES
  carpeos init --trust-zone tz_local_default
  carpeos init --home "$HOME/.carpeos" --trust-zone tz_local_default
`;
    case "project":
      return `carpeos project — project identity helpers

USAGE
  carpeos project identify [--home <path>] [--project-id <id>] [--trust-zone <id>]

SUBCOMMANDS
  identify             Print project_id, client_id, trust_zone_id for this runtime

OPTIONS
  --home <path>
  --project-id <id>
  --trust-zone <id>
`;
    case "extract":
      return `carpeos extract — EvidenceArtifact → Observation (via adjudication)

USAGE
  carpeos extract --event-id <evt_…> [options]

OPTIONS
  --event-id <id>           EvidenceArtifact event_id to extract from
  --home <path>             Runtime home (default: $CARPEOS_HOME or ~/.carpeos)
  --project-id <id>         Project identity
  --trust-zone <id>         Trust zone

NOTES
  Runs knowledge adjudication (promote|hold|reject). Reject skips meaning units.
  Statements may include a bounded safe candidate fragment; raw transcript text stays protected.
  Idempotent: re-running the same event_id replays disposition + Observation.
`;
    case "adjudicate":
      return `carpeos adjudicate — promote | hold | reject evidence as knowledge

USAGE
  carpeos adjudicate --event-id <evt_…> [options]
  carpeos adjudicate --stats [options]
  carpeos adjudicate list-held [--limit <n>] [options]
  carpeos adjudicate history --event-id <evt_…> [options]
  carpeos adjudicate promote-held --event-id <evt_…> [options]
  carpeos adjudicate reject-held --event-id <evt_…> [options]
  carpeos adjudicate reconcile-policy --from-policy <id> --to-policy <id> --trust-zone <id> --limit <n>

OPTIONS
  --event-id <id>           EvidenceArtifact event_id to adjudicate, review, or history
  --signal-text <text>      Optional free-text signal for scoring only
  --policy-version <id>     Disposition policy identity; held review defaults to current (${ADJUDICATION_POLICY_VERSION})
  --stats                   Print promote/hold/reject counts for current policy
  --from-policy <id>         Reconciliation source policy (reconcile-policy only)
  --to-policy <id>           Reconciliation target policy (reconcile-policy only)
  --trust-zone <id>          Required for reconciliation; otherwise opened-store zone
  --limit <n>                Reconciliation 1–200; held queue default 50
  --home <path>
  --project-id <id>

NOTES
  Precision-first rule adjudicator (adj_v3). Promote → active Observation;
  hold → draft Observation; reject → disposition only.
  Same evidence + same policy_version is replay-safe. A new --policy-version
  appends a new disposition without rewriting prior rows; active search uses
  Observations produced by each promote path (default filter remains active).
  Held review is terminal and append-only per source event + policy version.
  Held receipts are metadata-only and bounded to the requested policy.
  promote-held appends a new active Observation; reject-held records review only.
  reconcile-policy is a metadata-only preview; apply, acknowledgements, receipts,
  and Supersession construction are unavailable.
  Neither path creates an AcceptanceDecision.
  Prefer: carpeos adjudicate after capture sessions (hooks stay fail-open).
`;
    case "capture-hook":
      return `carpeos capture-hook — ingest a provider session hook (no plaintext secrets in stdout)

USAGE
  carpeos capture-hook --provider <claude|codex|grok|gjc|deepcode|reasonix|deepseek_build> [options]
  # hook JSON on stdin by default

OPTIONS
  --provider <name>          claude|codex|grok|gjc|deepcode|reasonix|deepseek_build (required)

  --input stdin|argv         Default: stdin. argv expects one JSON positional
  --fail-open                Exit 0 on capture failure (provider must continue)
  --quiet                    Suppress success JSON on stdout
  --idempotency-key <key>    idem_[A-Za-z0-9_-]{16,128}
  --home <path>
  --project-id <id>
  --trust-zone <id>

EXAMPLES
  --no-extract              Skip Observation extraction (default: extract when eligible)

  cat hook.json | carpeos capture-hook --provider codex --fail-open
  carpeos capture-hook --provider claude --input argv '{"hook_event_name":"Stop"}'
`;
    case "outbox":
      return `carpeos outbox — durable local delivery queue

USAGE
  carpeos outbox <status|lease|ack|retry> [options]

SUBCOMMANDS
  status               Counts: pending / leased / delivered
  lease                Lease pending items
  ack                  Acknowledge a leased item
  retry                Re-queue a leased item after failure

OPTIONS
  --home <path>
  --project-id <id>
  --trust-zone <id>
  --limit <n>          lease (default 10)
  --lease-ms <n>       lease duration (default 30000)
  --outbox-id <n>      ack / retry
  --lease-id <id>      ack / retry
  --delay-ms <n>       retry delay (default 1000)
  --error <text>       retry error message

EXAMPLES
  carpeos outbox status
  carpeos outbox lease --limit 5 --lease-ms 30000
  carpeos outbox ack --outbox-id 1 --lease-id lease_…
`;
    case "sync":
      return `carpeos sync — push/pull against a remote sync edge

USAGE
  carpeos sync <status|push|pull|once|cycle|credential-hash> [options]

SUBCOMMANDS
  status               Local outbox + cursor + whether credentials are configured
  push                 Push leased outbox items
  pull                 Pull remote pages into the local store
  once                 push then pull
  cycle                Bounded fail-closed one-run sync + retrieval rebuild
  credential-hash      SHA-256 of the sync credential file (for operator checks)

OPTIONS
  --home <path>
  --project-id <id>
  --trust-zone <id>
  --url <url>          Or $CARPEOS_SYNC_URL
  --credential-file <path>
  --sync-key-file <path>
  --limit <n>          push/once/cycle iterations (default 1)
  --max-pages <n>      pull/once/cycle pages (default 1)
  --lease-ms <n>
  --retry-delay-ms <n>
  --pull-limit <n>
  --json               cycle accepts this as an explicit JSON-output no-op

EXAMPLES
  carpeos sync status
  carpeos sync once --url https://… --credential-file … --sync-key-file …
  carpeos sync cycle --url https://… --credential-file … --sync-key-file … --limit 1 --max-pages 1

NOTES
  cycle is one foreground run. Launch scheduling is planned separately.
`;
    case "retrieval":
      return `carpeos retrieval — local retrieval index maintenance

USAGE
  carpeos retrieval <rebuild|embed> --trust-zone <id> [options]

SUBCOMMANDS
  rebuild              Rebuild retrieval chunks from the event store
  embed                Deterministic local-dev embedding jobs only

OPTIONS
  --trust-zone <id>    Required
  --home <path>
  --project-id <id>
  --provider <name>    embed: local-lexical-hash (offline default)
  --limit <n>
  --lease-ms <n>

EXAMPLES
  carpeos retrieval rebuild --trust-zone tz_local_default
  carpeos retrieval embed --trust-zone tz_local_default --provider local-lexical-hash
`;
    case "okf":
      return `carpeos okf — write an OKF v0.2 projection without canonical mutation

USAGE
  carpeos okf export --out <dir> --visible-trust-zone <id> [options]
  carpeos okf rebuild --out <dir> --visible-trust-zone <id> [options]

SUBCOMMANDS
  export               Build and write the projection-managed OKF bundle
  rebuild              Rebuild the projection-managed OKF bundle

OPTIONS
  --out <dir>                  Required output directory
  --visible-trust-zone <id>    Required; repeatable; must include the active trust zone
  --include-held               Include draft/held knowledge units (default: off)
  --home <path>
  --project-id <id>
  --trust-zone <id>

NOTES
  Both commands are projection-only filesystem exports: they never mutate canonical events.
  Explicit visible trust zones are required; promoted/active knowledge is exported by default.
`;
    case "memory":
      return `carpeos memory — query local memory (search / get / context-pack)

USAGE
  carpeos memory <search|get|context-pack> --trust-zone <id> --visible-trust-zone <id> [options]

SUBCOMMANDS
  search               Ranked retrieval by --query
  get                  Fetch one chunk by --chunk-id (visibility filtered)
  context-pack         Sparse expert-slot context pack for a --task

OPTIONS
  --trust-zone <id>              Required (active zone)
  --visible-trust-zone <id>      Required; repeatable; must include --trust-zone
  --home <path>
  --project-id <id>
  --query <text>                 search
  --chunk-id <id>                get
  --task <text>                  context-pack
  --limit <n>                    search (default 10)
  --max-items <n>                context-pack (default 16)
  --max-characters <n>           context-pack (default 8000)
  --protected-value-policy <p>   metadata_only | allow_decrypt | deny
                                 (default metadata_only)
  --include-held               Include draft/held knowledge units (default: off;
                                 search remains promoted/active only)
  --scope-project <id>         Restrict to a project partition (repeatable)
  --scope-worktree <wt_…>      Restrict to a worktree facet (repeatable)
  --all-worktrees              Disable the current-worktree ranking boost

EXAMPLES
  carpeos memory search \\
    --query "release checklist" \\
    --trust-zone tz_local_default \\
    --visible-trust-zone tz_local_default
  carpeos memory context-pack \\
    --task "What should I do next?" \\
    --trust-zone tz_local_default \\
    --visible-trust-zone tz_local_default
`;
    case "setup":
    case "doctor":
      return `carpeos setup — machine install / MCP registration (package entrypoint)

This command is handled by the npm package launcher (bin/carpeos.js), not the
monorepo CLI bundle alone.

USAGE
  carpeos setup plan
  carpeos setup run --apply
  carpeos setup doctor
  carpeos setup show
  carpeos setup --help

From a git checkout without the npm package:
  node scripts/install-local.mjs plan
  node scripts/install-local.mjs run --apply
  node scripts/install-local.mjs doctor
`;
    case "help":
      return formatRootHelp();
    default:
      return `Unknown help topic: ${command}

Run: carpeos --help
`;
  }
}

type SyncParsedValues = {
  url?: string;
  "credential-file"?: string;
  "sync-key-file"?: string;
  "lease-ms"?: string;
  "retry-delay-ms"?: string;
  "pull-limit"?: string;
};

type ResolvedCycleSyncConfig = Extract<ResolvedSyncConfig, { baseUrl: string }> & {
  credentialFile: string;
  syncKeyFile: string;
  preflight: CyclePreflight;
};

type ResolvedSyncConfig =
  | {
      urlConfigured: boolean;
      credentialFileConfigured: boolean;
      syncKeyFileConfigured: boolean;
    }
  | {
      baseUrl: string;
      bearerCredential: string;
      trustZoneSyncKey: Uint8Array;
      urlConfigured: true;
      credentialFileConfigured: true;
      syncKeyFileConfigured: true;
    };

function createSyncCoordinator(
  values: SyncParsedValues,
  env: NodeJS.ProcessEnv,
  store: LocalCaptureStore,
): OutboxSyncCoordinator {
  const config = resolveSyncConfig(values, env, store.runtimeDir, true);
  if (!("baseUrl" in config)) {
    throw new CliUsageError("sync credentials are required");
  }
  return createSyncCoordinatorFromConfig(values, store, config, globalThis.fetch);
}

function createSyncCoordinatorFromConfig(
  values: SyncParsedValues,
  store: LocalCaptureStore,
  config: Extract<ResolvedSyncConfig, { baseUrl: string }>,
  fetch: FetchLike,
): OutboxSyncCoordinator {
  return new OutboxSyncCoordinator({
    store,
    transport: new SyncHttpTransport({
      baseUrl: config.baseUrl,
      bearerCredential: config.bearerCredential,
      clientId: store.clientId,
      fetch,
    }),
    trustZoneSyncKey: config.trustZoneSyncKey,
    leaseMs: parseInteger(values["lease-ms"], "--lease-ms", 1),
    retryDelayMs: parseInteger(values["retry-delay-ms"], "--retry-delay-ms", 0),
    pullLimit: parseInteger(values["pull-limit"], "--pull-limit", 1),
  });
}

function resolveCycleSyncConfig(
  values: SyncParsedValues,
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
): ResolvedCycleSyncConfig {
  const url = firstConfigured(values.url, env.CARPEOS_SYNC_URL);
  if (url === undefined) {
    throw new CycleFailure("config_invalid", "preflight", 3, "sync URL is not configured");
  }
  const credentialFile =
    firstConfigured(
      values["credential-file"],
      env.CARPEOS_SYNC_CREDENTIAL_FILE,
      join(runtimeDir, "sync-credential"),
    ) ?? join(runtimeDir, "sync-credential");
  const syncKeyFile =
    firstConfigured(
      values["sync-key-file"],
      env.CARPEOS_SYNC_KEY_FILE,
      join(runtimeDir, "trust-zone-sync.key"),
    ) ?? join(runtimeDir, "trust-zone-sync.key");
  let baseUrl: string;
  try {
    baseUrl = normalizeSyncUrl(url);
  } catch {
    throw new CycleFailure("config_invalid", "preflight", 3, "sync URL is invalid");
  }
  let bearerCredential: string;
  let trustZoneSyncKey: Uint8Array;
  try {
    bearerCredential = readCredentialFile(credentialFile);
    trustZoneSyncKey = readSyncKeyFile(syncKeyFile);
  } catch {
    throw new CycleFailure("secret_invalid", "preflight", 4, "sync secret files are invalid");
  }
  return {
    baseUrl,
    bearerCredential,
    trustZoneSyncKey,
    urlConfigured: true,
    credentialFileConfigured: true,
    syncKeyFileConfigured: true,
    credentialFile,
    syncKeyFile,
    preflight: {
      syncUrlHashSha256: hashText(baseUrl),
      credentialFileHashSha256: hashPath(credentialFile),
      credentialSecretHashSha256: hashText(bearerCredential),
      syncKeyFileHashSha256: hashPath(syncKeyFile),
    },
  };
}

function resolveSyncConfig(
  values: SyncParsedValues,
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
  requireSecrets: false,
): Pick<ResolvedSyncConfig, "urlConfigured" | "credentialFileConfigured" | "syncKeyFileConfigured">;
function resolveSyncConfig(
  values: SyncParsedValues,
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
  requireSecrets: true,
): ResolvedSyncConfig;
function resolveSyncConfig(
  values: SyncParsedValues,
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
  requireSecrets: boolean,
): ResolvedSyncConfig {
  const url = firstConfigured(values.url, env.CARPEOS_SYNC_URL);
  const credentialFile =
    firstConfigured(
      values["credential-file"],
      env.CARPEOS_SYNC_CREDENTIAL_FILE,
      join(runtimeDir, "sync-credential"),
    ) ?? join(runtimeDir, "sync-credential");
  const syncKeyFile =
    firstConfigured(
      values["sync-key-file"],
      env.CARPEOS_SYNC_KEY_FILE,
      join(runtimeDir, "trust-zone-sync.key"),
    ) ?? join(runtimeDir, "trust-zone-sync.key");
  const baseStatus = {
    urlConfigured: url !== undefined,
    credentialFileConfigured: fileExists(credentialFile),
    syncKeyFileConfigured: fileExists(syncKeyFile),
  };
  if (!requireSecrets) {
    return baseStatus;
  }
  if (url === undefined) {
    throw new CliUsageError("sync requires --url or CARPEOS_SYNC_URL");
  }
  return {
    baseUrl: normalizeSyncUrl(url),
    bearerCredential: readCredentialFile(credentialFile),
    trustZoneSyncKey: readSyncKeyFile(syncKeyFile),
    urlConfigured: true,
    credentialFileConfigured: true,
    syncKeyFileConfigured: true,
  };
}

function readCredentialFile(path: string): string {
  assertSecretFile(path, "sync credential file");
  const credential = readFileSync(path, "utf8").trim();
  if (!/^[A-Za-z0-9._~:-]{32,512}$/.test(credential)) {
    throw new CliUsageError("sync credential file must contain one high-entropy token");
  }
  return credential;
}

function readSyncKeyFile(path: string): Uint8Array {
  assertSecretFile(path, "trust-zone sync key file");
  const raw = readFileSync(path, "utf8").trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return new Uint8Array(Buffer.from(raw, "hex"));
  }
  if (/^[A-Za-z0-9_-]{43}$/.test(raw)) {
    const decoded = Buffer.from(raw, "base64url");
    if (decoded.byteLength === 32) {
      return new Uint8Array(decoded);
    }
  }
  throw new CliUsageError(
    "trust-zone sync key file must contain a 32-byte key as 64-hex or base64url",
  );
}

function assertSecretFile(path: string, label: string): void {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    throw new CliUsageError(`${label} is required`);
  }
  if (!stat.isFile()) {
    throw new CliUsageError(`${label} must be a regular file`);
  }
  if ((stat.mode & 0o777) !== 0o600) {
    throw new CliUsageError(`${label} must use mode 0600`);
  }
}

function normalizeSyncUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliUsageError("sync URL must be an absolute http or https URL");
  }
  if (url.protocol === "https:") {
    return url.toString().replace(/\/+$/, "");
  }
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) {
    return url.toString().replace(/\/+$/, "");
  }
  throw new CliUsageError("sync URL must use https except for loopback local development");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireStoreTrustZone(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new CliUsageError("--trust-zone is required for retrieval and memory commands");
  }
  if (!isTrustZoneId(value)) {
    throw new CliUsageError("--trust-zone must match tz_[a-z0-9][a-z0-9_-]{2,63}");
  }
  return value;
}

function requireVisibleTrustZones(
  values: readonly string[] | undefined,
  storeTrustZone: string,
): string[] {
  if (values === undefined || values.length === 0) {
    throw new CliUsageError("memory commands require --visible-trust-zone");
  }
  for (const trustZoneId of values) {
    if (!isTrustZoneId(trustZoneId)) {
      throw new CliUsageError("--visible-trust-zone must match tz_[a-z0-9][a-z0-9_-]{2,63}");
    }
  }
  if (!values.includes(storeTrustZone)) {
    throw new CliUsageError("--visible-trust-zone must include the active --trust-zone");
  }
  return [...values];
}

function makeRetrievalQuery(input: {
  text: string;
  visibleTrustZones: readonly string[];
  limit: number;
  includeHeld?: boolean;
  projectIds?: readonly string[];
  worktreeIds?: readonly string[];
  boostWorktreeId?: string;
}): RetrievalQuery {
  return {
    schema_version: "v1",
    record_type: "retrieval_query",
    query_id: `query_${sha256Hex(input.text).slice(0, 24)}`,
    query_text: input.text,
    filters: {
      visible_trust_zone_ids: [...input.visibleTrustZones],
      // Product 2.0: default to promoted (active) meaning only; held draft is opt-in.
      lifecycle_status: input.includeHeld === true ? ["active", "draft"] : ["active"],
      // Capture writes EvidenceArtifact as epistemic_authority "imported".
      epistemic_authority: [
        "unverified",
        "self_reported",
        "observed",
        "imported",
        "derived",
        "verified",
      ],
      protected_value_policy: "metadata_only",
      conflict_policy: "surface_conflicts",
      // Partition and facet scoping; unknown-origin chunks are never excluded.
      ...(input.projectIds === undefined || input.projectIds.length === 0
        ? {}
        : { project_ids: [...input.projectIds] }),
      ...(input.worktreeIds === undefined || input.worktreeIds.length === 0
        ? {}
        : { worktree_ids: [...input.worktreeIds] }),
    },
    ranking: {
      mode: "hybrid",
      weights: { structured: 1, fts: 1, semantic: 1, recency: 0.1 },
      ...(input.boostWorktreeId === undefined ? {} : { boost_worktree_id: input.boostWorktreeId }),
    },
    limit: input.limit,
  };
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function firstConfigured(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

async function runBoundedSyncOnce(
  coordinator: OutboxSyncCoordinator,
  store: LocalCaptureStore,
  bounds: { limit: number; maxPages: number },
): Promise<{
  exitCode: number;
  pushed: unknown[];
  pulled: Awaited<ReturnType<OutboxSyncCoordinator["pullPage"]>>[];
}> {
  const pushed = [];
  let exitCode = 0;
  for (let index = 0; index < bounds.limit; index += 1) {
    const result = await coordinator.pushOne();
    if (result === undefined) {
      break;
    }
    pushed.push(redactPushResult(result));
    if (result.status !== "acked") {
      exitCode = result.status === "retried" ? Math.max(exitCode, 1) : 4;
      break;
    }
  }
  const pulled = [];
  if (exitCode === 0) {
    for (let index = 0; index < bounds.maxPages; index += 1) {
      const page = await coordinator.pullPage();
      pulled.push(page);
      if (!page.has_more) {
        break;
      }
    }
  }
  // Keep the store parameter explicit because the helper is the shared boundary for
  // store-mutating sync phases.
  void store;
  return { exitCode, pushed, pulled };
}

function redactPushResult(result: Awaited<ReturnType<OutboxSyncCoordinator["pushOne"]>>): unknown {
  if (result === undefined) {
    return undefined;
  }
  if (result.status === "acked") {
    return {
      status: result.status,
      outbox_id: result.outbox_id,
      remote_status: result.remote_status,
      accepted_event_ids: result.result.accepted_event_ids,
      accepted_erasure_ids: result.result.accepted_erasure_ids,
    };
  }
  if (result.status === "retried") {
    return { status: result.status, outbox_id: result.outbox_id, error: result.error };
  }
  return {
    status: result.status,
    outbox_id: result.outbox_id,
    reason: result.reason,
    remote_status: result.result?.status,
    conflict_with: result.result?.conflict_with,
  };
}

function parseArgvInput(positionals: readonly string[]): string {
  if (positionals.length !== 1) {
    throw new CliUsageError("--input argv requires exactly one JSON positional argument");
  }
  return positionals[0] ?? "";
}

function parseJsonObject(value: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HookInputError("provider input must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HookInputError("provider input must be a JSON object");
  }
  return parsed as JsonObject;
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk;
  }
  return value;
}

function parseRequiredInteger(value: string | undefined, name: string): number {
  if (value === undefined) {
    throw new CliUsageError(`${name} is required`);
  }
  return parseInteger(value, name, 1);
}

function parseInteger(value: string | undefined, name: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new CliUsageError(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return parsed;
}
function parseHeldPolicyVersion(value: string | undefined): string {
  const policyVersion = value === undefined ? ADJUDICATION_POLICY_VERSION : value.trim();
  if (policyVersion.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(policyVersion)) {
    throw new CliUsageError("--policy-version must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}");
  }
  return policyVersion;
}

function parseProtectedValuePolicy(
  value: string | undefined,
): "metadata_only" | "allow_decrypt" | "deny" {
  const policy = value ?? "metadata_only";
  if (policy === "metadata_only" || policy === "allow_decrypt" || policy === "deny") {
    return policy;
  }
  throw new CliUsageError("--protected-value-policy must be metadata_only, allow_decrypt, or deny");
}

function requireString(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new CliUsageError(`${name} is required`);
  }
  return value;
}

function toPublicError(error: unknown): { code: string; message: string; exitCode: number } {
  if (error instanceof IdempotencyConflictError) {
    return {
      code: "idempotency_conflict",
      message: "The idempotency key was already used for different logical content.",
      exitCode: 3,
    };
  }
  if (error instanceof CliUsageError) {
    return { code: "invalid_usage", message: error.message, exitCode: 2 };
  }
  if (error instanceof HookInputError) {
    return { code: "invalid_provider_input", message: error.message, exitCode: 2 };
  }
  if (isParseArgsError(error)) {
    return { code: "invalid_usage", message: "The command options are invalid.", exitCode: 2 };
  }
  if (error instanceof SyncHttpError) {
    return {
      code: error.retryable ? "sync_retryable_failure" : "sync_blocked",
      message: "The remote sync request failed without exposing the server response body.",
      exitCode: error.retryable ? 1 : 4,
    };
  }
  return {
    code: "internal_error",
    message: "The local CarpeOS operation failed.",
    exitCode: 1,
  };
}

function isParseArgsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code.startsWith("ERR_PARSE_ARGS_")
  );
}

function writeJson(stream: NodeJS.WriteStream, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli();
}
