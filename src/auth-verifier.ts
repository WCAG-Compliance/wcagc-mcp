import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto";
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

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  sub?: string;
  org_id?: string;
  connection_id?: string;
  client_id?: string;
  scope?: string | string[];
}

interface JwksResponse {
  keys: JsonWebKey[];
}

let jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | undefined;

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

function decodePart<T>(value: string): T {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    throw new InvalidTokenError("Invalid OAuth access token.");
  }
}

async function fetchJwks(force = false): Promise<JsonWebKey[]> {
  const now = Date.now() / 1000;
  if (!force && jwksCache && now - jwksCache.fetchedAt < config.jwksCacheTtlSeconds) {
    return jwksCache.keys;
  }

  let response: Response;
  try {
    response = await fetch(config.oauthJwksUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch {
    throw new InvalidTokenError("Could not verify the OAuth access token.");
  }
  if (!response.ok) {
    throw new InvalidTokenError("Could not verify the OAuth access token.");
  }

  const body = await response.json() as Partial<JwksResponse>;
  if (!Array.isArray(body.keys)) {
    throw new InvalidTokenError("Could not verify the OAuth access token.");
  }
  jwksCache = { keys: body.keys, fetchedAt: now };
  return body.keys;
}

function jwtScopes(claim: JwtClaims["scope"]): string[] {
  if (Array.isArray(claim)) return claim.filter((scope): scope is string => typeof scope === "string");
  return typeof claim === "string" ? claim.split(/\s+/).filter(Boolean) : [];
}

async function verifyJwt(token: string): Promise<AuthInfo> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new InvalidTokenError("Invalid OAuth access token.");

  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = decodePart<JwtHeader>(encodedHeader);
  const claims = decodePart<JwtClaims>(encodedClaims);
  if (header.alg !== "RS256" || !header.kid) throw new InvalidTokenError("Invalid OAuth access token.");

  let keys = await fetchJwks();
  let key = keys.find((candidate) => candidate.kid === header.kid);
  if (!key) {
    keys = await fetchJwks(true);
    key = keys.find((candidate) => candidate.kid === header.kid);
  }
  if (!key) throw new InvalidTokenError("Invalid OAuth access token.");

  let signatureValid = false;
  try {
    signatureValid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      createPublicKey({ key, format: "jwk" }),
      Buffer.from(encodedSignature, "base64url"),
    );
  } catch {
    throw new InvalidTokenError("Invalid OAuth access token.");
  }
  if (!signatureValid) throw new InvalidTokenError("Invalid OAuth access token.");

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  const scopes = jwtScopes(claims.scope);
  if (
    claims.iss !== config.oauthIssuer
    || !audiences.includes(config.mcpServerUrl)
    || typeof claims.exp !== "number"
    || claims.exp <= now
    || (typeof claims.nbf === "number" && claims.nbf > now)
    || !claims.sub
    || !claims.org_id
    || !claims.connection_id
    || !claims.client_id
    || !scopes.includes("mcp:scan")
  ) {
    throw new InvalidTokenError("Invalid OAuth access token.");
  }

  return {
    token,
    clientId: claims.client_id,
    scopes,
    expiresAt: claims.exp,
    resource: new URL(config.mcpServerUrl),
    extra: {
      organizationId: claims.org_id,
      connectionId: claims.connection_id,
      subjectId: claims.sub,
    },
  };
}

export const oauthJwtVerifier: OAuthTokenVerifier = {
  verifyAccessToken: verifyJwt,
};

export const bearerVerifier: OAuthTokenVerifier = {
  verifyAccessToken(token: string): Promise<AuthInfo> {
    return token.startsWith("wcagc_")
      ? introspectVerifier.verifyAccessToken(token)
      : oauthJwtVerifier.verifyAccessToken(token);
  },
};
