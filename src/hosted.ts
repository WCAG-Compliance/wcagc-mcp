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
export const app = createMcpExpressApp({
  host: config.host,
  allowedHosts: config.allowedHosts.length > 0 ? config.allowedHosts : undefined,
});
app.use(express.json());

// Resource-server-only bearer auth (no OAuth Authorization Server — spec OQ-2, deferred): the
// bearer IS the org's MCP-scoped API key, verified by forwarding it to wcagc-api's introspect
// endpoint. resourceMetadataUrl / RFC 9728 discovery is intentionally not wired up this wave.
const auth = requireBearerAuth({ verifier: introspectVerifier, requiredScopes: ["mcp:scan"] });

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Stateless mode (SDK guidance: "suitable for simple API proxies... any server node can process
// requests" — exactly this service): a fresh McpServer + transport per request. Tool handlers
// hold no state beyond the request itself, so this costs nothing and needs no sticky sessions or
// session store across Fly machines.
app.post("/mcp", auth, async (req, res) => {
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
