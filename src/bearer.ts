import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { config } from "./config.js";

/**
 * The bearer to forward to wcagc-api for this tool call: the per-request verified token over
 * Streamable HTTP, or the single process-wide WCAGC_MCP_KEY over stdio (there is no per-call
 * auth in local mode — the whole process is bound to one key).
 */
export function resolveBearer(extra: { authInfo?: AuthInfo }): string {
  const token = extra.authInfo?.token ?? config.mcpKey;
  if (!token) {
    throw new Error("No MCP bearer available — set WCAGC_MCP_KEY for local (stdio) mode.");
  }
  return token;
}
