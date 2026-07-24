import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { apiJson, McpApiError } from "./api-client.js";
import { config } from "./config.js";

interface McpIntrospectResponse {
  orgId: string;
  plan: string;
  scopes: string[];
  remainingToday: number | null;
}

interface CacheEntry {
  authInfo: AuthInfo;
  cachedAt: number;
}

// Keyed by the raw token so a chatty session doesn't re-introspect on every tool call; bounded by
// config.introspectCacheTtlSeconds so a revoked key or plan change is visible within that window.
const cache = new Map<string, CacheEntry>();

function pruneExpired(now: number): void {
  for (const [token, entry] of cache) {
    if (now - entry.cachedAt >= config.introspectCacheTtlSeconds) {
      cache.delete(token);
    }
  }
}

/**
 * Forwards the raw bearer to `POST /api/v1/mcp/introspect` — wcagc-mcp never decodes or stores
 * the key itself, it only asks the API what it grants (ARCHITECTURE §8: the API is the single
 * source of truth for auth/entitlements/quota).
 */
export const introspectVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const now = Date.now() / 1000;
    const cached = cache.get(token);
    if (cached && now - cached.cachedAt < config.introspectCacheTtlSeconds) {
      return cached.authInfo;
    }

    let response: McpIntrospectResponse;
    try {
      response = await apiJson<McpIntrospectResponse>(token, "/api/v1/mcp/introspect", { method: "POST" });
    } catch (err) {
      // Deliberately generic — never echo the raw upstream detail, which could hint at key
      // enumeration; requireBearerAuth maps InvalidTokenError to a 401 challenge either way.
      const detail = err instanceof McpApiError ? err.code : "verification failed";
      throw new InvalidTokenError(`Could not verify the MCP key (${detail}).`);
    }

    const authInfo: AuthInfo = {
      token,
      clientId: response.orgId,
      scopes: response.scopes,
      // Not floored: requireBearerAuth compares this against its own Date.now()/1000 a moment
      // later, and flooring here could already put expiresAt in the past for a short TTL
      // (observed as a spurious "Token has expired" under WCAGC_MCP_INTROSPECT_TTL_SECONDS=1 in
      // tests) — keep the same precision as the comparison it feeds.
      expiresAt: now + config.introspectCacheTtlSeconds,
      extra: { plan: response.plan, remainingToday: response.remainingToday },
    };
    pruneExpired(now);
    cache.set(token, { authInfo, cachedAt: now });
    return authInfo;
  },
};
