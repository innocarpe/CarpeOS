import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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

/**
 * Where work happened, as a retrieval **facet**.
 *
 * Knowledge partitions by `project_id`; a worktree never partitions knowledge,
 * so sibling checkouts of one repository share one brain. See ADR 0013.
 *
 * `worktree_id` is a stable hash and `worktree_name` is a bare directory name.
 * The absolute worktree root is deliberately not part of this record: the public
 * boundary check rejects absolute home paths, and directory names get renamed.
 */
export type WorktreeIdentity = {
  worktree_id: string;
  worktree_name: string;
  git_branch?: string;
  is_linked_worktree: boolean;
  basis_kind: "git_worktree" | "workspace_root";
};

export type ResolveWorktreeIdentityOptions = {
  runtimeDir: string;
  workspaceRoot: string;
  execGit?: (args: string[], cwd: string) => string;
};

/**
 * Resolve the worktree facet for a workspace.
 *
 * Git supplies the checkout root, branch, and linked-worktree flag. Outside a
 * repository the workspace root itself is the only available basis, which is
 * recorded as `basis_kind: "workspace_root"` so callers can tell the cases apart.
 */
export function resolveWorktreeIdentity(options: ResolveWorktreeIdentityOptions): WorktreeIdentity {
  const deviceClientId = readOrCreateDeviceClientId(options.runtimeDir);
  const execGit = options.execGit ?? defaultExecGit;
  const gitRoot = readGitWorktreeRoot(options.workspaceRoot, execGit);
  const root = gitRoot ?? resolve(options.workspaceRoot);
  const branch = gitRoot === undefined ? undefined : readGitBranch(root, execGit);

  return {
    worktree_id: `wt_${hashHex(`${deviceClientId}:${root}`).slice(0, 24)}`,
    worktree_name: sanitizeWorktreeName(basename(root)),
    ...(branch === undefined ? {} : { git_branch: branch }),
    is_linked_worktree: gitRoot === undefined ? false : isLinkedWorktree(root, execGit),
    basis_kind: gitRoot === undefined ? "workspace_root" : "git_worktree",
  };
}

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

function readGitWorktreeRoot(
  workspaceRoot: string,
  execGit: (args: string[], cwd: string) => string,
): string | undefined {
  try {
    const top = execGit(["rev-parse", "--show-toplevel"], workspaceRoot).trim();
    return top.length > 0 ? resolve(top) : undefined;
  } catch {
    return undefined;
  }
}

function readGitBranch(
  root: string,
  execGit: (args: string[], cwd: string) => string,
): string | undefined {
  try {
    const branch = execGit(["rev-parse", "--abbrev-ref", "HEAD"], root).trim();
    // Detached HEAD reports "HEAD"; record no branch rather than a misleading one.
    return branch.length > 0 && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

/** A linked worktree resolves its own git dir separately from the shared common dir. */
function isLinkedWorktree(root: string, execGit: (args: string[], cwd: string) => string): boolean {
  try {
    const gitDir = resolve(root, execGit(["rev-parse", "--git-dir"], root).trim());
    const commonDir = resolve(root, execGit(["rev-parse", "--git-common-dir"], root).trim());
    return gitDir !== commonDir;
  } catch {
    return false;
  }
}

/** Bare directory label for operator recall; never an absolute path. */
function sanitizeWorktreeName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);
  return normalized.length > 0 ? normalized : "workspace";
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
