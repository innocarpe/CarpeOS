#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isIdempotencyKey } from "@carpeos/capture";
import {
  IdempotencyConflictError,
  isTrustZoneId,
  LocalCaptureStore,
  runtimeDirFromEnv,
  withLocalRetrievalDatabase,
} from "@carpeos/local-store";
import { createCarpeosMcpApplication } from "@carpeos/mcp-server";
import {
  ackEmbeddingJob,
  DETERMINISTIC_LOCAL_DEV_EMBEDDING,
  deterministicLocalDevEmbedding,
  ensureEmbeddingJob,
  leaseEmbeddingJobs,
  makeEmbeddingRecord,
  rebuildLocalRetrievalIndex,
  searchLocalRetrievalIndex,
  storeLocalVector,
} from "@carpeos/retrieval";
import type { RetrievalChunk, RetrievalQuery } from "@carpeos/schema";
import { OutboxSyncCoordinator, SyncHttpError, SyncHttpTransport } from "@carpeos/sync-client";
import { HookInputError, isSupportedProvider, normalizeHookEnvelope } from "./adapters.js";
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
      case "outbox":
        return runOutbox(rest, env);
      case "sync":
        return await runSync(rest, env);
      case "retrieval":
        return runRetrieval(rest, env);
      case "memory":
        return await runMemory(rest, env);
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
      provider: { type: "string", default: "deterministic-local-dev" },
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
        if (parsed.values.provider !== "deterministic-local-dev") {
          throw new CliUsageError(
            "retrieval embed requires --provider deterministic-local-dev; production embedding is not configured",
          );
        }
        const embedded = withLocalRetrievalDatabase(store, (db) => {
          const rebuilt = rebuildLocalRetrievalIndex(db, new Date());
          for (const chunk of rebuilt.chunks.filter((item) => item.status === "active")) {
            ensureEmbeddingJob(db, {
              chunkId: chunk.chunk_id,
              embeddingModel: DETERMINISTIC_LOCAL_DEV_EMBEDDING.model,
              embeddingVersion: DETERMINISTIC_LOCAL_DEV_EMBEDDING.version,
              pooling: DETERMINISTIC_LOCAL_DEV_EMBEDDING.pooling,
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
            const vector = deterministicLocalDevEmbedding(chunk.text);
            const record = makeEmbeddingRecord({
              chunkId: chunk.chunk_id,
              vector,
              embeddingModel: DETERMINISTIC_LOCAL_DEV_EMBEDDING.model,
              embeddingVersion: DETERMINISTIC_LOCAL_DEV_EMBEDDING.version,
              pooling: DETERMINISTIC_LOCAL_DEV_EMBEDDING.pooling,
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
          provider: "deterministic-local-dev",
          semantic_quality: "synthetic-dev-only",
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
  const provider = parsed.values.provider;
  if (provider === undefined || !isSupportedProvider(provider)) {
    throw new CliUsageError("capture-hook requires --provider codex, claude, or grok");
  }
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
      "sync requires status, push, pull, once, or credential-hash (see: carpeos help sync)",
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
        const pushed = [];
        let exitCode = 0;
        for (let index = 0; index < limit; index += 1) {
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
          for (let index = 0; index < maxPages; index += 1) {
            const page = await coordinator.pullPage();
            pulled.push(page);
            if (!page.has_more) {
              break;
            }
          }
        }
        writeJson(process.stdout, {
          ok: exitCode === 0,
          command: "sync once",
          pushed,
          pulled,
          status: store.outboxStatus(),
          cursor: store.getSyncCursor(),
        });
        return exitCode;
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

function resolveTrustZoneId(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv,
  runtimeDir: string,
): string | undefined {
  return resolveTrustZoneResolution(explicit, env, runtimeDir).trustZoneId;
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
  capture-hook         Ingest a provider hook envelope (codex|claude|grok)
  extract              Extract Observation from an EvidenceArtifact event
  outbox               Local durable outbox (status|lease|ack|retry)
  sync                 Push/pull with a remote sync edge (status|push|pull|once)
  retrieval            Rebuild local retrieval index or run embed jobs
  memory               Search / get / context-pack over local memory
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
      return `carpeos extract — EvidenceArtifact → Observation (metadata heuristic)

USAGE
  carpeos extract --event-id <evt_…> [options]

OPTIONS
  --event-id <id>           EvidenceArtifact event_id to extract from
  --home <path>             Runtime home (default: $CARPEOS_HOME or ~/.carpeos)
  --project-id <id>         Project identity
  --trust-zone <id>         Trust zone

NOTES
  Uses product meaningful-unit policy (PostToolUse off by default).
  Statement text is metadata-only (no decrypted transcript).
  Idempotent: re-running the same event_id replays the Observation.
`;
    case "capture-hook":
      return `carpeos capture-hook — ingest a provider session hook (no plaintext secrets in stdout)

USAGE
  carpeos capture-hook --provider <codex|claude|grok> [options]
  # hook JSON on stdin by default

OPTIONS
  --provider <name>          codex | claude | grok (required)
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
  carpeos sync <status|push|pull|once|credential-hash> [options]

SUBCOMMANDS
  status               Local outbox + cursor + whether credentials are configured
  push                 Push leased outbox items
  pull                 Pull remote pages into the local store
  once                 push then pull
  credential-hash      SHA-256 of the sync credential file (for operator checks)

OPTIONS
  --home <path>
  --project-id <id>
  --trust-zone <id>
  --url <url>          Or $CARPEOS_SYNC_URL
  --credential-file <path>
  --sync-key-file <path>
  --limit <n>          push/once iterations (default 1)
  --max-pages <n>      pull/once pages (default 1)
  --lease-ms <n>
  --retry-delay-ms <n>
  --pull-limit <n>

EXAMPLES
  carpeos sync status
  carpeos sync once --url https://… --credential-file … --sync-key-file …
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
  --provider <name>    embed: only deterministic-local-dev
  --limit <n>
  --lease-ms <n>

EXAMPLES
  carpeos retrieval rebuild --trust-zone tz_local_default
  carpeos retrieval embed --trust-zone tz_local_default --provider deterministic-local-dev
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
  return new OutboxSyncCoordinator({
    store,
    transport: new SyncHttpTransport({
      baseUrl: config.baseUrl,
      bearerCredential: config.bearerCredential,
      clientId: store.clientId,
      fetch: globalThis.fetch,
    }),
    trustZoneSyncKey: config.trustZoneSyncKey,
    leaseMs: parseInteger(values["lease-ms"], "--lease-ms", 1),
    retryDelayMs: parseInteger(values["retry-delay-ms"], "--retry-delay-ms", 0),
    pullLimit: parseInteger(values["pull-limit"], "--pull-limit", 1),
  });
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
}): RetrievalQuery {
  return {
    schema_version: "v1",
    record_type: "retrieval_query",
    query_id: `query_${sha256Hex(input.text).slice(0, 24)}`,
    query_text: input.text,
    filters: {
      visible_trust_zone_ids: [...input.visibleTrustZones],
      // Align with MCP memory_search (active + draft claims).
      lifecycle_status: ["active", "draft"],
      // Align with MCP memory_search: capture writes EvidenceArtifact as
      // epistemic_authority "imported"; excluding it made day-to-day search empty.
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
    },
    ranking: { mode: "hybrid", weights: { structured: 1, fts: 1, semantic: 1, recency: 0.1 } },
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
