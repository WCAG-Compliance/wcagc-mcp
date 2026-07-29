import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { TOKENS } from "./fixtures/api.js";
import { connectedClient, startHarness, type Harness } from "./helpers/harness.js";

let harness: Harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await harness.close();
});

test("no bearer — 401 with a WWW-Authenticate challenge, never a bare crash", async () => {
  const res = await fetch(harness.mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.equal(res.status, 401);
  const challenge = res.headers.get("www-authenticate");
  assert.ok(challenge, "expected a WWW-Authenticate challenge header");
  assert.match(challenge, /resource_metadata="https:\/\/mcp\.wcagc\.com\/\.well-known\/oauth-protected-resource\/mcp"/);
});

test("RFC 9728 metadata advertises the managed authorization server without DCR", async () => {
  const res = await fetch(harness.metadataUrl);
  assert.equal(res.status, 200);
  const metadata = await res.json() as Record<string, unknown>;
  assert.equal(metadata.resource, "https://mcp.wcagc.com/mcp");
  assert.deepEqual(metadata.authorization_servers, [process.env.WCAGC_MCP_OAUTH_ISSUER]);
  assert.deepEqual(metadata.scopes_supported, ["mcp:scan"]);
});

test("OpenAI Apps domain challenge returns the configured token verbatim", async () => {
  const res = await fetch(harness.openAiAppsChallengeUrl);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(await res.text(), "test-openai-apps-challenge");
});

test("a valid managed OAuth JWT can initialize an MCP session", async () => {
  const client = await connectedClient(harness.mcpUrl, harness.oauthToken());
  await client.close();
});

test("OAuth JWTs with a foreign audience, expired timestamp, or unknown kid are rejected", async () => {
  const invalidTokens = [
    harness.oauthToken({ aud: "https://other.example/mcp" }),
    harness.oauthToken({ exp: Math.floor(Date.now() / 1000) - 1 }),
    harness.oauthToken({}, "unknown-kid"),
  ];
  for (const token of invalidTokens) {
    const res = await fetch(harness.mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(res.status, 401);
  }
});

test("wrong scope / unknown token — 401, not a silent pass-through", async () => {
  const res = await fetch(harness.mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer not-a-real-token",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.equal(res.status, 401);
});

test("a valid bearer never appears in process logs across a full tool call", async () => {
  const captured: string[] = [];
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const capture = (...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;
  console.debug = capture;

  try {
    const client = await connectedClient(harness.mcpUrl, TOKENS.FREE_OK);
    try {
      await client.callTool({ name: "scan_url", arguments: { url: "https://example.com" } });
    } finally {
      await client.close();
    }
  } finally {
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
    console.debug = originals.debug;
  }

  const leaked = captured.some((line) => line.includes(TOKENS.FREE_OK));
  assert.equal(leaked, false, `bearer token leaked into logs: ${JSON.stringify(captured)}`);
});
