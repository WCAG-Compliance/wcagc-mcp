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

/** The tools that queue work or spend quota. Everything else must declare itself read-only. */
const WRITES = new Set(["scan_url", "scan_site", "check_pdf", "run_journey"]);

/**
 * Both directories gate listing on this: every tool needs a title and a truthful read-only or
 * destructive hint, and a client shows the write ones differently (Claude asks before running an
 * unannotated tool as if it were destructive). Asserting it here rather than trusting a review
 * pass means a tool added later cannot quietly ship without them.
 */
test("every tool declares a title and honest annotations", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0);

    for (const tool of tools) {
      const annotations = tool.annotations ?? {};
      assert.ok(tool.title, `${tool.name} has no title`);
      assert.ok(annotations.title, `${tool.name} has no annotations.title`);
      assert.equal(annotations.readOnlyHint, !WRITES.has(tool.name), `${tool.name} readOnlyHint`);
      // Nothing this server exposes deletes or overwrites anything: a scan only ever appends.
      assert.equal(annotations.destructiveHint, false, `${tool.name} destructiveHint`);
      // Only the tools that go out and load a page or a file reach an open world. The readers
      // answer from the account's own records, which is a closed, enumerable domain — claiming
      // otherwise on all twelve was less informative, not more cautious.
      assert.equal(annotations.openWorldHint, WRITES.has(tool.name), `${tool.name} openWorldHint`);
      assert.equal(typeof annotations.idempotentHint, "boolean", `${tool.name} idempotentHint`);
    }
  } finally {
    await client.close();
  }
});

test("every tool publishes an output schema, so structuredContent is checkable", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      assert.ok(tool.outputSchema, `${tool.name} has no outputSchema`);
      assert.equal(tool.outputSchema.type, "object", `${tool.name} outputSchema type`);
    }
  } finally {
    await client.close();
  }
});

/**
 * The catalog is the contract callers and directory listings are built against, so a tool
 * appearing, vanishing or being renamed should be a deliberate edit here, not a surprise.
 */
test("the tool catalog is exactly the twelve documented tools", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "check_pdf", "get_findings", "get_journey_run", "get_pdf_check", "get_run",
      "get_run_findings", "get_scan", "get_trends", "list_sites", "run_journey",
      "scan_site", "scan_url",
    ]);
  } finally {
    await client.close();
  }
});
