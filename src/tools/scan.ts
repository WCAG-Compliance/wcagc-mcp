import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { McpApiError, apiJson } from "../api-client.js";
import { resolveBearer } from "../bearer.js";
import { toolError } from "../tool-error.js";
import {
  disclaimerShape,
  failureReasonSchema,
  severityCountsSchema,
  summarizeScanLike,
  withDisclaimer,
  type SeverityCounts,
} from "./common.js";

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

/**
 * What `POST /api/v1/scans` actually returns — a 202 accept, id and status and nothing more
 * (V1ScanAcceptedResponse). It is NOT the `GET /api/v1/scans/{id}` shape; reading counts or
 * requestedUrl off it yields undefined.
 */
interface V1ScanAcceptedResponse {
  id: string;
  status: string;
}

/** What `GET /api/v1/scans/{id}` returns once the scan exists. */
interface V1ScanResponse {
  id: string;
  siteId: string;
  status: string;
  requestedUrl: string;
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

const violationSchema = z.object({
  ruleId: z.string(),
  impact: z.string(),
  helpUrl: z.string(),
  targetSelector: z.string(),
  wcagSc: z.array(z.string()).nullish(),
  url: z.string().nullish(),
  htmlSnippet: z.string().nullish(),
  failureSummary: z.string().nullish(),
});

/** One schema for both paths a scan can come back through — see common.ts on why it is loose. */
const scanSchema = z.object({
  id: z.string(),
  status: z.string().describe("QUEUED, RUNNING, DONE, PARTIAL or FAILED."),
  requestedUrl: z.string().nullish(),
  host: z.string().nullish(),
  siteId: z.string().nullish(),
  counts: severityCountsSchema.nullish(),
  totalViolations: z.number().nullish(),
  topViolations: z.array(violationSchema).nullish(),
  incompleteCount: z.number().nullish(),
  passesCount: z.number().nullish(),
  failureReason: failureReasonSchema.nullish(),
});

const scanOutputShape = {
  scan: scanSchema,
  recordedAgainstSite: z.boolean().describe(
    "True when the URL belongs to a registered site and the scan was kept against it (so it feeds history and trends); false for a one-off scan.",
  ),
  pollWith: z.literal("get_scan").describe("The tool that reads this scan's progress and result."),
  ...disclaimerShape,
};

const findingsOutputShape = {
  violations: z.array(violationSchema),
  recordedAgainstSite: z.boolean(),
};

/** Codes that mean "this URL/id is not on the registered-site path", not "the request was wrong". */
function isNotRegisteredPath(err: unknown): "unregistered" | "plan" | null {
  if (!(err instanceof McpApiError)) return null;
  if (err.code === "SITE_NOT_FOUND") return "unregistered";
  if (err.code === "FEATURE_NOT_IN_PLAN" || err.code === "API_KEY_SCOPE_MISSING") return "plan";
  return null;
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

export function registerScanTools(server: McpServer): void {
  server.registerTool(
    "scan_url",
    {
      title: "Scan a URL",
      description:
        "Scans one http(s) URL for accessibility problems with axe-core — deterministic checks, " +
        "not a language model's opinion. Pass the URL and nothing else. If it belongs to a site " +
        "registered in the caller's account (and their plan allows), the scan is recorded against " +
        "that site so it feeds history and trends; otherwise it runs as a one-off. Either way, " +
        "poll it with get_scan. Returns immediately with an id — never a compliance score, " +
        "because automated testing finds only a portion of accessibility barriers; see " +
        "coverageDisclaimer in the result.",
      inputSchema: {
        url: z.string().url().max(2048).describe("The http(s) URL to scan."),
      },
      outputSchema: scanOutputShape,
      annotations: {
        title: "Scan a URL",
        // Queues real work and spends the account's daily scan quota, so not read-only — but it
        // only ever adds a scan record, and re-running one is always safe.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
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
          const accepted = await apiJson<V1ScanAcceptedResponse>(bearer, "/api/v1/scans", {
            method: "POST",
            body: JSON.stringify({ url }),
          });
          const scan = { ...accepted, requestedUrl: url };
          const response = withDisclaimer({
            scan,
            recordedAgainstSite: true,
            pollWith: "get_scan" as const,
          });
          return {
            content: [{
              type: "text" as const,
              text: `${summarizeScanLike(scan, `Scan for ${url}`, "Still in progress — call get_scan to poll.")}\n` +
                "This URL belongs to a site registered in the account, so the scan is recorded " +
                "against it — its findings feed history and trends.",
            }],
            structuredContent: response as unknown as Record<string, unknown>,
          };
        } catch (err) {
          const reason = isNotRegisteredPath(err);
          if (reason === null) throw err;
          const free = await apiJson<McpScanResponse>(bearer, "/api/v1/mcp/scan-url", {
            method: "POST",
            body: JSON.stringify({ url }),
          });
          const response = { ...free, recordedAgainstSite: false, pollWith: "get_scan" as const };
          return {
            content: [{
              type: "text" as const,
              text: summarizeScanLike(free.scan, `Scan for ${free.scan.host}`,
                "Still in progress — call get_scan to poll.") + fallbackNote(reason),
            }],
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
      title: "Get a scan by id",
      description:
        "Polls a scan started by scan_url — either kind, recorded against a registered site or " +
        "one-off; this tool finds it either way. Returns severity counts, a finding sample, the " +
        "coverage disclaimer, and (once terminal) a failure reason if the scan did not complete. " +
        "For a full-site run from scan_site, use get_run instead.",
      inputSchema: { scanId: z.string().uuid().describe("The id returned by scan_url.") },
      outputSchema: scanOutputShape,
      annotations: {
        title: "Get a scan by id",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ scanId }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const { scan, recordedAgainstSite } = await readScan(bearer, scanId);
        const target = scan.requestedUrl ?? scan.host;
        const response = withDisclaimer({
          scan,
          recordedAgainstSite,
          pollWith: "get_scan" as const,
        });
        return {
          content: [{
            type: "text" as const,
            text: summarizeScanLike(scan, target ? `Scan for ${target}` : "Scan",
              "Still in progress — call get_scan again to poll."),
          }],
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
      title: "Get a scan's findings",
      description:
        "The findings for a scan started by scan_url — rule id, severity, help URL and the " +
        "element selector. Works for both kinds of scan_url scan. A one-off scan returns the " +
        "top-5 sample; a scan recorded against a registered site returns its full findings. " +
        "For a full-site run from scan_site, use get_run_findings instead.",
      inputSchema: { scanId: z.string().uuid().describe("The id returned by scan_url.") },
      outputSchema: findingsOutputShape,
      annotations: {
        title: "Get a scan's findings",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ scanId }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const { violations, recordedAgainstSite } = await readFindings(bearer, scanId);
        const text = violations.length === 0
          ? `No findings recorded for scan ${scanId} yet (still running, or none found).`
          : violations.map((v) => `[${v.impact}] ${v.ruleId} — ${v.targetSelector} (${v.helpUrl})`).join("\n");
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: { violations, recordedAgainstSite } as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );
}

type ReadScan = { scan: z.infer<typeof scanSchema>; recordedAgainstSite: boolean };

/**
 * scan_url routes a URL to whichever path the account can use, so polling has to route the id
 * back the same way — otherwise every scan recorded against a registered site is a dead end
 * (the id is real, but the free-tier endpoint has never heard of it and answers SCAN_NOT_FOUND).
 * The two id spaces do not overlap: one-off scans live in their own non-tenant table. The free
 * path is tried first because it is the common case and reads cost no quota either way.
 */
async function readScan(bearer: string, scanId: string): Promise<ReadScan> {
  try {
    const free = await apiJson<McpScanResponse>(bearer, `/api/v1/mcp/scans/${scanId}`);
    return { scan: free.scan, recordedAgainstSite: false };
  } catch (err) {
    if (!(err instanceof McpApiError) || err.code !== "SCAN_NOT_FOUND") throw err;
    const scan = await apiJson<V1ScanResponse>(bearer, `/api/v1/scans/${scanId}`);
    return { scan, recordedAgainstSite: true };
  }
}

async function readFindings(bearer: string, scanId: string) {
  try {
    const violations = await apiJson<PublicViolation[]>(bearer, `/api/v1/mcp/scans/${scanId}/violations`);
    return { violations, recordedAgainstSite: false };
  } catch (err) {
    if (!(err instanceof McpApiError) || err.code !== "SCAN_NOT_FOUND") throw err;
    const rich = await apiJson<V1ViolationResponse[]>(bearer, `/api/v1/scans/${scanId}/violations`);
    // The registered-site endpoint names the element `target`; keep the one field name the
    // free-tier path already publishes so a caller never has to branch on which scan it polled.
    const violations = rich.map((v) => ({ ...v, targetSelector: v.target }));
    return { violations, recordedAgainstSite: true };
  }
}
