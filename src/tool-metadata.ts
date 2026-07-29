/**
 * ChatGPT needs each tool to describe its own auth policy before it can surface the OAuth
 * account-linking flow. The current MCP TypeScript SDK carries this Apps SDK extension through
 * descriptor `_meta`; keep the value shared so all tools advertise the same hosted scope.
 */
export const OAUTH_TOOL_META = {
  securitySchemes: [{ type: "oauth2", scopes: ["mcp:scan"] }],
} as const;
