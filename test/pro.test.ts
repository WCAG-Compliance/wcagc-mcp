import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { SITE_HOST, TOKENS } from "./fixtures/api.js";
import { connectedClient, startHarness, type Harness } from "./helpers/harness.js";

let harness: Harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await harness.close();
});

test("list_sites returns the org's registered sites", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const result = await client.callTool({ name: "list_sites", arguments: {} });
    assert.notEqual(result.isError, true);
    const structured = result.structuredContent as { sites: Array<{ normalizedHost: string }> };
    assert.equal(structured.sites[0].normalizedHost, "example.com");
  } finally {
    await client.close();
  }
});

test("scan_url records the scan against a registered site without being told to", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  const res: any = await client.callTool({
    name: "scan_url",
    arguments: { url: `https://${SITE_HOST}/pricing` },
  });
  assert.equal(res.isError, undefined);
  assert.equal(res.structuredContent.recordedAgainstSite, true);
  assert.equal(res.structuredContent.pollWith, "get_run");
  assert.ok(res.structuredContent.coverageDisclaimer);
  await client.close();
});

// The whole point: an unregistered URL still scans. The caller passes a URL and gets a result —
// it never has to know whether the site exists, nor retry with different arguments.
test("scan_url falls back to a one-off scan for an unregistered URL, and says so", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  const res: any = await client.callTool({
    name: "scan_url",
    arguments: { url: "https://not-registered.example/" },
  });
  assert.equal(res.isError, undefined);
  assert.equal(res.structuredContent.recordedAgainstSite, false);
  assert.equal(res.structuredContent.pollWith, "get_scan");
  assert.match(res.content[0].text, /not a registered site/i);
  assert.match(res.content[0].text, /Add the site under Sites/i);
  await client.close();
});

test("scan_site queues a full-site run and get_run reads it back, both carrying the disclaimer", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const started = await client.callTool({ name: "scan_site", arguments: { siteHost: "example.com" } });
    assert.notEqual(started.isError, true);
    const startedStructured = started.structuredContent as { coverageDisclaimer: string; run: { id: string } };
    assert.ok(startedStructured.coverageDisclaimer);

    const run = await client.callTool({ name: "get_run", arguments: { runId: startedStructured.run.id } });
    assert.notEqual(run.isError, true);
  } finally {
    await client.close();
  }
});

test("scan_site against an unknown siteHost fails with SITE_NOT_FOUND, not a crash", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const result = await client.callTool({ name: "scan_site", arguments: { siteHost: "not-registered.example" } });
    assert.equal(result.isError, true);
    const structured = result.structuredContent as { code: string };
    assert.equal(structured.code, "SITE_NOT_FOUND");
  } finally {
    await client.close();
  }
});

test("run_journey resolves a journey by name, queues a run, and get_journey_run polls it", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const started = await client.callTool({
      name: "run_journey",
      arguments: { siteHost: "example.com", journeyName: "Checkout" },
    });
    assert.notEqual(started.isError, true);
    const structured = started.structuredContent as { run: { id: string; checkpoints: unknown[] } };
    assert.ok(Array.isArray(structured.run.checkpoints));

    const polled = await client.callTool({ name: "get_journey_run", arguments: { runId: structured.run.id } });
    assert.notEqual(polled.isError, true);
  } finally {
    await client.close();
  }
});

test("run_journey with an unknown journey name fails with JOURNEY_NOT_FOUND", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const result = await client.callTool({
      name: "run_journey",
      arguments: { siteHost: "example.com", journeyName: "Does Not Exist" },
    });
    assert.equal(result.isError, true);
    const structured = result.structuredContent as { code: string };
    assert.equal(structured.code, "JOURNEY_NOT_FOUND");
  } finally {
    await client.close();
  }
});

test("get_trends reads the site's trend and carries the disclaimer, no score", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const result = await client.callTool({ name: "get_trends", arguments: { siteHost: "example.com" } });
    assert.notEqual(result.isError, true);
    const structured = result.structuredContent as { coverageDisclaimer: string; trend: { points: unknown[] } };
    assert.ok(structured.coverageDisclaimer);
    assert.ok(structured.trend.points.length > 0);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(!/"?score"?\s*:\s*[0-9]/i.test(content[0].text));
  } finally {
    await client.close();
  }
});

// A scope denial used to surface as a bare "the API key does not grant the required scope",
// leaving the assistant with no way to know which scope, or that the fix is a differently-scoped
// key rather than a retry. The API names the scope; make sure it reaches the caller.
test("a scope denial names the missing scope and how to obtain it", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.MCP_ONLY);
  const res: any = await client.callTool({ name: "list_sites", arguments: {} });
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent.code, "API_KEY_SCOPE_MISSING");
  assert.equal(res.structuredContent.requiredScope, "sites:read");
  assert.match(res.content[0].text, /sites:read/);
  assert.match(res.content[0].text, /mcp:scan-only key cannot reach it/);
  await client.close();
});

