import { dirname } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { isTrustZoneId, LocalCaptureStore } from "@carpeos/local-store";
import { createCarpeosMcpServer } from "./server.js";
import { normalizeVisibleTrustZones } from "./tools.js";

export type StdioConfig = {
  storePath: string;
  runtimeDir: string;
  workspaceRoot: string;
  trustZoneId: string;
  visibleTrustZoneIds: string[];
  projectId?: string;
};

export function readStdioConfig(env: NodeJS.ProcessEnv = process.env): StdioConfig {
  const storePath = requireEnv(env, "CARPEOS_MCP_STORE_PATH");
  const runtimeDir = env.CARPEOS_MCP_RUNTIME_DIR?.trim() || dirname(storePath);
  const workspaceRoot = requireEnv(env, "CARPEOS_MCP_WORKSPACE_ROOT");
  const trustZoneId = requireEnv(env, "CARPEOS_MCP_TRUST_ZONE");
  if (!isTrustZoneId(trustZoneId)) {
    throw new Error("CARPEOS_MCP_TRUST_ZONE is invalid");
  }
  const visibleTrustZoneIds = normalizeVisibleTrustZones(
    requireEnv(env, "CARPEOS_MCP_VISIBLE_TRUST_ZONES")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return {
    storePath,
    runtimeDir,
    workspaceRoot,
    trustZoneId,
    visibleTrustZoneIds,
    ...(env.CARPEOS_MCP_PROJECT_ID === undefined ? {} : { projectId: env.CARPEOS_MCP_PROJECT_ID }),
  };
}

export function serveCarpeosMcpStdio(config = readStdioConfig()) {
  const store = new LocalCaptureStore({
    runtimeDir: config.runtimeDir,
    dbPath: config.storePath,
    workspaceRoot: config.workspaceRoot,
    trustZoneId: config.trustZoneId,
    ...(config.projectId === undefined ? {} : { explicitProjectId: config.projectId }),
  });
  return serveStdio(
    () =>
      createCarpeosMcpServer({
        store,
        config: { visibleTrustZoneIds: config.visibleTrustZoneIds },
      }),
    {
      legacy: "serve",
      onerror: () => {
        process.stderr.write("carpeos-mcp-server: protocol error\n");
      },
    },
  );
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}
