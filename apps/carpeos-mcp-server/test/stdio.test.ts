import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { LocalCaptureStore, StaticKeyProvider } from "@carpeos/local-store";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CARPEOS_MCP_TOOLS } from "../src/tools.js";

const packageRoot = resolve(import.meta.dirname, "..");
const cliPath = join(packageRoot, "dist", "index.js");
const createdDirs: string[] = [];
const trustZoneId = "tz_mcp_stdio";

// tsc can exceed vitest's default 10s hookTimeout under monorepo preflight load.
beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      resolve(packageRoot, "..", "..", "node_modules", "typescript", "bin", "tsc"),
      "-p",
      join(packageRoot, "tsconfig.json"),
    ],
    { stdio: "pipe" },
  );
}, 60_000);

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("CarpeOS MCP stdio server", () => {
  it("lists exact tools, calls through a spawned stdio client, and keeps stderr sanitized", async () => {
    const context = makeContext();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--disable-warning=ExperimentalWarning", cliPath],
      cwd: packageRoot,
      env: {
        ...process.env,
        CARPEOS_MCP_STORE_PATH: context.dbPath,
        CARPEOS_MCP_RUNTIME_DIR: context.runtimeDir,
        CARPEOS_MCP_WORKSPACE_ROOT: context.runtimeDir,
        CARPEOS_MCP_TRUST_ZONE: trustZoneId,
        CARPEOS_MCP_VISIBLE_TRUST_ZONES: trustZoneId,
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    const client = new Client({ name: "synthetic-mcp-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(CARPEOS_MCP_TOOLS);
      expect(listed.tools[0]?.inputSchema).toMatchObject({
        allOf: expect.any(Array),
      });

      const captured = await client.callTool({
        name: "memory_capture",
        arguments: {
          schema_version: "v1",
          visibility: {
            visible_trust_zone_ids: [trustZoneId],
            protected_value_policy: "metadata_only",
          },
          provider: "synthetic",
          hook_event_name: "StdioCapture",
          captured_at: "2026-01-01T00:00:00Z",
          media_type: "application/json",
          subject_ref: "subject_stdio",
          payload: { secret: "SYNTHETIC_STDIO_PRIVATE_SENTINEL" },
          idempotency_key: "idem_stdio_capture_000001",
        },
      });
      expect(captured.isError).not.toBe(true);
      expect(captured.structuredContent).toMatchObject({
        schema_version: "v1",
        tool: "memory_capture",
        status: "captured",
      });
      expect(JSON.stringify(captured)).not.toContain("SYNTHETIC_STDIO_PRIVATE_SENTINEL");
    } finally {
      await client.close();
    }
    expect(stderr).not.toContain("SYNTHETIC_STDIO_PRIVATE_SENTINEL");
  }, 30_000);

  it("fails startup without explicit store configuration and does not write protocol data to stdout", () => {
    const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cliPath], {
      cwd: packageRoot,
      env: { ...process.env, CARPEOS_MCP_STORE_PATH: "" },
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("carpeos-mcp-server: startup failed\n");
  });
});

function makeContext() {
  const runtimeDir = mkdtempSync(join(tmpdir(), "carpeos-mcp-stdio-"));
  createdDirs.push(runtimeDir);
  const dbPath = join(runtimeDir, "carpeos.sqlite");
  const store = new LocalCaptureStore({
    runtimeDir,
    dbPath,
    workspaceRoot: runtimeDir,
    trustZoneId,
    keyProvider: new StaticKeyProvider(new Uint8Array(32).fill(3)),
  });
  store.close();
  return { runtimeDir, dbPath };
}
