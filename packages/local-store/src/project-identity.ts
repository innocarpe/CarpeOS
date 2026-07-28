import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hashHex } from "@carpeos/capture";

export type ProjectIdentity = {
  project_id: string;
  basis_kind: "explicit" | "git_remote_hash" | "device_local_root_hash";
  device_client_id: string;
};

export type ResolveProjectIdentityOptions = {
  runtimeDir: string;
  workspaceRoot: string;
  explicitProjectId?: string | undefined;
  execGit?: (args: string[], cwd: string) => string;
};

export function resolveProjectIdentity(options: ResolveProjectIdentityOptions): ProjectIdentity {
  const deviceClientId = readOrCreateDeviceClientId(options.runtimeDir);
  if (options.explicitProjectId !== undefined) {
    return {
      project_id: sanitizeProjectId(options.explicitProjectId),
      basis_kind: "explicit",
      device_client_id: deviceClientId,
    };
  }

  const remoteIdentity = readSanitizedGitRemoteIdentity(options);
  if (remoteIdentity !== undefined) {
    return {
      project_id: `project_git_${hashHex(remoteIdentity).slice(0, 24)}`,
      basis_kind: "git_remote_hash",
      device_client_id: deviceClientId,
    };
  }

  return {
    project_id: `project_local_${hashHex(`${deviceClientId}:${options.workspaceRoot}`).slice(
      0,
      24,
    )}`,
    basis_kind: "device_local_root_hash",
    device_client_id: deviceClientId,
  };
}

export function sanitizeRemoteIdentity(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();
  const scpLike = trimmed.match(/^([^@]+@)?([^:]+):(.+)$/);
  if (scpLike !== null && !trimmed.includes("://")) {
    return `${scpLike[2]?.toLowerCase()}/${normalizeRemotePath(scpLike[3] ?? "")}`;
  }

  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    return `${url.host.toLowerCase()}/${normalizeRemotePath(url.pathname)}`;
  } catch {
    return normalizeRemotePath(trimmed.replace(/^[^@]+@/, ""));
  }
}

function readSanitizedGitRemoteIdentity(
  options: ResolveProjectIdentityOptions,
): string | undefined {
  const execGit = options.execGit ?? defaultExecGit;
  try {
    const remoteUrl = execGit(["config", "--get", "remote.origin.url"], options.workspaceRoot);
    const sanitized = sanitizeRemoteIdentity(remoteUrl);
    return sanitized.length > 0 ? sanitized : undefined;
  } catch {
    return undefined;
  }
}

function defaultExecGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function normalizeRemotePath(value: string): string {
  return value
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .trim();
}

function sanitizeProjectId(value: string): string {
  const identityBasis = value.trim().toLowerCase();
  const normalized = identityBasis
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (
    identityBasis === normalized &&
    normalized.length <= 80 &&
    /^[a-z][a-z0-9_:-]{2,79}$/.test(normalized)
  ) {
    return normalized;
  }

  const readablePrefix = /^[a-z]/.test(normalized) ? normalized : "project";
  const suffix = hashHex(identityBasis).slice(0, 16);
  const boundedPrefix = readablePrefix.slice(0, 63).replace(/[_:-]+$/g, "") || "project";
  return `${boundedPrefix}_${suffix}`;
}

function readOrCreateDeviceClientId(runtimeDir: string): string {
  const filePath = join(runtimeDir, "device-client-id");
  const parentDir = dirname(filePath);
  mkdirSync(parentDir, { recursive: true, mode: 0o700 });
  chmodSync(parentDir, 0o700);

  try {
    return readDeviceClientId(filePath);
  } catch (error) {
    if (!isErrnoCode(error, "ENOENT")) {
      throw error;
    }
  }

  const id = `client_${hashHex(randomUUID()).slice(0, 24)}`;
  try {
    writeFileSync(filePath, `${id}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (isErrnoCode(error, "EEXIST")) {
      return readDeviceClientId(filePath);
    }
    throw error;
  }
  chmodSync(filePath, 0o600);
  return id;
}

function readDeviceClientId(filePath: string): string {
  chmodSync(filePath, 0o600);
  const id = readFileSync(filePath, "utf8").trim();
  if (!/^client_[a-f0-9]{24}$/.test(id)) {
    throw new Error(`invalid device client id at ${filePath}`);
  }
  return id;
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
