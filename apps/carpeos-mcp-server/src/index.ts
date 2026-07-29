#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { serveCarpeosMcpStdio } from "./stdio.js";

export { createCarpeosMcpApplication, createCarpeosMcpServer } from "./server.js";
export { readStdioConfig, serveCarpeosMcpStdio } from "./stdio.js";
export { CARPEOS_MCP_TOOLS, CarpeosMcpApplication, CarpeosMcpError } from "./tools.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    serveCarpeosMcpStdio();
  } catch {
    process.stderr.write("carpeos-mcp-server: startup failed\n");
    process.exitCode = 1;
  }
}
