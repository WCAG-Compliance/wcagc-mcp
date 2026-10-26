import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { TOKENS } from "./fixtures/api.js";
import { startHarness, type Harness } from "./helpers/harness.js";

function rawHttpRequest(
  targetUrl: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  const u = new URL(targetUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

let harness: Harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await harness.close();
});

test("Legacy MCP 2024-11-05 client lifecycle using Client SDK", async () => {
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
  const client = new Client(
    { name: "test-legacy-2024-11-05", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } }
  );
  const transport = new StreamableHTTPClientTransport(new URL(harness.mcpUrl), {
    protocolVersion: "2024-11-05",
    requestInit: { headers: { Authorization: `Bearer ${TOKENS.FREE_OK}` } },
  });

  await client.connect(transport);
  try {
    assert.equal(client.getProtocolEra(), "legacy");
    assert.equal(client.getServerVersion()?.name, "wcagc");
    if (transport.protocolVersion) {
      assert.ok(["2024-11-05", "2025-11-25"].includes(transport.protocolVersion));
    }

    // 1. tools/list
    const tools = await client.listTools();
    assert.ok(tools.tools.length > 0);
    const getScanTool = tools.tools.find((t) => t.name === "get_scan");
    assert.ok(getScanTool, "get_scan tool must be listed");

    // 2. tools/call read-only tool (get_scan)
    const readResult = await client.callTool({
      name: "get_scan",
      arguments: { scanId: "11111111-1111-4111-8111-111111111111" },
    });
    assert.notEqual(readResult.isError, true);
    assert.ok(readResult.content.length > 0);

    // 3. tools/call work-queuing tool (scan_url)
    const queueResult = await client.callTool({
      name: "scan_url",
      arguments: { url: "https://example.com" },
    });
    assert.notEqual(queueResult.isError, true);
    assert.ok(queueResult.structuredContent);
  } finally {
    await client.close();
  }
});

test("Legacy MCP 2025-11-25 client lifecycle using Client SDK", async () => {
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
  const client = new Client(
    { name: "test-legacy-2025-11-25", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } }
  );
  const transport = new StreamableHTTPClientTransport(new URL(harness.mcpUrl), {
    protocolVersion: "2025-11-25",
    requestInit: { headers: { Authorization: `Bearer ${TOKENS.FREE_OK}` } },
  });

  await client.connect(transport);
  try {
    assert.equal(client.getProtocolEra(), "legacy");
    assert.equal(client.getServerVersion()?.name, "wcagc");
    if (transport.protocolVersion) {
      assert.equal(transport.protocolVersion, "2025-11-25");
    }

    // 1. tools/list
    const tools = await client.listTools();
    assert.ok(tools.tools.length > 0);

    // 2. read-only tool
    const readResult = await client.callTool({
      name: "get_scan",
      arguments: { scanId: "11111111-1111-4111-8111-111111111111" },
    });
    assert.notEqual(readResult.isError, true);

    // 3. work-queuing tool
    const queueResult = await client.callTool({
      name: "scan_url",
      arguments: { url: "https://example.com" },
    });
    assert.notEqual(queueResult.isError, true);
  } finally {
    await client.close();
  }
});

test("Legacy client auth error handling — invalid or missing bearer rejected", async () => {
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
  
  // Missing auth header
  const unauthClient = new Client({ name: "test-unauth", version: "1.0.0" });
  const unauthTransport = new StreamableHTTPClientTransport(new URL(harness.mcpUrl), {
    protocolVersion: "2024-11-05",
  });
  await assert.rejects(
    () => unauthClient.connect(unauthTransport),
    (err: any) =>
      err?.data?.status === 401 ||
      String(err).includes("401") ||
      String(err).includes("invalid_token") ||
      String(err).includes("Missing Authorization"),
  );

  // Invalid bearer
  const badAuthClient = new Client({ name: "test-bad-auth", version: "1.0.0" });
  const badAuthTransport = new StreamableHTTPClientTransport(new URL(harness.mcpUrl), {
    protocolVersion: "2024-11-05",
    requestInit: { headers: { Authorization: "Bearer totally-invalid-token" } },
  });
  await assert.rejects(
    () => badAuthClient.connect(badAuthTransport),
    (err: any) =>
      err?.data?.status === 401 ||
      String(err).includes("401") ||
      String(err).includes("invalid_token") ||
      String(err).includes("Could not verify"),
  );
});

test("Modern MCP 2026-07-28 handshake, discover probe, and schema validation", async () => {
  const token = harness.oauthToken();

  // 1. Direct server/discover probe with modern protocol version header and body
  const discoverRes = await fetch(harness.mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "server/discover",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "discover-probe-1",
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test-probe-client", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  assert.equal(discoverRes.status, 200);
  const discoverJson = await discoverRes.json() as any;
  assert.equal(discoverJson.jsonrpc, "2.0");
  assert.equal(discoverJson.id, "discover-probe-1");
  assert.ok(discoverJson.result);
  assert.equal(discoverJson.result._meta?.["io.modelcontextprotocol/serverInfo"]?.name, "wcagc");

  // 2. Modern client handshake via Client SDK with pinned 2026-07-28 versionNegotiation
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
  const modernClient = new Client(
    { name: "test-modern-client", version: "2.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  );
  const modernTransport = new StreamableHTTPClientTransport(new URL(harness.mcpUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${TOKENS.PRO}`,
      },
    },
  });
  await modernClient.connect(modernTransport);
  try {
    assert.equal(modernClient.getProtocolEra(), "modern");
    assert.equal(modernClient.getNegotiatedProtocolVersion(), "2026-07-28");
    assert.equal(modernClient.getServerVersion()?.name, "wcagc");
    assert.equal(modernClient.getServerVersion()?.version, "0.8.0");
    const discover = modernClient.getDiscoverResult();
    assert.ok(discover);
    assert.ok(discover.supportedVersions?.includes("2026-07-28"));
    assert.deepEqual(discover._meta?.["io.modelcontextprotocol/serverInfo"], { name: "wcagc", version: "0.8.0" });

    // 3. tools/list returns complete schemas
    const { tools } = await modernClient.listTools();
    assert.ok(tools.length >= 10);
    const getScan = tools.find((t) => t.name === "get_scan");
    assert.ok(getScan);
    assert.ok(getScan.inputSchema);
    assert.equal(getScan.inputSchema.type, "object");

    // 4. tools/call with response format validation (structuredContent and text)
    const result = await modernClient.callTool({
      name: "get_scan",
      arguments: { scanId: "11111111-1111-4111-8111-111111111111" },
    });
    assert.notEqual(result.isError, true);
    assert.ok(Array.isArray(result.content));
    assert.equal(result.content[0].type, "text");
    assert.ok(typeof result.content[0].text === "string");
    assert.ok(result.structuredContent);

    // 5. Input schema validation failure when passing invalid payload
    const invalidInputResult = await modernClient.callTool({
      name: "get_scan",
      arguments: { scanId: "not-a-uuid" },
    });
    assert.equal(invalidInputResult.isError, true);

    // 6. Plan-based authorization error (FORBIDDEN / FEATURE_NOT_IN_PLAN)
    const freeClient = new Client({ name: "test-free-client", version: "2.0.0" });
    const freeTransport = new StreamableHTTPClientTransport(new URL(harness.mcpUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${TOKENS.FREE_OK}`,
        },
      },
    });
    await freeClient.connect(freeTransport);
    try {
      const planGatedResult = await freeClient.callTool({
        name: "get_root_causes",
        arguments: { runId: "33333333-3333-4333-8333-333333333333" },
      });
      assert.equal(planGatedResult.isError, true);
      const structured = planGatedResult.structuredContent as { code: string; targetPlan: string };
      assert.equal(structured.code, "FEATURE_NOT_IN_PLAN");
      assert.equal(structured.targetPlan, "PRO");
    } finally {
      await freeClient.close();
    }
  } finally {
    await modernClient.close();
  }
});

test("stdio transport — process start, JSON-RPC handshake, tool call, and clean stdout", async () => {
  const stdioScript = path.resolve(import.meta.dirname, "../src/stdio.ts");
  const proc = spawn("node", ["--import", "tsx", stdioScript], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      WCAGC_MCP_KEY: TOKENS.PRO,
      WCAGC_API_BASE_URL: process.env.WCAGC_API_BASE_URL,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const rlOut = readline.createInterface({ input: proc.stdout });
  rlOut.on("line", (line) => {
    stdoutLines.push(line);
  });

  const rlErr = readline.createInterface({ input: proc.stderr });
  rlErr.on("line", (line) => {
    stderrLines.push(line);
  });

  try {
    // 1. Send initialize request over stdin
    const initRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "stdio-test-client", version: "1.0.0" },
      },
    };
    proc.stdin.write(JSON.stringify(initRequest) + "\n");

    // Wait for response
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for stdio initialize")), 5000);
      const check = setInterval(() => {
        if (stdoutLines.length >= 1) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    const initResponse = JSON.parse(stdoutLines[0]);
    assert.equal(initResponse.jsonrpc, "2.0");
    assert.equal(initResponse.id, 1);
    assert.ok(initResponse.result);
    assert.equal(initResponse.result.serverInfo.name, "wcagc");

    // Send initialized notification
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    // 2. Call tool over stdin
    const toolCallRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "list_sites",
        arguments: {},
      },
    };
    proc.stdin.write(JSON.stringify(toolCallRequest) + "\n");

    // Wait for tool response
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout waiting for stdio tool call")), 5000);
      const check = setInterval(() => {
        if (stdoutLines.length >= 2) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    const toolResponse = JSON.parse(stdoutLines[1]);
    assert.equal(toolResponse.jsonrpc, "2.0");
    assert.equal(toolResponse.id, 2);
    assert.ok(toolResponse.result);
    assert.notEqual(toolResponse.result.isError, true);

    // 3. Confirm stdout purity: every single line on stdout must be strictly valid JSON-RPC
    for (const line of stdoutLines) {
      assert.doesNotThrow(() => {
        const parsed = JSON.parse(line);
        assert.equal(parsed.jsonrpc, "2.0");
      }, `stdout contained non-JSON-RPC output: "${line}"`);
    }

    // Diagnostics should have gone to stderr
    assert.ok(stderrLines.some((line) => line.includes("wcagc-mcp running over stdio")));
  } finally {
    proc.stdin.end();
    proc.kill();
  }
});

test("Bearer token forwarding via MCP SDK v2 context — no leakage and no local fallback", async () => {
  const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
  const { resolveBearer } = await import("../src/bearer.js");
  const { config } = await import("../src/config.js");

  // 1. Parallel requests with different tokens to verify no cross-request leakage
  const clientA = new Client({ name: "client-a", version: "1.0.0" });
  const clientB = new Client({ name: "client-b", version: "1.0.0" });

  const transportA = new StreamableHTTPClientTransport(new URL(harness.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${TOKENS.FREE_OK}` } },
  });
  const transportB = new StreamableHTTPClientTransport(new URL(harness.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${TOKENS.PRO}` } },
  });

  await clientA.connect(transportA);
  await clientB.connect(transportB);

  try {
    // Run parallel calls
    const [resA, resB] = await Promise.all([
      clientA.callTool({ name: "get_scan", arguments: { scanId: "11111111-1111-4111-8111-111111111111" } }),
      clientB.callTool({ name: "get_scan", arguments: { scanId: "11111111-1111-4111-8111-111111111111" } }),
    ]);

    assert.notEqual(resA.isError, true);
    assert.notEqual(resB.isError, true);

    // Run parallel call on Pro-gated tool: clientA (FREE) must be denied, clientB (PRO) must succeed
    const [resGateA, resGateB] = await Promise.all([
      clientA.callTool({ name: "get_root_causes", arguments: { runId: "33333333-3333-4333-8333-333333333333" } }),
      clientB.callTool({ name: "get_root_causes", arguments: { runId: "33333333-3333-4333-8333-333333333333" } }),
    ]);

    assert.equal(resGateA.isError, true, "FREE client should be denied Pro tool");
    assert.notEqual(resGateB.isError, true, "PRO client should succeed Pro tool");
  } finally {
    await clientA.close();
    await clientB.close();
  }

  // 2. Direct unit test of resolveBearer:
  // Under HTTP transport (extra.http present), missing token must throw and NEVER fall back to config.mcpKey
  const originalKey = config.mcpKey;
  try {
    (config as any).mcpKey = "local-secret-key-123";

    // When valid http authInfo is provided, it is returned
    const tokenResult = resolveBearer({ http: { authInfo: { token: "user-bearer-token" } as any } });
    assert.equal(tokenResult, "user-bearer-token");

    // When http is present but authInfo has no token, it MUST NOT fall back to local config.mcpKey
    assert.throws(
      () => resolveBearer({ http: {} }),
      /No valid HTTP Bearer token provided in MCP request context/,
    );

    // Without http (stdio mode), it uses config.mcpKey
    const stdioResult = resolveBearer({});
    assert.equal(stdioResult, "local-secret-key-123");
  } finally {
    (config as any).mcpKey = originalKey;
  }
});

test("Host and Origin header protection and Fly health probe exemption", async () => {
  const { resolveAllowedHosts, resolveAllowedOrigins } = await import("../src/config.js");

  // 1. Config helper unit tests
  // In production, derive from URL
  const prodHosts = resolveAllowedHosts("https://mcp.wcagc.com/mcp", "production");
  assert.deepEqual(prodHosts, ["mcp.wcagc.com"]);

  const prodOrigins = resolveAllowedOrigins("https://mcp.wcagc.com/mcp", "production");
  assert.ok(prodOrigins.includes("mcp.wcagc.com"));
  assert.ok(prodOrigins.includes("wcagc.com"));
  assert.ok(prodOrigins.includes("claude.ai"));

  // In production, invalid URL throws fatal error
  assert.throws(
    () => resolveAllowedHosts("not-a-valid-url", "production"),
    /Fatal: In production mode, WCAGC_MCP_ALLOWED_HOSTS must be set or WCAGC_MCP_URL must provide a valid hostname/
  );

  // In non-production, defaults to localhost and 127.0.0.1
  const devHosts = resolveAllowedHosts("https://mcp.wcagc.com/mcp", "development");
  assert.deepEqual(devHosts, ["localhost", "127.0.0.1", "[::1]"]);

  // 2. HTTP Host header validation on /mcp
  // Forbidden Host -> 403
  const badHostRes = await rawHttpRequest(harness.mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Host: "evil-attacker.com",
      Authorization: `Bearer ${TOKENS.FREE_OK}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(badHostRes.status, 403);
  const badHostJson = JSON.parse(badHostRes.body) as any;
  assert.ok(badHostJson?.error?.message?.includes("Invalid Host"));

  // Valid Host -> passes host validation
  const u = new URL(harness.mcpUrl);
  const okHostRes = await rawHttpRequest(harness.mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Host: u.host,
      Authorization: `Bearer ${TOKENS.FREE_OK}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.notEqual(okHostRes.status, 403);

  // 3. HTTP Origin header validation on /mcp
  // Forbidden Origin -> 403
  const badOriginRes = await rawHttpRequest(harness.mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Origin: "https://evil-attacker.com",
      Authorization: `Bearer ${TOKENS.FREE_OK}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(badOriginRes.status, 403);
  const badOriginJson = JSON.parse(badOriginRes.body) as any;
  assert.ok(badOriginJson?.error?.message?.includes("Invalid Origin"));

  // Allowed Origin -> passes origin check
  const okOriginRes = await rawHttpRequest(harness.mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Origin: "http://127.0.0.1",
      Authorization: `Bearer ${TOKENS.FREE_OK}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.notEqual(okOriginRes.status, 403);

  // 4. Fly health probe exemption on /health
  // Probe with internal Fly IP or arbitrary Host header MUST succeed with 200
  const healthUrl = harness.mcpUrl.replace(/\/mcp$/, "/health");
  const flyProbeRes = await rawHttpRequest(healthUrl, {
    headers: {
      Host: "10.0.4.15:8080",
    },
  });
  assert.equal(flyProbeRes.status, 200);
  const healthJson = JSON.parse(flyProbeRes.body) as any;
  assert.equal(healthJson.status, "ok");
  assert.equal(healthJson.version, "0.8.0");
});

test("localhost protection preserves IPv6 loopback clients", async () => {
  const { resolveAllowedHosts, resolveAllowedOrigins } = await import("../src/config.js");
  assert.ok(resolveAllowedHosts(undefined, "development").includes("[::1]"));
  assert.ok(resolveAllowedOrigins(undefined, "development").includes("[::1]"));
  const response = await rawHttpRequest(harness.mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Host: "[::1]:8080",
      Origin: "http://[::1]:3000",
      Authorization: `Bearer ${TOKENS.PRO}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(response.status, 200);
});

// Exercise the old wire protocol directly: a v2 client may negotiate a newer
// version even when its transport is constructed with a legacy version hint.
for (const protocolVersion of ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]) {
  test(`legacy wire ${protocolVersion}: exact negotiation and authenticated tool contracts`, async () => {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${TOKENS.PRO}`,
      "MCP-Protocol-Version": protocolVersion,
    };
    const rpc = async (id: number, method: string, params: Record<string, unknown>) => {
      const response = await rawHttpRequest(harness.mcpUrl, {
        method: "POST", headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      assert.equal(response.status, 200);
      const data = response.headers["content-type"]?.includes("text/event-stream")
        ? response.body.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5)
        : response.body;
      assert.ok(data, `missing JSON-RPC response: ${response.body}`);
      const message = JSON.parse(data);
      assert.equal(message.id, id);
      assert.equal(message.error, undefined);
      return message.result;
    };
    const initialized = await rpc(1, "initialize", {
      protocolVersion, capabilities: {}, clientInfo: { name: "legacy-wire", version: "1" },
    });
    assert.equal(initialized.protocolVersion, protocolVersion);
    const notification = await rawHttpRequest(harness.mcpUrl, {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(notification.status, 202);
    const catalog = await rpc(2, "tools/list", {});
    assert.ok(catalog.tools.some((tool: { name: string }) => tool.name === "get_scan"));
    const result = await rpc(3, "tools/call", {
      name: "get_scan", arguments: { scanId: "11111111-1111-4111-8111-111111111111" },
    });
    assert.notEqual(result.isError, true);
    assert.ok(result.structuredContent.coverageDisclaimer);
    assert.ok(result.structuredContent.standard);
    assert.ok(result.content[0].text.includes(result.structuredContent.coverageDisclaimer));
    assert.ok(result.content[0].text.includes(result.structuredContent.standard));
    const queued = await rpc(4, "tools/call", {
      name: "scan_url", arguments: { url: "https://example.com" },
    });
    assert.notEqual(queued.isError, true);
    assert.ok(queued.structuredContent.scan.id);
  });
}
