#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { buildServer } from "./server.js";

// stdout IS the JSON-RPC channel for stdio transport — never console.log here or in anything
// this entrypoint loads; diagnostics only go to stderr.
if (!config.mcpKey) {
  console.error(
    "WCAGC_MCP_KEY is required. Mint an mcp:scan key in your wcagc account " +
      "(Settings > API keys) and set it as WCAGC_MCP_KEY in your MCP client config.",
  );
  process.exit(1);
}

const server = buildServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`wcagc-mcp running over stdio (API base: ${config.apiBaseUrl}).`);
