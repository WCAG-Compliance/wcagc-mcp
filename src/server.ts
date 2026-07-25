import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPdfTools } from "./tools/pdf.js";
import { registerProTools } from "./tools/pro.js";
import { registerScanTools } from "./tools/scan.js";

// Bumped on every tool-catalog or output-shape change — surfaced to clients via the MCP
// initialize handshake and by GET /health. Must equal package.json's version: the release
// workflow compares the deployed /health against the version it publishes to npm, and
// test/version.test.ts fails the build if the two ever drift.
export const VERSION = "0.2.6";

/**
 * One server, two transports (hosted Streamable HTTP + local stdio) share this — the tool
 * catalog and their HTTP calls to wcagc-api are identical either way (spec §3.1a: "один пакет
 * собирает оба транспорта"). wave 13-b appends the Pro+ tool set here; 13-a registers the
 * free tier only.
 */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "wcagc", version: VERSION });
  registerScanTools(server);
  registerPdfTools(server);
  registerProTools(server);
  return server;
}
