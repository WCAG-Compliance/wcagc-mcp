import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { pathToFileURL } from "node:url";
import { bearerVerifier } from "./auth-verifier.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { VERSION, buildServer } from "./server.js";

// allowedHosts must stay undefined (not []) when unset — an explicit empty array opts into
// Host-header validation with a zero-entry allowlist, rejecting every request.
const mcpApp = createMcpExpressApp({
  host: config.host,
  allowedHosts: config.allowedHosts.length > 0 ? config.allowedHosts : undefined,
});
mcpApp.use(express.json());

// The SDK applies Host-header validation (DNS-rebinding protection) as GLOBAL middleware, so it
// also rejects the platform's own health probe: Fly connects straight to the machine and sends
// `Host: <internal-ip>`, which is not — and cannot sensibly be — in the public allowlist, so
// /health answered 403 "Invalid Host" and the deploy timed out waiting for a check that could
// never pass. Serve /health from an outer app mounted BEFORE the SDK's app so the probe is
// exempt while /mcp keeps full protection. Exempting it is safe: it returns a fixed status and
// no request-specific or sensitive data, so reaching it via rebinding reveals nothing.
export const app = express();
// `version` is the parity signal: the release workflow polls this after deploying and fails the
// release unless it matches the version being published to npm, so "what runs on Fly" and "what
// `npx @wcagc/mcp` installs" can never silently drift apart.
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", version: VERSION });
});
app.get("/.well-known/openai-apps-challenge", (_req, res) => {
  if (!config.openAiAppsChallenge) {
    res.sendStatus(404);
    return;
  }
  res.status(200).type("text/plain").send(config.openAiAppsChallenge);
});
const issuer = config.oauthIssuer.replace(/\/+$/, "");
const oauthMetadata: OAuthMetadata = {
  issuer,
  authorization_endpoint: `${issuer}/oauth2/authorize`,
  token_endpoint: `${issuer}/oauth2/token`,
  jwks_uri: `${issuer}/oauth2/jwks`,
  revocation_endpoint: `${issuer}/oauth2/revoke`,
  scopes_supported: ["mcp:scan"],
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
  code_challenge_methods_supported: ["S256"],
};
app.use(mcpAuthMetadataRouter({
  oauthMetadata,
  resourceServerUrl: new URL(config.mcpServerUrl),
  serviceDocumentationUrl: new URL("https://wcagc.com/integrations/mcp"),
  scopesSupported: ["mcp:scan"],
  resourceName: "wcagc MCP",
}));
app.use(mcpApp);

// Hosted clients use OAuth JWTs discovered through RFC 9728. The existing wcagc_ API-key path
// remains supported for local/CI clients and is still introspected by wcagc-api.
const auth = requireBearerAuth({
  verifier: bearerVerifier,
  requiredScopes: ["mcp:scan"],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(config.mcpServerUrl)),
});

// Stateless mode (SDK guidance: "suitable for simple API proxies... any server node can process
// requests" — exactly this service): a fresh McpServer + transport per request. Tool handlers
// hold no state beyond the request itself, so this costs nothing and needs no sticky sessions or
// session store across Fly machines.
mcpApp.post("/mcp", auth, async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error("Unhandled error serving /mcp", err instanceof Error ? err.message : err);
    if (!res.headersSent) {
      res.status(500).json({ error: "internal_error" });
    }
  }
});

// Guarded so test/tools.test.ts can import `app` and mount it on an ephemeral port itself
// without also triggering this module's own fixed-port listener.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  app.listen(config.port, () => {
    logger.info(`wcagc-mcp listening on :${config.port}`);
  });
}
