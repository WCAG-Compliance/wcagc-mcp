import { McpApiError } from "./api-client.js";

interface ToolErrorResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError: true;
}

/**
 * Every tool handler's catch block funnels here — an MCP *operational* error (bad plan, quota
 * hit, not found) must come back as a normal tool result with `isError: true`, not a
 * protocol-level MCP error, so the calling assistant can see and relay it (MCP spec: only
 * exceptional/tool-not-found conditions should be protocol errors).
 */
export function toolError(err: unknown): ToolErrorResult {
  if (err instanceof McpApiError) {
    const structured: Record<string, unknown> = { code: err.code };
    let hint = "";
    if (err.targetPlan) {
      structured.targetPlan = err.targetPlan;
      const upgradeUrl = err.upgradeUrl();
      if (upgradeUrl) {
        structured.upgradeUrl = upgradeUrl;
        hint = ` Upgrade to ${err.targetPlan}: ${upgradeUrl}`;
      }
    }
    if (err.limit !== undefined) structured.limit = err.limit;
    return {
      content: [{ type: "text", text: `${err.code}: ${err.message}${hint}` }],
      structuredContent: structured,
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: `INTERNAL_ERROR: ${message}` }],
    structuredContent: { code: "INTERNAL_ERROR" },
    isError: true,
  };
}
