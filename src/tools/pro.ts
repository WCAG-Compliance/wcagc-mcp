import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiJson, McpApiError } from "../api-client.js";
import { resolveBearer } from "../bearer.js";
import { COVERAGE_DISCLAIMER } from "../disclaimer.js";
import { OAUTH_TOOL_META } from "../tool-metadata.js";
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

interface V1RootCauseResponse {
  scope: string;
  status: string;
  signatureVersion: string;
  summary: {
    findingsTotal: number;
    analyzedFindings: number;
    clustersTotal: number;
    clusteredFindings: number;
    pagesTotal: number | null;
  };
  truncated: boolean;
  clusters: Array<{
    key: string;
    ruleId: string;
    impact: string;
    wcagSc: string[];
    pattern: string;
    selectorSignature: string;
    component: { label: string; source: string; platform: string | null } | null;
    nodesCount: number;
    pagesCount: number | null;
    samplePages: string[];
    sampleSelectors: string[];
    guidance: string | null;
    exampleFix: string | null;
    helpUrl: string;
  }>;
  coverageDisclaimer: string;
}

interface V1Fix {
  id: string;
  siteId: string;
  ruleId: string;
  impact: string;
  rootCauseKey: string | null;
  componentLabel: string | null;
  status: string;
  verifiedScope: string | null;
  verifiedAt: string | null;
  verifiedPagesCount: number | null;
  nodesCountAtTracking: number | null;
  pagesCountAtTracking: number | null;
  verifiable: boolean;
}

interface V1FixVerification {
  id: string;
  remediationItemId: string;
  siteId: string;
  status: string;
  outcome: string | null;
  source: string;
  scopeGranularity: string;
  rootCauseKey: string | null;
  pagesRequested: number;
  pagesScanned: number;
  pagesFailed: number;
  nodesFound: number | null;
  ruleNodesFound: number | null;
  pages: Array<{ url: string; status: string; nodesFound: number | null }>;
  failureReasonCode: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface V1FixVerificationAccepted {
  id: string;
  status: string;
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

const rootCausesSchema = z.object({
  scope: z.string(),
  status: z.string(),
  signatureVersion: z.string(),
  summary: z.object({
    findingsTotal: z.number(),
    analyzedFindings: z.number(),
    clustersTotal: z.number(),
    clusteredFindings: z.number(),
    pagesTotal: z.number().nullish(),
  }),
  truncated: z.boolean(),
  clusters: z.array(z.object({
    key: z.string(),
    ruleId: z.string(),
    impact: z.string(),
    wcagSc: z.array(z.string()),
    pattern: z.string(),
    selectorSignature: z.string(),
    component: z.object({
      label: z.string(),
      source: z.string(),
      platform: z.string().nullish(),
    }).nullish(),
    nodesCount: z.number(),
    pagesCount: z.number().nullish(),
    samplePages: z.array(z.string()),
    sampleSelectors: z.array(z.string()),
    guidance: z.string().nullish(),
    exampleFix: z.string().nullish(),
    helpUrl: z.string(),
  })),
  coverageDisclaimer: z.string(),
});

const fixSchema = z.object({
  id: z.string().uuid(),
  siteId: z.string().uuid(),
  ruleId: z.string(),
  impact: z.string(),
  rootCauseKey: z.string().nullish(),
  componentLabel: z.string().nullish(),
  status: z.string(),
  verifiedScope: z.string().nullish(),
  verifiedAt: z.string().nullish(),
  verifiedPagesCount: z.number().nullish(),
  nodesCountAtTracking: z.number().nullish(),
  pagesCountAtTracking: z.number().nullish(),
  verifiable: z.boolean(),
});

const fixVerificationSchema = z.object({
  id: z.string().uuid(),
  remediationItemId: z.string().uuid(),
  siteId: z.string().uuid(),
  status: z.string(),
  outcome: z.string().nullish(),
  source: z.string(),
  scopeGranularity: z.string(),
  rootCauseKey: z.string().nullish(),
  pagesRequested: z.number(),
  pagesScanned: z.number(),
  pagesFailed: z.number(),
  nodesFound: z.number().nullish(),
  ruleNodesFound: z.number().nullish(),
  pages: z.array(z.object({ url: z.string(), status: z.string(), nodesFound: z.number().nullish() })),
  failureReasonCode: z.string().nullish(),
  startedAt: z.string(),
  finishedAt: z.string().nullish(),
});

const fixVerificationAcceptedSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
});

/**
 * Reading back a record the account already owns. The domain is closed and enumerable — one id,
 * one answer, no part of the open web is touched — so openWorldHint is false here even though
 * the call still crosses the network to wcagc-api.
 */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * Queues private WCAGC work and spends quota. Nothing is deleted or overwritten and the tools do
 * not publish or mutate public internet state, so both destructive and open-world stay false.
 */
const QUEUES_PRIVATE_WORK = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/**
 * A saved journey can contain clicks or fills that submit a form or trigger another external,
 * irreversible action. It therefore needs both warnings even though the steps are configured in
 * WCAGC rather than accepted as raw arguments to this tool.
 */
const RUNS_EXTERNAL_JOURNEY = {
  readOnlyHint: false,
  destructiveHint: true,
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
      _meta: OAUTH_TOOL_META,
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
      _meta: OAUTH_TOOL_META,
      annotations: { title: "Start a full-site scan", ...QUEUES_PRIVATE_WORK },
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
      _meta: OAUTH_TOOL_META,
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
      _meta: OAUTH_TOOL_META,
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
    "get_root_causes",
    {
      title: "Get a scan run's root causes",
      description: "Returns deterministic repeated DOM patterns and factual blast-radius counts " +
        "for a full-site run. Grouping does not expand automated-test coverage and may not match " +
        "the site's real component boundaries. Pro+.",
      inputSchema: { runId: z.string().uuid().describe("The id returned by scan_site.") },
      outputSchema: { rootCauses: rootCausesSchema },
      _meta: OAUTH_TOOL_META,
      annotations: { title: "Get a scan run's root causes", ...READ_ONLY },
    },
    async ({ runId }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const rootCauses = await apiJson<V1RootCauseResponse>(
          bearer,
          `/api/v1/scan-runs/${runId}/root-causes`,
        );
        const facts = rootCauses.clusters.length === 0
          ? `No root-cause clusters recorded for run ${runId} yet.`
          : rootCauses.clusters.map((cluster) =>
              `[${cluster.impact}] ${cluster.ruleId}: ${cluster.nodesCount} finding(s)` +
              `${cluster.pagesCount === null ? "" : ` across ${cluster.pagesCount} page(s)`}` +
              " share this pattern.",
            ).join("\n");
        return {
          content: [{ type: "text" as const, text: `${facts}\n\n${rootCauses.coverageDisclaimer}` }],
          structuredContent: { rootCauses } as unknown as Record<string, unknown>,
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
        "from the journey's own saved configuration — never accepted here. Saved click or fill " +
        "steps can submit forms or trigger external actions, so run only a journey the user has " +
        "reviewed. Queues the run and returns immediately with a runId — call get_journey_run to poll.",
      inputSchema: {
        siteHost: z.string().describe("The registered site's normalized host, as list_sites reports it."),
        journeyName: z.string().describe("The saved journey's name, as configured in the app."),
      },
      outputSchema: { run: journeyRunSchema, ...disclaimerShape },
      _meta: OAUTH_TOOL_META,
      annotations: { title: "Run a saved user journey", ...RUNS_EXTERNAL_JOURNEY },
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
      _meta: OAUTH_TOOL_META,
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
      _meta: OAUTH_TOOL_META,
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

  server.registerTool(
    "get_fixes",
    {
      title: "List tracked fixes",
      description: "Lists tracked remediation items for a registered site, including status and " +
        "the scope of any automated verification proof. Pro+ (REMEDIATION_TRACKING).",
      inputSchema: { siteHost: z.string().describe("The registered site's normalized host, as list_sites reports it.") },
      outputSchema: { fixes: z.array(fixSchema), ...disclaimerShape },
      _meta: OAUTH_TOOL_META,
      annotations: { title: "List tracked fixes", ...READ_ONLY },
    },
    async ({ siteHost }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const site = await resolveSite(bearer, siteHost);
        const fixes = await apiJson<V1Fix[]>(bearer, `/api/v1/sites/${site.id}/fixes`);
        const text = fixes.length === 0 ? `No tracked fixes for ${siteHost}.` : fixes.map((fix) =>
          `[${fix.status}] ${fix.ruleId} — ${fix.componentLabel ?? fix.rootCauseKey ?? fix.id}` +
          (fix.verifiedScope ? `; automated proof scope: ${fix.verifiedScope}` : ""),
        ).join("\n");
        return {
          content: [{ type: "text" as const, text: `${text}\n\n${COVERAGE_DISCLAIMER}` }],
          structuredContent: withDisclaimer({ fixes }) as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "verify_fix",
    {
      title: "Verify a tracked fix",
      description: "Queues a targeted automated re-check of representative pages for one tracked " +
        "fix. This is not a full-site re-scan or a compliance guarantee. Pro+.",
      inputSchema: { remediationItemId: z.string().uuid().describe("A fix id returned by get_fixes.") },
      outputSchema: { verification: fixVerificationAcceptedSchema, pollWith: z.literal("get_fix_verification"), ...disclaimerShape },
      _meta: OAUTH_TOOL_META,
      annotations: { title: "Verify a tracked fix", ...QUEUES_PRIVATE_WORK },
    },
    async ({ remediationItemId }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const verification = await apiJson<V1FixVerificationAccepted>(
          bearer,
          `/api/v1/remediation-items/${remediationItemId}/verifications`,
          { method: "POST" },
        );
        const response = withDisclaimer({ verification, pollWith: "get_fix_verification" as const });
        return {
          content: [{ type: "text" as const, text:
            `Targeted verification ${verification.id} queued. Call get_fix_verification to poll. ` +
            `This is not a whole-site result.\n\n${COVERAGE_DISCLAIMER}` }],
          structuredContent: response as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_fix_verification",
    {
      title: "Get fix verification",
      description: "Polls a targeted fix verification and reports only what was detected on the " +
        "selected pages checked. Pro+.",
      inputSchema: { fixVerificationId: z.string().uuid().describe("The id returned by verify_fix.") },
      outputSchema: { verification: fixVerificationSchema, ...disclaimerShape },
      _meta: OAUTH_TOOL_META,
      annotations: { title: "Get fix verification", ...READ_ONLY },
    },
    async ({ fixVerificationId }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const verification = await apiJson<V1FixVerification>(
          bearer,
          `/api/v1/fix-verifications/${fixVerificationId}`,
        );
        const summary = summarizeFixVerification(verification);
        return {
          content: [{ type: "text" as const, text: `${summary}\n\n${COVERAGE_DISCLAIMER}` }],
          structuredContent: withDisclaimer({ verification }) as unknown as Record<string, unknown>,
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

function summarizeFixVerification(verification: V1FixVerification): string {
  if (verification.status === "QUEUED" || verification.status === "RUNNING") {
    return `Targeted verification ${verification.id} is ${verification.status.toLowerCase()}: ` +
      `${verification.pagesScanned} of ${verification.pagesRequested} selected page(s) checked.`;
  }
  if (verification.outcome === "NOT_DETECTED") {
    return `The tracked pattern was not detected on ${verification.pagesScanned} selected page(s). ` +
      "This does not establish a whole-site result.";
  }
  if (verification.outcome === "STILL_PRESENT") {
    return `The tracked pattern is still detected: ${verification.nodesFound ?? 0} matching node(s) ` +
      `on ${verification.pagesScanned} checked page(s).`;
  }
  if (verification.outcome === "INCONCLUSIVE") {
    return `Verification was inconclusive: ${verification.pagesScanned} page(s) checked and ` +
      `${verification.pagesFailed} page(s) failed.`;
  }
  return `Verification ended with status ${verification.status}` +
    (verification.failureReasonCode ? ` (${verification.failureReasonCode}).` : ".");
}
