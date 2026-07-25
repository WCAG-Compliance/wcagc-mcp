import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { McpApiError, apiJson } from "../api-client.js";
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
  return `${summarizeScanLike(scan, `Scan for ${scan.requestedUrl}`, "Still in progress — call get_run to poll.")}\n` +
    "This URL belongs to a site registered in the account, so the scan is recorded against it — " +
    "its findings feed history and trends. Poll it with get_run.";
}

/**
 * Falling back is not a failure, so say what happened and what it costs. Without this the caller
 * cannot tell a recorded scan from an ad-hoc one, and never learns that registering the site is
 * what unlocks history, trends and full-site scans.
 */
function fallbackNote(reason: "unregistered" | "plan"): string {
  return reason === "unregistered"
    ? "\nThis URL is not a registered site in the account, so it ran as a one-off scan " +
      "(counted against the daily quota). Add the site under Sites to record future scans " +
      "against it and unlock history, trends and full-site scans."
    : "\nRan as a one-off scan (counted against the daily quota). Recording scans against a " +
      "registered site — with history, trends and full-site scans — needs a Pro plan or higher.";
}

/** Codes that mean "this URL cannot use the registered-site path", not "the request was wrong". */
function isNotRegisteredPath(err: unknown): "unregistered" | "plan" | null {
  if (!(err instanceof McpApiError)) return null;
  if (err.code === "SITE_NOT_FOUND") return "unregistered";
  if (err.code === "FEATURE_NOT_IN_PLAN" || err.code === "API_KEY_SCOPE_MISSING") return "plan";
  return null;
}

export function registerScanTools(server: McpServer): void {
  server.registerTool(
    "scan_url",
    {
      title: "Scan a URL",
      description:
        "Scans one http(s) URL for accessibility problems with axe-core — deterministic checks, " +
        "not a language model's opinion. Pass the URL and nothing else. If it belongs to a site " +
        "registered in the caller's account (and their plan allows), the scan is recorded against " +
        "that site so it feeds history and trends; otherwise it runs as a one-off. The result says " +
        "which happened and which tool to poll with. Returns immediately with an id — never a " +
        "compliance score, because automated testing finds only a portion of accessibility " +
        "barriers; see coverageDisclaimer in the result.",
      inputSchema: {
        url: z.string().url().max(2048).describe("The http(s) URL to scan."),
      },
    },
    async ({ url }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        // Try the registered-site path first: it is strictly the better outcome (the scan is kept,
        // and feeds trends). Anything that means "not available for this URL/account" falls back to
        // the one-off scan rather than surfacing as an error the caller has to decode and retry —
        // deciding that is this server's job, not the assistant's.
        try {
          const scan = await apiJson<V1ScanResponse>(bearer, "/api/v1/scans", {
            method: "POST",
            body: JSON.stringify({ url }),
          });
          const response = withDisclaimer({ scan, recordedAgainstSite: true, pollWith: "get_run" });
          return {
            content: [{ type: "text" as const, text: registeredScanText(scan) }],
            structuredContent: response as unknown as Record<string, unknown>,
          };
        } catch (err) {
          const reason = isNotRegisteredPath(err);
          if (reason === null) throw err;
          const free = await apiJson<McpScanResponse>(bearer, "/api/v1/mcp/scan-url", {
            method: "POST",
            body: JSON.stringify({ url }),
          });
          const response = { ...free, recordedAgainstSite: false, pollWith: "get_scan" };
          return {
            content: [{ type: "text" as const, text: freeScanText(free) + fallbackNote(reason) }],
            structuredContent: response as unknown as Record<string, unknown>,
          };
        }
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_scan",
    {
      title: "Get a free-tier scan by id",
      description: "Polls a one-off scan — use it when scan_url's result says pollWith get_scan. Returns severity counts, a " +
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
      description: "The top-5 finding sample for a one-off scan (rule id, severity, help URL, target " +
        "selector). For a scan recorded against a registered site, use get_run_findings instead.",
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
