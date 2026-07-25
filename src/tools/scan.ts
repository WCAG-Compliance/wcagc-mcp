import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiJson } from "../api-client.js";
import { resolveBearer } from "../bearer.js";
import { toolError } from "../tool-error.js";
import { summarizeScanLike, withDisclaimer, type SeverityCounts } from "./common.js";

interface PublicViolation {
  ruleId: string;
  impact: string;
  helpUrl: string;
  targetSelector: string;
}

interface McpScanResponse {
  scan: {
    id: string;
    host: string;
    requestedUrl: string;
    status: string;
    counts: SeverityCounts;
    totalViolations: number;
    topViolations: PublicViolation[];
    incompleteCount: number | null;
    passesCount: number | null;
    failureReason: { code: string; reason: string } | null;
  };
  coverageDisclaimer: string;
  standard: string;
}

interface V1ScanResponse {
  id: string;
  siteId: string;
  status: string;
  requestedUrl: string;
  counts: SeverityCounts;
  totalViolations: number;
  failureReason: { code: string; reason: string } | null;
}

function freeScanText(response: McpScanResponse): string {
  return summarizeScanLike(response.scan, `Scan for ${response.scan.host}`, "Still in progress — call get_scan to poll.");
}

function registeredScanText(scan: V1ScanResponse): string {
  return summarizeScanLike(scan, `Scan for ${scan.requestedUrl}`, "Still in progress — call get_run to poll.");
}

export function registerScanTools(server: McpServer): void {
  server.registerTool(
    "scan_url",
    {
      title: "Scan a URL",
      description:
        "Runs a deterministic axe-core accessibility scan of one http(s) URL. The url argument " +
        "is ALWAYS required — siteHost never replaces it, it only changes which pipeline the " +
        "scan runs through. Omit siteHost for a quick ad-hoc scan of any public URL (free tier, " +
        "counted against the daily quota). Add siteHost when that URL belongs to a site " +
        "registered in the account, to record the scan against it (Pro+, requires the " +
        "sites:read and scans:write scopes) — that unlocks get_run/get_run_findings, full-site " +
        "scans, and trends. Either way this queues the scan and returns immediately with an id " +
        "to poll; never returns a compliance score — automated testing finds only a portion of " +
        "accessibility barriers, see coverageDisclaimer in the result.",
      inputSchema: {
        url: z.string().url().max(2048).describe("The http(s) URL to scan."),
        siteHost: z.string().optional().describe(
          "Optional. A registered site's normalized host (Pro+), e.g. \"example.com\" — host only, " +
            "no scheme or path. Supplied ALONGSIDE url, never instead of it. Omit for the free " +
            "anonymous path.",
        ),
      },
    },
    async ({ url, siteHost }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        if (siteHost) {
          const scan = await apiJson<V1ScanResponse>(bearer, "/api/v1/scans", {
            method: "POST",
            body: JSON.stringify({ url }),
          });
          const response = withDisclaimer({ scan });
          return {
            content: [{ type: "text" as const, text: registeredScanText(scan) }],
            structuredContent: response as unknown as Record<string, unknown>,
          };
        }
        const response = await apiJson<McpScanResponse>(bearer, "/api/v1/mcp/scan-url", {
          method: "POST",
          body: JSON.stringify({ url }),
        });
        return {
          content: [{ type: "text" as const, text: freeScanText(response) }],
          structuredContent: response as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_scan",
    {
      title: "Get a free-tier scan by id",
      description: "Polls a scan started by scan_url without siteHost. Returns severity counts, a " +
        "top-5 finding sample, the coverage disclaimer, and (once terminal) a failure reason if the " +
        "scan did not complete.",
      inputSchema: { scanId: z.string().uuid() },
    },
    async ({ scanId }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const response = await apiJson<McpScanResponse>(bearer, `/api/v1/mcp/scans/${scanId}`);
        return {
          content: [{ type: "text" as const, text: freeScanText(response) }],
          structuredContent: response as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_findings",
    {
      title: "Get a free-tier scan's findings",
      description: "The top-5 finding sample for a scan_url (no siteHost) scan (rule id, severity, " +
        "help URL, target selector). Full findings for a registered-site scan need get_run_findings.",
      inputSchema: { scanId: z.string().uuid() },
    },
    async ({ scanId }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const violations = await apiJson<PublicViolation[]>(bearer, `/api/v1/mcp/scans/${scanId}/violations`);
        const text = violations.length === 0
          ? `No findings recorded for scan ${scanId} yet (still running, or none in the top-5 sample).`
          : violations.map((v) => `[${v.impact}] ${v.ruleId} — ${v.targetSelector} (${v.helpUrl})`).join("\n");
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: { violations } as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
