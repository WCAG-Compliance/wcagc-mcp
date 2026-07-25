function num(envVar: string | undefined, fallback: number): number {
  const n = Number(envVar);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return [...fallback];
  const items = raw.split(",").map((t) => t.trim()).filter(Boolean);
  return items.length > 0 ? items : [...fallback];
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
  // (createMcpExpressApp only auto-enables it for a localhost bind). Empty in local dev.
  allowedHosts: parseList(process.env.WCAGC_MCP_ALLOWED_HOSTS, []),

  // ── local (stdio) ──────────────────────────────────────────────────────────
  // The one MCP-scoped API key this local process authenticates every backend call with.
  mcpKey: process.env.WCAGC_MCP_KEY,

  // ── backend ──────────────────────────────────────────────────────────────
  // Defaults to the hosted API because this package is installed by end users: the README's own
  // client config sets only WCAGC_MCP_KEY, so a localhost default meant anyone following our
  // instructions got a server quietly pointing at a machine-local port that isn't there.
  // Local development and self-hosting set this explicitly (tests always do).
  apiBaseUrl: process.env.WCAGC_API_BASE_URL ?? "https://api.wcagc.com",
  requestTimeoutMs: num(process.env.WCAGC_MCP_REQUEST_TIMEOUT_MS, 15_000),
  // How long a verified introspection result is trusted before the hosted transport re-checks
  // it — bounds staleness after a revocation/plan change without hammering the API per tool call.
  introspectCacheTtlSeconds: num(process.env.WCAGC_MCP_INTROSPECT_TTL_SECONDS, 60),

  // ── check_pdf url fetch (wcagc-api only accepts multipart bytes — see src/pdf-fetch.ts) ──
  pdfFetchTimeoutMs: num(process.env.WCAGC_MCP_PDF_FETCH_TIMEOUT_MS, 10_000),
  pdfFetchMaxBytes: num(process.env.WCAGC_MCP_PDF_FETCH_MAX_BYTES, 10 * 1024 * 1024),
  // Private-host allowlist for the SSRF guard — empty in production; test fixtures set this to
  // reach their own loopback server (mirrors wcagc-worker's WORKER_ALLOWED_PRIVATE_HOSTS).
  pdfFetchAllowedPrivateHosts: parseList(process.env.WCAGC_MCP_PDF_FETCH_ALLOWED_HOSTS, []),

  // Base URL used to build a paywall hint's upgradeUrl from a ProblemDetail's targetPlan.
  pricingUrl: process.env.WCAGC_MCP_PRICING_URL ?? "https://wcagc.com/pricing",
};
