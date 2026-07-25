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
    // Without this the caller just gets "the key does not grant the required scope" and has no
    // way to learn which one, or that the fix is a differently-scoped key rather than a retry.
    if (err.requiredScope) {
      structured.requiredScope = err.requiredScope;
      hint =
        ` This needs an API key carrying the "${err.requiredScope}" scope. An mcp:scan-only key` +
        ` cannot reach it: mint a key with that scope under Settings > API keys (the v1 scopes` +
        ` require a Pro plan or higher).${hint}`;
    }
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
