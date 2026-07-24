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

test("scan_url with siteHost routes to the registered-site v1 path and still carries the disclaimer", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const result = await client.callTool({
      name: "scan_url",
      arguments: { url: "https://example.com/checkout", siteHost: "example.com" },
    });
    assert.notEqual(result.isError, true);
    const structured = result.structuredContent as { coverageDisclaimer: string; scan: { siteId: string } };
    assert.ok(structured.coverageDisclaimer.includes("Automated testing finds only a portion"));
    assert.ok(structured.scan.siteId);
  } finally {
    await client.close();
  }
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
