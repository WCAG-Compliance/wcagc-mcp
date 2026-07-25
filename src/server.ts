import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPdfTools } from "./tools/pdf.js";
import { registerProTools } from "./tools/pro.js";
import { registerScanTools } from "./tools/scan.js";

// Bumped on every tool-catalog or output-shape change — surfaced to clients via the MCP
// initialize handshake.
const VERSION = "0.2.2";

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
