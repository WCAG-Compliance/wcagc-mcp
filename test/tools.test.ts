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

test("scan_url — happy path carries the coverage disclaimer in both text and structuredContent", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.FREE_OK);
  try {
    const result = await client.callTool({ name: "scan_url", arguments: { url: "https://example.com" } });
    assert.notEqual(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes("Automated testing finds only a portion"));
    const structured = result.structuredContent as { coverageDisclaimer: string; standard: string; scan: { id: string } };
    assert.ok(structured.coverageDisclaimer.includes("Automated testing finds only a portion"));
    assert.equal(structured.standard, "WCAG 2.1 AA");
    assert.ok(structured.scan.id);
  } finally {
    await client.close();
  }
});

test("get_scan and get_findings — read an existing scan", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.FREE_OK);
  try {
    const scan = await client.callTool({ name: "get_scan", arguments: { scanId: "11111111-1111-1111-1111-111111111111" } });
    assert.notEqual(scan.isError, true);
    const findings = await client.callTool({ name: "get_findings", arguments: { scanId: "11111111-1111-1111-1111-111111111111" } });
    assert.notEqual(findings.isError, true);
    const structured = findings.structuredContent as { violations: unknown[] };
    assert.ok(Array.isArray(structured.violations));
  } finally {
    await client.close();
  }
});

/**
 * Regression: ChatGPT read passesCount 30 / incompleteCount 1 off a wcagc.com scan and reported
 * "97/100" (2026-07-27). The refusal has to reach the assistant with the numbers, in both
 * channels, or the next model does the same arithmetic.
 */
test("a result carrying counts also carries the instruction not to score them", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.FREE_OK);
  try {
    const result: any = await client.callTool({
      name: "get_scan",
      arguments: { scanId: "11111111-1111-1111-1111-111111111111" },
    });
    assert.notEqual(result.isError, true);
    for (const channel of [result.content[0].text, result.structuredContent.scoringGuidance]) {
      assert.match(channel, /not turn these counts into a score/i);
      assert.match(channel, /do not describe the page as compliant or accessible/i);
    }
    assert.ok(result.structuredContent.coverageDisclaimer);
  } finally {
    await client.close();
  }
});

test("check_pdf — happy path fetches the URL and carries PDF/UA-1 + disclaimer", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const pdfUrl = new URL("/fixture.pdf", process.env.WCAGC_API_BASE_URL).toString();
    const result = await client.callTool({ name: "check_pdf", arguments: { url: pdfUrl } });
    assert.notEqual(result.isError, true);
    const structured = result.structuredContent as { coverageDisclaimer: string; standard: string; pdfCheck: { id: string } };
    assert.equal(structured.standard, "PDF/UA-1");
    assert.ok(structured.coverageDisclaimer.includes("Automated testing finds only a portion"));
    assert.ok(structured.pdfCheck.id);
  } finally {
    await client.close();
  }
});

test("check_pdf — rejects a private-host URL (SSRF guard) unless explicitly allowlisted", async () => {
  const client = await connectedClient(harness.mcpUrl, TOKENS.PRO);
  try {
    const result = await client.callTool({ name: "check_pdf", arguments: { url: "http://169.254.169.254/latest/meta-data/" } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes("INVALID_URL"));
  } finally {
    await client.close();
  }
});
