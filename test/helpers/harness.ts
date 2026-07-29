import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, sign } from "node:crypto";
import { createFixtureApp, listen as listenFixture } from "../fixtures/api.js";

export interface Harness {
  mcpUrl: string;
  metadataUrl: string;
  openAiAppsChallengeUrl: string;
  oauthToken(overrides?: Record<string, unknown>, keyId?: string): string;
  close(): Promise<void>;
}

/**
 * Starts the fixture wcagc-api stand-in, points config at it via env, then imports the real
 * hosted.ts and mounts its Express app on its own ephemeral port. Each test file is its own
 * node:test child process (the default for multiple file args), so this env-then-import
 * ordering is safe per file — hosted.ts reads config at module-load time.
 */
export async function startHarness(): Promise<Harness> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyId = "test-oauth-key";
  const publicJwk = publicKey.export({ format: "jwk" });
  publicJwk.kid = keyId;
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";
  const fixture = await listenFixture(createFixtureApp({ jwks: [publicJwk] }));
  process.env.WCAGC_API_BASE_URL = fixture.url;
  process.env.WCAGC_MCP_OAUTH_ISSUER = fixture.url;
  process.env.WCAGC_MCP_URL = "https://mcp.wcagc.com/mcp";
  process.env.WCAGC_OPENAI_APPS_CHALLENGE = "test-openai-apps-challenge";
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
  const oauthToken = (overrides: Record<string, unknown> = {}, kid = keyId): string => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({
      iss: fixture.url,
      aud: "https://mcp.wcagc.com/mcp",
      exp: now + 900,
      iat: now,
      sub: "user-oauth",
      org_id: "org-oauth",
      connection_id: "connection-oauth",
      client_id: "client-oauth",
      scope: "mcp:scan",
      ...overrides,
    })).toString("base64url");
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey).toString("base64url");
    return `${header}.${claims}.${signature}`;
  };

  return {
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
    metadataUrl: `http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`,
    openAiAppsChallengeUrl: `http://127.0.0.1:${port}/.well-known/openai-apps-challenge`,
    oauthToken,
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
