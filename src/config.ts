function num(envVar: string | undefined, fallback: number): number {
  const n = Number(envVar);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return [...fallback];
  const items = raw.split(",").map((t) => t.trim()).filter(Boolean);
  return items.length > 0 ? items : [...fallback];
}

const apiBaseUrl = process.env.WCAGC_API_BASE_URL ?? "https://api.wcagc.com";
const oauthIssuer = process.env.WCAGC_MCP_OAUTH_ISSUER ?? apiBaseUrl;
const mcpServerUrl = process.env.WCAGC_MCP_URL ?? "https://mcp.wcagc.com/mcp";

export function resolveAllowedHosts(envUrl = mcpServerUrl, nodeEnv = process.env.NODE_ENV): string[] {
  const fromEnv = parseList(process.env.WCAGC_MCP_ALLOWED_HOSTS, []);
  if (fromEnv.length > 0) return fromEnv;
  if (nodeEnv === "production") {
    try {
      const parsed = new URL(envUrl);
      if (parsed.hostname) {
        return [parsed.hostname];
      }
    } catch {
      // invalid URL
    }
    throw new Error(
      "Fatal: In production mode, WCAGC_MCP_ALLOWED_HOSTS must be set or WCAGC_MCP_URL must provide a valid hostname to prevent DNS rebinding."
    );
  }
  return ["localhost", "127.0.0.1", "[::1]"];
}

export function resolveAllowedOrigins(envUrl = mcpServerUrl, nodeEnv = process.env.NODE_ENV): string[] {
  const fromEnv = parseList(process.env.WCAGC_MCP_ALLOWED_ORIGINS, []);
  if (fromEnv.length > 0) return fromEnv;
  if (nodeEnv === "production") {
    let hostname: string | undefined;
    try {
      hostname = new URL(envUrl).hostname;
    } catch {
      // invalid URL
    }
    return [
      ...(hostname ? [hostname] : []),
      "wcagc.com",
      "app.wcagc.com",
      "claude.ai",
      "chatgpt.com",
      "chat.openai.com",
    ];
  }
  return ["localhost", "127.0.0.1", "[::1]"];
}

/**
 * wcagc-mcp holds no secrets of its own beyond these — it is a thin adapter that translates MCP
 * tool calls into wcagc-api HTTP calls, forwarding the caller's own bearer (ARCHITECTURE §8).
 */
export const config = {
  // ── hosted (Streamable HTTP) ──────────────────────────────────────────────
  port: num(process.env.PORT, 8080),
  host: process.env.WCAGC_MCP_HOST ?? "0.0.0.0",
  // Host-header allowlist for the SDK's DNS-rebinding protection when bound to 0.0.0.0
  // Derived safely from mcpServerUrl in production, with fail-fast validation.
  allowedHosts: resolveAllowedHosts(),
  allowedOrigins: resolveAllowedOrigins(),

  // ── local (stdio) ──────────────────────────────────────────────────────────
  // The one MCP-scoped API key this local process authenticates every backend call with.
  mcpKey: process.env.WCAGC_MCP_KEY,

  // ── backend ──────────────────────────────────────────────────────────────
  // Defaults to the hosted API because this package is installed by end users: the README's own
  // client config sets only WCAGC_MCP_KEY, so a localhost default meant anyone following our
  // instructions got a server quietly pointing at a machine-local port that isn't there.
  // Local development and self-hosting set this explicitly (tests always do).
  apiBaseUrl,
  requestTimeoutMs: num(process.env.WCAGC_MCP_REQUEST_TIMEOUT_MS, 15_000),
  // How long a verified introspection result is trusted before the hosted transport re-checks
  // it — bounds staleness after a revocation/plan change without hammering the API per tool call.
  introspectCacheTtlSeconds: num(process.env.WCAGC_MCP_INTROSPECT_TTL_SECONDS, 60),
  oauthIssuer,
  oauthJwksUrl: process.env.WCAGC_MCP_OAUTH_JWKS_URL ?? `${oauthIssuer}/oauth2/jwks`,
  mcpServerUrl,
  // OpenAI supplies this token during Plugins Directory domain verification. It stays in the
  // deployment secret store; the hosted server exposes it verbatim only on the well-known path.
  openAiAppsChallenge: process.env.WCAGC_OPENAI_APPS_CHALLENGE,
  jwksCacheTtlSeconds: num(process.env.WCAGC_MCP_JWKS_TTL_SECONDS, 300),

  // ── check_pdf url fetch (wcagc-api only accepts multipart bytes — see src/pdf-fetch.ts) ──
  pdfFetchTimeoutMs: num(process.env.WCAGC_MCP_PDF_FETCH_TIMEOUT_MS, 10_000),
  pdfFetchMaxBytes: num(process.env.WCAGC_MCP_PDF_FETCH_MAX_BYTES, 10 * 1024 * 1024),
  // Private-host allowlist for the SSRF guard — empty in production; test fixtures set this to
  // reach their own loopback server (mirrors wcagc-worker's WORKER_ALLOWED_PRIVATE_HOSTS).
  pdfFetchAllowedPrivateHosts: parseList(process.env.WCAGC_MCP_PDF_FETCH_ALLOWED_HOSTS, []),

  // Base URL used to build a paywall hint's upgradeUrl from a ProblemDetail's targetPlan.
  pricingUrl: process.env.WCAGC_MCP_PRICING_URL ?? "https://wcagc.com/pricing",
};
