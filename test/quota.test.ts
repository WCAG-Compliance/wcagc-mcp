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

test("scan_url — an exhausted FREE quota comes back as isError with code + targetPlan, not a protocol error", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.FREE_EXHAUSTED);
  try {
    const result = await client.callTool({ name: "scan_url", arguments: { url: "https://example.com" } });
    assert.equal(result.isError, true);
    const structured = result.structuredContent as { code: string; targetPlan: string; upgradeUrl?: string };
    assert.equal(structured.code, "PLAN_LIMIT_EXCEEDED");
    assert.equal(structured.targetPlan, "STARTER");
    assert.equal(structured.upgradeUrl, undefined);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes("PLAN_LIMIT_EXCEEDED"));
    assert.ok(content[0].text.includes("requires the STARTER plan"));
    assert.equal(content[0].text.includes("https://"), false);
  } finally {
    await client.close();
  }
});

test("scan_url — PRO's unlimited MCP_ACCESS quota never denies", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const first = await client.callTool({ name: "scan_url", arguments: { url: "https://example.com" } });
    const second = await client.callTool({ name: "scan_url", arguments: { url: "https://example.org" } });
    const third = await client.callTool({ name: "scan_url", arguments: { url: "https://example.net" } });
    assert.notEqual(first.isError, true);
    assert.notEqual(second.isError, true);
    assert.notEqual(third.isError, true);
  } finally {
    await client.close();
  }
});
