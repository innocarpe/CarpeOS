import { McpServer } from "@modelcontextprotocol/server";
import { CarpeosMcpApplication, CARPEOS_MCP_TOOLS, type CarpeosMcpConfig } from "./tools.js";
import { mcpInputSchema } from "./schemas.js";
import type { LocalCaptureStore } from "@carpeos/local-store";

export function createCarpeosMcpApplication(input: {
  store: LocalCaptureStore;
  config: CarpeosMcpConfig;
}): CarpeosMcpApplication {
  return new CarpeosMcpApplication(input);
}

export function createCarpeosMcpServer(input: {
  store: LocalCaptureStore;
  config: CarpeosMcpConfig;
}): McpServer {
  const app = createCarpeosMcpApplication(input);
  const server = new McpServer(
    { name: "carpeos-mcp-server", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  for (const toolName of CARPEOS_MCP_TOOLS) {
    server.registerTool(
      toolName,
      {
        title: toolName,
        description: `CarpeOS ${toolName} local memory tool.`,
        inputSchema: mcpInputSchema(toolName),
      },
      async (args) => {
        const result = await app.dispatch(toolName, args);
        return {
          content: [{ type: "text", text: result.text }],
          structuredContent: result.structuredContent,
          isError: result.isError,
        };
      },
    );
  }

  return server;
}
