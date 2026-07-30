import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { packageVersion } from "./package-version.js";

export type CycleCategory =
  | "success"
  | "invalid_usage"
  | "config_invalid"
  | "secret_invalid"
  | "lock_busy"
  | "lock_release_failed"
  | "manifest_failed"
  | "sync_failed"
  | "retrieval_failed"
  | "health_failed"
  | "internal_error";

export type CyclePhase =
  | "preflight"
  | "lock"
  | "manifest"
  | "sync"
  | "retrieval"
  | "health"
  | "complete";

export type CycleExitCode = 0 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type CycleBounds = {
  limit: number;
  maxPages: number;
  pullLimit: number;
};

export type CyclePreflight = {
  syncUrlHashSha256: string;
  credentialFileHashSha256: string;
  credentialSecretHashSha256?: string;
  syncKeyFileHashSha256: string;
  syncKeyMaterialHashSha256?: string;
};

export type CycleSyncResult = {
  pushed: unknown[];
  pulled: unknown[];
  pushedCount: number;
  pulledPages: number;
  cursor: unknown;
  outboxStatus: unknown;
  transportCounts?: Record<string, number>;
};

export type CycleRetrievalResult = {
  chunks: number;
  freshness: unknown;
};

export type CycleManifest = {
  schema_version: "v1";
  record_type: "carpeos_sync_cycle_manifest";
  cycle_id: string;
  started_at: string;
  home_hash_sha256: string;
  project_id: string;
  trust_zone_id: string;
  sync_url_hash_sha256: string;
  credential_file_hash_sha256: string;
  credential_secret_hash_sha256?: string;
  sync_key_file_hash_sha256: string;
  sync_key_material_hash_sha256?: string;
  bounds: {
    limit: number;
    max_pages: number;
    pull_limit: number;
  };
  cli: {
    command: "sync cycle";
    version: string;
    command_hash_sha256: string;
  };
  source: {
    distribution: "unknown";
  };
  phases_planned: CyclePhase[];
  redactions: {
    endpoint: "hashed";
    credential_file: "path-hashed";
    credential_secret: "hashed";
    sync_key_file: "path-hashed";
    sync_key_material: "omitted" | "hashed";
    private_payloads: "omitted";
  };
};

export type CycleHealth = {
  schema_version: "v1";
  record_type: "carpeos_sync_cycle_health";
  cycle_id: string;
  manifest_hash_sha256: string | null;
  manifest_path: { basename: string } | null;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: "success" | "failed";
  phase: CyclePhase;
  category: CycleCategory;
  exit_code: CycleExitCode;
  bounds: {
    limit: number;
    max_pages: number;
  };
  sync: {
    attempted: boolean;
    pushed_count: number;
    pulled_pages: number;
    cursor_present: boolean;
    outbox_status: unknown;
  };
  transport_counts: Record<string, number>;
  retrieval: {
    attempted: boolean;
    rebuilt: boolean;
    chunks: number;
    freshness: unknown;
  };
  lock: {
    acquired: boolean;
    released: boolean;
  };
  redactions: {
    secrets: "omitted";
    private_payloads: "omitted";
  };
};

export type CycleResult = {
  ok: boolean;
  command: "sync cycle";
  cycle_id: string;
  manifest: { basename: string; sha256: string | null } | null;
  health: CycleHealth;
};

export class CycleFailure extends Error {
  readonly category: CycleCategory;
  readonly phase: CyclePhase;
  readonly exitCode: CycleExitCode;

  constructor(
    category: CycleCategory,
    phase: CyclePhase,
    exitCode: CycleExitCode,
    message: string,
  ) {
    super(message);
    this.name = "CycleFailure";
    this.category = category;
    this.phase = phase;
    this.exitCode = exitCode;
  }
}

type CycleHookEvent =
  | { type: "health_written"; path: string; category: CycleCategory }
  | { type: "lock_release_attempted"; path: string }
  | { type: "lock_released"; path: string }
  | { type: "lock_release_failed"; path: string };

export async function runSyncCycle(input: {
  home: string;
  projectId: string;
  trustZoneId: string;
  bounds: CycleBounds;
  commandArgv: readonly string[];
  distribution?: "unknown";
  now?: () => Date;
  hooks?: {
    releaseLock?: (path: string) => void;
    onEvent?: (event: CycleHookEvent) => void;
  };
  preflight: () => Promise<CyclePreflight> | CyclePreflight;
  syncOnce: () => Promise<CycleSyncResult> | CycleSyncResult;
  rebuildRetrieval: () => Promise<CycleRetrievalResult> | CycleRetrievalResult;
}): Promise<CycleResult> {
  const now = input.now ?? (() => new Date());
  const started = now();
  const cycleId = `cycle_${randomUUID().replaceAll("-", "")}`;
  const paths = cyclePaths(input.home);
  let lockAcquired = false;
  let lockReleased = false;
  let manifestPath: string | undefined;
  let manifestHash: string | null = null;
  let syncResult: CycleSyncResult | undefined;
  let retrievalResult: CycleRetrievalResult | undefined;
  let terminal: {
    status: "success" | "failed";
    phase: CyclePhase;
    category: CycleCategory;
    exitCode: CycleExitCode;
  } = {
    status: "failed",
    phase: "preflight",
    category: "internal_error",
    exitCode: 10,
  };

  try {
    ensureCycleDirs(paths);
    const preflight = await input.preflight();
    acquireLock(paths.lock, {
      cycleId,
      startedAt: started.toISOString(),
    });
    lockAcquired = true;
    const manifest = makeManifest({
      cycleId,
      startedAt: started.toISOString(),
      home: input.home,
      projectId: input.projectId,
      trustZoneId: input.trustZoneId,
      bounds: input.bounds,
      commandArgv: input.commandArgv,
      preflight,
      distribution: input.distribution ?? "unknown",
    });
    manifestPath = join(paths.manifests, `${safeTimestamp(started)}-${cycleId}.json`);
    manifestHash = writeManifestOnce(manifestPath, manifest);

    syncResult = await input.syncOnce();
    retrievalResult = await input.rebuildRetrieval();
    terminal = {
      status: "success",
      phase: "complete",
      category: "success",
      exitCode: 0,
    };
  } catch (error) {
    terminal = classifyCycleError(error);
  }

  const ended = now();
  const health = makeHealth({
    cycleId,
    started,
    ended,
    terminal,
    bounds: input.bounds,
    manifestPath,
    manifestHash,
    syncResult,
    retrievalResult,
    lockAcquired,
    lockReleased,
  });
  try {
    writeHealthAtomically(paths.health, health);
    input.hooks?.onEvent?.({
      type: "health_written",
      path: paths.health,
      category: health.category,
    });
  } catch {
    const failedHealth = {
      ...health,
      status: "failed" as const,
      phase: "health" as const,
      category: "health_failed" as const,
      exit_code: 9 as const,
    };
    return {
      ok: false,
      command: "sync cycle",
      cycle_id: cycleId,
      manifest:
        manifestPath === undefined
          ? null
          : { basename: basename(manifestPath), sha256: manifestHash },
      health: failedHealth,
    };
  }

  if (lockAcquired) {
    const releaseLock = input.hooks?.releaseLock ?? unlinkSync;
    input.hooks?.onEvent?.({ type: "lock_release_attempted", path: paths.lock });
    try {
      releaseLock(paths.lock);
      lockReleased = true;
      input.hooks?.onEvent?.({ type: "lock_released", path: paths.lock });
    } catch {
      lockReleased = false;
      input.hooks?.onEvent?.({ type: "lock_release_failed", path: paths.lock });
      const failedHealth = makeHealth({
        cycleId,
        started,
        ended: now(),
        terminal: {
          status: "failed",
          phase: "health",
          category: "lock_release_failed",
          exitCode: 5,
        },
        bounds: input.bounds,
        manifestPath,
        manifestHash,
        syncResult,
        retrievalResult,
        lockAcquired,
        lockReleased,
      });
      try {
        writeHealthAtomically(paths.health, failedHealth);
        input.hooks?.onEvent?.({
          type: "health_written",
          path: paths.health,
          category: failedHealth.category,
        });
      } catch {
        const healthFailed = {
          ...failedHealth,
          status: "failed" as const,
          phase: "health" as const,
          category: "health_failed" as const,
          exit_code: 9 as const,
        };
        return {
          ok: false,
          command: "sync cycle",
          cycle_id: cycleId,
          manifest:
            manifestPath === undefined
              ? null
              : { basename: basename(manifestPath), sha256: manifestHash },
          health: healthFailed,
        };
      }
      return {
        ok: false,
        command: "sync cycle",
        cycle_id: cycleId,
        manifest:
          manifestPath === undefined
            ? null
            : { basename: basename(manifestPath), sha256: manifestHash },
        health: failedHealth,
      };
    }
  }

  return {
    ok: health.status === "success",
    command: "sync cycle",
    cycle_id: cycleId,
    manifest:
      manifestPath === undefined
        ? null
        : { basename: basename(manifestPath), sha256: manifestHash },
    health,
  };
}

export function hashPath(value: string): string {
  return sha256Hex(value);
}

export function hashText(value: string): string {
  return sha256Hex(value);
}

function cyclePaths(home: string): {
  cycles: string;
  manifests: string;
  lock: string;
  health: string;
} {
  const cycles = join(home, "cycles");
  return {
    cycles,
    manifests: join(cycles, "manifests"),
    lock: join(cycles, "cycle.lock"),
    health: join(cycles, "health.json"),
  };
}

function ensureCycleDirs(paths: { cycles: string; manifests: string }): void {
  mkdirSync(paths.cycles, { recursive: true, mode: 0o700 });
  chmodSync(paths.cycles, 0o700);
  mkdirSync(paths.manifests, { recursive: true, mode: 0o700 });
  chmodSync(paths.manifests, 0o700);
}

function acquireLock(path: string, input: { cycleId: string; startedAt: string }): void {
  if (existsSync(path)) {
    throw new CycleFailure("lock_busy", "lock", 5, "cycle lock is already present");
  }
  try {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(
        fd,
        `${JSON.stringify({
          schema_version: "v1",
          record_type: "carpeos_sync_cycle_lock",
          cycle_id: input.cycleId,
          started_at: input.startedAt,
        })}\n`,
      );
    } finally {
      closeSync(fd);
    }
    chmodSync(path, 0o600);
  } catch {
    if (existsSync(path)) {
      throw new CycleFailure("lock_busy", "lock", 5, "cycle lock is already present");
    }
    throw new CycleFailure("lock_busy", "lock", 5, "cycle lock could not be acquired");
  }
}

function makeManifest(input: {
  cycleId: string;
  startedAt: string;
  home: string;
  projectId: string;
  trustZoneId: string;
  bounds: CycleBounds;
  commandArgv: readonly string[];
  preflight: CyclePreflight;
  distribution: "unknown";
}): CycleManifest {
  return {
    schema_version: "v1",
    record_type: "carpeos_sync_cycle_manifest",
    cycle_id: input.cycleId,
    started_at: input.startedAt,
    home_hash_sha256: sha256Hex(input.home),
    project_id: input.projectId,
    trust_zone_id: input.trustZoneId,
    sync_url_hash_sha256: input.preflight.syncUrlHashSha256,
    credential_file_hash_sha256: input.preflight.credentialFileHashSha256,
    ...(input.preflight.credentialSecretHashSha256 === undefined
      ? {}
      : { credential_secret_hash_sha256: input.preflight.credentialSecretHashSha256 }),
    sync_key_file_hash_sha256: input.preflight.syncKeyFileHashSha256,
    ...(input.preflight.syncKeyMaterialHashSha256 === undefined
      ? {}
      : { sync_key_material_hash_sha256: input.preflight.syncKeyMaterialHashSha256 }),
    bounds: {
      limit: input.bounds.limit,
      max_pages: input.bounds.maxPages,
      pull_limit: input.bounds.pullLimit,
    },
    cli: {
      command: "sync cycle",
      version: packageVersion(),
      command_hash_sha256: sha256Hex(
        JSON.stringify({
          argv: redactCommandArgv(input.commandArgv),
          bounds: input.bounds,
          project_id: input.projectId,
          trust_zone_id: input.trustZoneId,
        }),
      ),
    },
    source: {
      distribution: input.distribution,
    },
    phases_planned: ["preflight", "lock", "manifest", "sync", "retrieval", "health", "complete"],
    redactions: {
      endpoint: "hashed",
      credential_file: "path-hashed",
      credential_secret: "hashed",
      sync_key_file: "path-hashed",
      sync_key_material:
        input.preflight.syncKeyMaterialHashSha256 === undefined ? "omitted" : "hashed",
      private_payloads: "omitted",
    },
  };
}

function writeManifestOnce(path: string, manifest: CycleManifest): string {
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  try {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, content);
    } finally {
      closeSync(fd);
    }
    chmodSync(path, 0o600);
    return sha256Hex(content);
  } catch {
    throw new CycleFailure("manifest_failed", "manifest", 6, "cycle manifest could not be created");
  }
}

function makeHealth(input: {
  cycleId: string;
  started: Date;
  ended: Date;
  terminal: {
    status: "success" | "failed";
    phase: CyclePhase;
    category: CycleCategory;
    exitCode: CycleExitCode;
  };
  bounds: CycleBounds;
  manifestPath: string | undefined;
  manifestHash: string | null;
  syncResult: CycleSyncResult | undefined;
  retrievalResult: CycleRetrievalResult | undefined;
  lockAcquired: boolean;
  lockReleased: boolean;
}): CycleHealth {
  return {
    schema_version: "v1",
    record_type: "carpeos_sync_cycle_health",
    cycle_id: input.cycleId,
    manifest_hash_sha256: input.manifestHash,
    manifest_path:
      input.manifestPath === undefined ? null : { basename: basename(input.manifestPath) },
    started_at: input.started.toISOString(),
    ended_at: input.ended.toISOString(),
    duration_ms: Math.max(0, input.ended.getTime() - input.started.getTime()),
    status: input.terminal.status,
    phase: input.terminal.phase,
    category: input.terminal.category,
    exit_code: input.terminal.exitCode,
    bounds: {
      limit: input.bounds.limit,
      max_pages: input.bounds.maxPages,
    },
    sync: {
      attempted: input.syncResult !== undefined || input.terminal.phase === "sync",
      pushed_count: input.syncResult?.pushedCount ?? 0,
      pulled_pages: input.syncResult?.pulledPages ?? 0,
      cursor_present: input.syncResult?.cursor !== undefined && input.syncResult.cursor !== null,
      outbox_status: input.syncResult?.outboxStatus ?? null,
    },
    transport_counts: input.syncResult?.transportCounts ?? {},
    retrieval: {
      attempted: input.retrievalResult !== undefined || input.terminal.phase === "retrieval",
      rebuilt: input.retrievalResult !== undefined,
      chunks: input.retrievalResult?.chunks ?? 0,
      freshness: input.retrievalResult?.freshness ?? null,
    },
    lock: {
      acquired: input.lockAcquired,
      released: input.lockReleased,
    },
    redactions: {
      secrets: "omitted",
      private_payloads: "omitted",
    },
  };
}

function writeHealthAtomically(path: string, health: CycleHealth): void {
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const content = `${JSON.stringify(health, null, 2)}\n`;
  const fd = openSync(tmpPath, "wx", 0o600);
  try {
    writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, path);
  chmodSync(path, 0o600);
}

function classifyCycleError(error: unknown): {
  status: "failed";
  phase: CyclePhase;
  category: CycleCategory;
  exitCode: CycleExitCode;
} {
  if (error instanceof CycleFailure) {
    return {
      status: "failed",
      phase: error.phase,
      category: error.category,
      exitCode: error.exitCode,
    };
  }
  return {
    status: "failed",
    phase: "sync",
    category: "sync_failed",
    exitCode: 7,
  };
}

function safeTimestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, "-");
}

function redactCommandArgv(argv: readonly string[]): string[] {
  const redacted = new Set(["--url", "--credential-file", "--sync-key-file"]);
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    result.push(argument);
    if (redacted.has(argument) && index + 1 < argv.length) {
      result.push("<redacted>");
      index += 1;
    }
  }
  return result;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function assertPrivateCycleMode(path: string, expected: number): void {
  const mode = statSync(path).mode & 0o777;
  if (mode !== expected) {
    throw new Error(`${path} mode ${mode.toString(8)} did not match ${expected.toString(8)}`);
  }
}
