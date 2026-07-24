import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createFixtureApp, listen as listenFixture } from "../fixtures/api.js";

export interface Harness {
  mcpUrl: string;
  close(): Promise<void>;
}

/**
 * Starts the fixture wcagc-api stand-in, points config at it via env, then imports the real
 * hosted.ts and mounts its Express app on its own ephemeral port. Each test file is its own
 * node:test child process (the default for multiple file args), so this env-then-import
 * ordering is safe per file — hosted.ts reads config at module-load time.
 */
export async function startHarness(): Promise<Harness> {
  const fixture = await listenFixture(createFixtureApp());
  process.env.WCAGC_API_BASE_URL = fixture.url;
  process.env.WCAGC_MCP_PDF_FETCH_ALLOWED_HOSTS = "127.0.0.1";
  // A short TTL doesn't make tests faster (TTL only governs re-introspect frequency, not wall
  // clock), and too short a value leaves no slack for real request latency between this code's
  // own expiry check and requireBearerAuth's — 30s gives headroom for a whole test file's calls.
  process.env.WCAGC_MCP_INTROSPECT_TTL_SECONDS = "30";

  const { app } = await import("../../src/hosted.js");
  const server: Server = await new Promise((resolve) => {
    const s: Server = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;

  return {
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fixture.close();
    },
  };
}

export async function connectedClient(mcpUrl: string, token: string) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({ name: "wcagc-mcp-test-client", version: "0.0.1" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}
