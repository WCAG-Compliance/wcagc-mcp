import type { AuthInfo } from "@modelcontextprotocol/server";
import { config } from "./config.js";

/**
 * The bearer to forward to wcagc-api for this tool call: the per-request verified token over
 * Streamable HTTP, or the single process-wide WCAGC_MCP_KEY over stdio (there is no per-call
 * auth in local mode — the whole process is bound to one key).
 */
export function resolveBearer(extra: { authInfo?: AuthInfo; http?: { authInfo?: AuthInfo } }): string {
  const httpToken = extra.authInfo?.token ?? extra.http?.authInfo?.token;
  if (httpToken) {
    return httpToken;
  }
  // In HTTP transport (extra.http is present), never fall back to process-wide config.mcpKey
  if (extra.http) {
    throw new Error("No valid HTTP Bearer token provided in MCP request context.");
  }
  const token = config.mcpKey;
  if (!token) {
    throw new Error("No MCP bearer available — set WCAGC_MCP_KEY for local (stdio) mode.");
  }
  return token;
}
