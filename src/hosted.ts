import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { pathToFileURL } from "node:url";
import { introspectVerifier } from "./auth-verifier.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { buildServer } from "./server.js";

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
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});
app.use(mcpApp);

// Resource-server-only bearer auth (no OAuth Authorization Server — spec OQ-2, deferred): the
// bearer IS the org's MCP-scoped API key, verified by forwarding it to wcagc-api's introspect
// endpoint. resourceMetadataUrl / RFC 9728 discovery is intentionally not wired up this wave.
const auth = requireBearerAuth({ verifier: introspectVerifier, requiredScopes: ["mcp:scan"] });

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
