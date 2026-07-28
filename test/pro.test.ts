import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { FIX_ID, FIX_VERIFICATION_ID, SITE_HOST, TOKENS } from "./fixtures/api.js";
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
  assert.equal(res.structuredContent.pollWith, "get_scan");
  assert.ok(res.structuredContent.coverageDisclaimer);
  // POST /api/v1/scans answers with an id and a status only. Anything the summary claims beyond
  // that has to come from what the caller passed in, or it prints "undefined".
  assert.equal(res.structuredContent.scan.requestedUrl, `https://${SITE_HOST}/pricing`);
  assert.match(res.content[0].text, new RegExp(`Scan for https://${SITE_HOST}/pricing`));
  assert.doesNotMatch(res.content[0].text, /undefined/);
  await client.close();
});

// The other half of the round trip. A registered-site scan is absent from the one-off scan table,
// so polling it used to dead-end on SCAN_NOT_FOUND no matter which tool the caller reached for.
test("get_scan and get_findings follow a registered-site scan to the right endpoint", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const started: any = await client.callTool({
      name: "scan_url",
      arguments: { url: `https://${SITE_HOST}/pricing` },
    });
    const scanId = started.structuredContent.scan.id;

    const polled: any = await client.callTool({ name: "get_scan", arguments: { scanId } });
    assert.equal(polled.isError, undefined, JSON.stringify(polled.content));
    assert.equal(polled.structuredContent.recordedAgainstSite, true);
    assert.equal(polled.structuredContent.scan.totalViolations, 1);
    assert.ok(polled.structuredContent.coverageDisclaimer);
    assert.doesNotMatch(polled.content[0].text, /undefined/);

    const findings: any = await client.callTool({ name: "get_findings", arguments: { scanId } });
    assert.equal(findings.isError, undefined, JSON.stringify(findings.content));
    assert.equal(findings.structuredContent.recordedAgainstSite, true);
    assert.equal(findings.structuredContent.violations[0].ruleId, "image-alt");
    // The registered endpoint calls it `target`; callers only ever see `targetSelector`.
    assert.equal(findings.structuredContent.violations[0].targetSelector, "img.hero");
  } finally {
    await client.close();
  }
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

test("get_root_causes returns factual blast radius and the coverage disclaimer", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const result = await client.callTool({
      name: "get_root_causes",
      arguments: { runId: "33333333-3333-3333-3333-333333333333" },
    });
    assert.notEqual(result.isError, true);
    const structured = result.structuredContent as {
      rootCauses: {
        signatureVersion: string;
        clusters: Array<{ nodesCount: number; pagesCount: number }>;
        coverageDisclaimer: string;
      };
    };
    assert.equal(structured.rootCauses.signatureVersion, "rcg1");
    assert.equal(structured.rootCauses.clusters[0].nodesCount, 6);
    assert.equal(structured.rootCauses.clusters[0].pagesCount, 3);
    assert.ok(structured.rootCauses.coverageDisclaimer);
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.match(text, /6 finding\(s\) across 3 page\(s\)/);
    assert.match(text, /does not expand coverage/i);
    assert.doesNotMatch(text, /compliant|guarantee/i);
  } finally {
    await client.close();
  }
});

test("get_root_causes preserves the API_ACCESS paywall", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.FREE_OK);
  try {
    const result = await client.callTool({
      name: "get_root_causes",
      arguments: { runId: "33333333-3333-3333-3333-333333333333" },
    });
    assert.equal(result.isError, true);
    const structured = result.structuredContent as { code: string; targetPlan: string };
    assert.equal(structured.code, "FEATURE_NOT_IN_PLAN");
    assert.equal(structured.targetPlan, "PRO");
  } finally {
    await client.close();
  }
});

test("get_fixes lists proof scope and verify_fix returns a polling contract", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const listed: any = await client.callTool({ name: "get_fixes", arguments: { siteHost: SITE_HOST } });
    assert.equal(listed.isError, undefined);
    assert.equal(listed.structuredContent.fixes[0].id, FIX_ID);
    assert.ok(listed.structuredContent.coverageDisclaimer);

    const started: any = await client.callTool({ name: "verify_fix", arguments: { remediationItemId: FIX_ID } });
    assert.equal(started.isError, undefined);
    assert.equal(started.structuredContent.pollWith, "get_fix_verification");
    assert.equal(started.structuredContent.verification.id, FIX_VERIFICATION_ID);
    assert.match(started.content[0].text, /not a whole-site result/i);
  } finally {
    await client.close();
  }
});

test("get_fix_verification reports selected-page evidence without a compliance claim", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const result: any = await client.callTool({
      name: "get_fix_verification",
      arguments: { fixVerificationId: FIX_VERIFICATION_ID },
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.verification.outcome, "NOT_DETECTED");
    assert.match(result.content[0].text, /not detected on 3 selected page/i);
    assert.match(result.content[0].text, /does not establish a whole-site result/i);
    assert.doesNotMatch(result.content[0].text, /compliant|guarantee/i);
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
