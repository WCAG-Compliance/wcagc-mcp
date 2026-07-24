import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiJson, McpApiError } from "../api-client.js";
import { resolveBearer } from "../bearer.js";
import { COVERAGE_DISCLAIMER } from "../disclaimer.js";
import { toolError } from "../tool-error.js";
import { summarizeScanLike, withDisclaimer, type SeverityCounts } from "./common.js";

interface V1Site {
  id: string;
  name: string;
  rootUrl: string;
  normalizedHost: string;
  verified: boolean;
}

interface V1ScanRunResponse {
  id: string;
  siteId: string;
  status: string;
  pagesTotal: number | null;
  pagesDone: number;
  counts: SeverityCounts;
  totalViolations: number;
  failureReason: { code: string; reason: string } | null;
}

interface V1ViolationResponse {
  ruleId: string;
  impact: string;
  wcagSc: string[];
  url: string | null;
  helpUrl: string;
  target: string;
  htmlSnippet: string;
  failureSummary: string;
}

interface V1Journey {
  id: string;
  siteId: string;
  name: string;
  usesAuth: boolean;
  createdAt: string;
}

interface V1JourneyRunResponse {
  id: string;
  journeyId: string;
  siteId: string;
  status: string;
  failedStepIndex: number | null;
  failureReasonCode: string | null;
  failureReasonText: string | null;
  checkpoints: Array<{ scanId: string; label: string; url: string; status: string }>;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface V1SiteTrendResponse {
  siteId: string;
  standard: string | null;
  points: Array<{
    scanRunId: string;
    finishedAt: string;
    status: string;
    pagesScanned: number;
    truncated: boolean;
    totalViolations: number;
    bySeverity: SeverityCounts;
    addedCount: number | null;
    resolvedCount: number | null;
  }>;
}

/** Resolves a human-given host to the registered Site the Pro+ tools operate on. */
async function resolveSite(bearer: string, siteHost: string): Promise<V1Site> {
  const sites = await apiJson<V1Site[]>(bearer, "/api/v1/sites");
  const match = sites.find((s) => s.normalizedHost === siteHost);
  if (!match) {
    throw new McpApiError(404, "SITE_NOT_FOUND", `No registered site matches host "${siteHost}".`);
  }
  return match;
}

export function registerProTools(server: McpServer): void {
  server.registerTool(
    "list_sites",
    {
      title: "List registered sites",
      description: "Lists this organization's registered sites. Pro+ (requires sites:read + API_ACCESS).",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const sites = await apiJson<V1Site[]>(bearer, "/api/v1/sites");
        const text = sites.length === 0
          ? "No registered sites."
          : sites.map((s) => `${s.normalizedHost}${s.verified ? "" : " (unverified)"} — id ${s.id}`).join("\n");
        return { content: [{ type: "text" as const, text }], structuredContent: { sites } };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "scan_site",
    {
      title: "Start a full-site scan",
      description: "Crawls and scans every reachable page of a registered site. Pro+ " +
        "(SCAN_FULL_SITE). Queues the run and returns immediately with a runId — call get_run to poll.",
      inputSchema: { siteHost: z.string().describe("The registered site's normalized host.") },
    },
    async ({ siteHost }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const site = await resolveSite(bearer, siteHost);
        const run = await apiJson<V1ScanRunResponse>(bearer, "/api/v1/scan-runs", {
          method: "POST",
          body: JSON.stringify({ siteId: site.id }),
        });
        const response = withDisclaimer({ run });
        return {
          content: [{ type: "text" as const, text: summarizeScanLike(run, `Full-site run for ${siteHost}`, "Still in progress — call get_run to poll.") }],
          structuredContent: response as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_run",
    {
      title: "Get a full-site scan run by id",
      description: "Polls a run started by scan_site (or a registered-site scan_url). Pro+.",
      inputSchema: { runId: z.string().uuid() },
    },
    async ({ runId }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const run = await apiJson<V1ScanRunResponse>(bearer, `/api/v1/scan-runs/${runId}`);
        const response = withDisclaimer({ run });
        return {
          content: [{ type: "text" as const, text: summarizeScanLike(run, "Full-site run", "Still in progress — call get_run to poll.") }],
          structuredContent: response as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_run_findings",
    {
      title: "Get a full-site scan run's findings",
      description: "Run-level, rule-deduplicated findings for a scan_site run. Pro+.",
      inputSchema: { runId: z.string().uuid() },
    },
    async ({ runId }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const violations = await apiJson<V1ViolationResponse[]>(bearer, `/api/v1/scan-runs/${runId}/violations`);
        const text = violations.length === 0
          ? `No findings recorded for run ${runId} yet.`
          : violations.map((v) => `[${v.impact}] ${v.ruleId}${v.url ? ` — ${v.url}` : ""} (${v.helpUrl})`).join("\n");
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: { violations } as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "run_journey",
    {
      title: "Run a saved user journey",
      description: "Replays a saved multi-step journey (e.g. \"add to cart -> checkout\") against " +
        "its registered site and checkpoints accessibility at each step. Pro+ (JOURNEYS; also " +
        "AUTHENTICATED_SCANS when the journey logs in). Steps and any login credential always come " +
        "from the journey's own saved configuration — never accepted here. Queues the run and " +
        "returns immediately with a runId — call get_journey_run to poll.",
      inputSchema: {
        siteHost: z.string().describe("The registered site's normalized host."),
        journeyName: z.string().describe("The saved journey's name, as configured in the app."),
      },
    },
    async ({ siteHost, journeyName }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const site = await resolveSite(bearer, siteHost);
        const journeys = await apiJson<V1Journey[]>(bearer, `/api/v1/sites/${site.id}/journeys`);
        const journey = journeys.find((j) => j.name === journeyName);
        if (!journey) {
          throw new McpApiError(404, "JOURNEY_NOT_FOUND", `No journey named "${journeyName}" on ${siteHost}.`);
        }
        const run = await apiJson<V1JourneyRunResponse>(bearer, `/api/v1/journeys/${journey.id}/runs`, { method: "POST" });
        return {
          content: [{ type: "text" as const, text: summarizeJourneyRun(run) }],
          structuredContent: withDisclaimer({ run }) as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_journey_run",
    {
      title: "Get a journey run by id",
      description: "Polls a run started by run_journey — per-step checkpoints and, once terminal, " +
        "a failure reason if a step failed. Pro+.",
      inputSchema: { runId: z.string().uuid() },
    },
    async ({ runId }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const run = await apiJson<V1JourneyRunResponse>(bearer, `/api/v1/journey-runs/${runId}`);
        return {
          content: [{ type: "text" as const, text: summarizeJourneyRun(run) }],
          structuredContent: withDisclaimer({ run }) as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_trends",
    {
      title: "Get a site's violation-count trend",
      description: "Chronological (oldest->newest) per-run point history for a registered site's " +
        "completed full-site runs — counts by severity and, where a comparison exists, " +
        "added/resolved markers. No score. Pro+ (TREND_HISTORY).",
      inputSchema: {
        siteHost: z.string().describe("The registered site's normalized host."),
        limit: z.number().int().min(1).max(100).optional().describe("Most recent N runs (default 30, max 100)."),
      },
    },
    async ({ siteHost, limit }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const site = await resolveSite(bearer, siteHost);
        const path = `/api/v1/sites/${site.id}/trend${limit ? `?limit=${limit}` : ""}`;
        const trend = await apiJson<V1SiteTrendResponse>(bearer, path);
        const text = trend.points.length === 0
          ? `No completed full-site runs yet for ${siteHost}.`
          : trend.points.map((p) => `${p.finishedAt}: ${p.totalViolations} issue(s)` +
              (p.addedCount !== null ? ` (+${p.addedCount}/-${p.resolvedCount})` : "")).join("\n");
        return {
          content: [{ type: "text" as const, text: `${text}\n\n${COVERAGE_DISCLAIMER}` }],
          structuredContent: withDisclaimer({ trend }) as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );
}

function summarizeJourneyRun(run: V1JourneyRunResponse): string {
  const parts = [`Journey run ${run.id} — status ${run.status}.`];
  if (run.checkpoints.length > 0) {
    parts.push(`${run.checkpoints.length} checkpoint(s): ` +
      run.checkpoints.map((c) => `${c.label} (${c.status})`).join(", ") + ".");
  }
  if (run.failureReasonCode) {
    parts.push(`Did not complete: ${run.failureReasonCode}.`);
  } else if (run.status !== "COMPLETED" && run.status !== "DONE" && run.status !== "FAILED") {
    parts.push("Still in progress — call get_journey_run to poll.");
  }
  parts.push(COVERAGE_DISCLAIMER);
  return parts.join(" ");
}
