import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiJson, McpApiError } from "../api-client.js";
import { resolveBearer } from "../bearer.js";
import { COVERAGE_DISCLAIMER } from "../disclaimer.js";
import { toolError } from "../tool-error.js";
import {
  disclaimerShape,
  failureReasonSchema,
  severityCountsSchema,
  summarizeScanLike,
  withDisclaimer,
  type SeverityCounts,
} from "./common.js";

interface V1Site {
  id: string;
  name: string;
  rootUrl: string;
  normalizedHost: string;
  verified: boolean;
}

/** The 202 accept from POST /scan-runs — id and status only, no counts yet. */
interface V1RunAcceptedResponse {
  id: string;
  status: string;
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

const siteSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootUrl: z.string(),
  normalizedHost: z.string(),
  verified: z.boolean(),
});

const runSchema = z.object({
  id: z.string(),
  status: z.string(),
  siteId: z.string().nullish(),
  pagesTotal: z.number().nullish(),
  pagesDone: z.number().nullish(),
  counts: severityCountsSchema.nullish(),
  totalViolations: z.number().nullish(),
  failureReason: failureReasonSchema.nullish(),
});

const runViolationSchema = z.object({
  ruleId: z.string(),
  impact: z.string(),
  wcagSc: z.array(z.string()),
  url: z.string().nullish(),
  helpUrl: z.string(),
  target: z.string(),
  htmlSnippet: z.string(),
  failureSummary: z.string(),
});

const journeyRunSchema = z.object({
  id: z.string(),
  journeyId: z.string(),
  siteId: z.string(),
  status: z.string(),
  failedStepIndex: z.number().nullish(),
  failureReasonCode: z.string().nullish(),
  failureReasonText: z.string().nullish(),
  checkpoints: z.array(z.object({
    scanId: z.string(),
    label: z.string(),
    url: z.string(),
    status: z.string(),
  })),
  startedAt: z.string().nullish(),
  finishedAt: z.string().nullish(),
  createdAt: z.string(),
});

const trendSchema = z.object({
  siteId: z.string(),
  standard: z.string().nullish(),
  points: z.array(z.object({
    scanRunId: z.string(),
    finishedAt: z.string(),
    status: z.string(),
    pagesScanned: z.number(),
    truncated: z.boolean(),
    totalViolations: z.number(),
    bySeverity: severityCountsSchema,
    addedCount: z.number().nullish(),
    resolvedCount: z.number().nullish(),
  })),
});

/** Every Pro+ tool reaches wcagc-api over the network and none of them deletes anything. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const QUEUES_WORK = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

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
      description: "Lists this organization's registered sites — their normalized hosts are what " +
        "every other Pro+ tool takes as siteHost. Pro+ (requires sites:read + API_ACCESS).",
      inputSchema: {},
      outputSchema: { sites: z.array(siteSchema) },
      annotations: { title: "List registered sites", ...READ_ONLY },
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
        "(SCAN_FULL_SITE). Queues the run and returns immediately with a runId — call get_run to poll. " +
        "Call list_sites first if you do not already know the exact registered host.",
      inputSchema: {
        siteHost: z.string().describe(
          "The registered site's normalized host, exactly as list_sites reports it — host only, no scheme and no path.",
        ),
      },
      outputSchema: { run: runSchema, ...disclaimerShape },
      annotations: { title: "Start a full-site scan", ...QUEUES_WORK },
    },
    async ({ siteHost }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const site = await resolveSite(bearer, siteHost);
        const accepted = await apiJson<V1RunAcceptedResponse>(bearer, "/api/v1/scan-runs", {
          method: "POST",
          body: JSON.stringify({ siteId: site.id }),
        });
        const run = { ...accepted, siteId: site.id };
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
      description: "Polls a full-site run started by scan_site — page progress, severity counts " +
        "and, once terminal, a failure reason. Pro+. For a single-page scan from scan_url, use " +
        "get_scan instead.",
      inputSchema: { runId: z.string().uuid().describe("The id returned by scan_site.") },
      outputSchema: { run: runSchema, ...disclaimerShape },
      annotations: { title: "Get a full-site scan run by id", ...READ_ONLY },
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
      description: "Run-level, rule-deduplicated findings for a scan_site run — one entry per " +
        "rule, with the WCAG success criteria it maps to. Pro+. For a single-page scan from " +
        "scan_url, use get_findings instead.",
      inputSchema: { runId: z.string().uuid().describe("The id returned by scan_site.") },
      outputSchema: { violations: z.array(runViolationSchema) },
      annotations: { title: "Get a full-site scan run's findings", ...READ_ONLY },
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
        siteHost: z.string().describe("The registered site's normalized host, as list_sites reports it."),
        journeyName: z.string().describe("The saved journey's name, as configured in the app."),
      },
      outputSchema: { run: journeyRunSchema, ...disclaimerShape },
      annotations: { title: "Run a saved user journey", ...QUEUES_WORK },
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
      inputSchema: { runId: z.string().uuid().describe("The id returned by run_journey.") },
      outputSchema: { run: journeyRunSchema, ...disclaimerShape },
      annotations: { title: "Get a journey run by id", ...READ_ONLY },
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
        siteHost: z.string().describe("The registered site's normalized host, as list_sites reports it."),
        limit: z.number().int().min(1).max(100).optional().describe("Most recent N runs (default 30, max 100)."),
      },
      outputSchema: { trend: trendSchema, ...disclaimerShape },
      annotations: { title: "Get a site's violation-count trend", ...READ_ONLY },
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
