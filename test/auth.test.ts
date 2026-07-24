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
  assert.ok(res.headers.get("www-authenticate"), "expected a WWW-Authenticate challenge header");
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
