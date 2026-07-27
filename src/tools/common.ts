import { z } from "zod";
import { COVERAGE_DISCLAIMER, NO_SCORE_INSTRUCTION, STANDARD_WCAG21_AA } from "../disclaimer.js";

export interface SeverityCounts {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

/**
 * Output schemas describe what a caller actually receives, so they are deliberately permissive
 * about which fields are present: one tool can be answered by two different wcagc-api endpoints
 * (an accepted-but-queued scan carries only an id and a status; a finished one carries counts),
 * and a schema that demanded the richer shape would make the SDK reject the honest, narrower
 * result. Anything a caller can rely on unconditionally is required; everything else is nullish.
 */
export const severityCountsSchema = z.object({
  critical: z.number(),
  serious: z.number(),
  moderate: z.number(),
  minor: z.number(),
});

export const failureReasonSchema = z.object({
  code: z.string(),
  reason: z.string().nullish(),
});

/** All three are on every scan-shaped result — the honesty contract, never omitted. */
export const disclaimerShape = {
  coverageDisclaimer: z.string().describe(
    "Why this result is not a compliance verdict. Always relay it; never present a scan as proof of conformance.",
  ),
  scoringGuidance: z.string().describe(
    "Binding instruction for the assistant reading this result. Follow it literally.",
  ),
  standard: z.string().describe("The standard the checks were run against, e.g. \"WCAG 2.1 AA\"."),
};

/**
 * Minimal shape shared by PublicScanResponse (free tier) and V1ScanResponse/V1ScanRunResponse
 * (Pro+). Counts are optional because the accept responses (`202` from POST /scans, /scan-runs)
 * carry an id and a status and nothing else — reading them off a just-queued scan is what used
 * to print "undefined" into the summary.
 */
export interface ScanLike {
  id: string;
  status: string;
  counts?: SeverityCounts | null;
  totalViolations?: number | null;
  failureReason?: { code: string; reason?: string | null } | null;
}

/**
 * Every Pro+ tool wrapping a bare v1 REST response (which carries no disclaimer of its own —
 * that's a wcagc-mcp-only honesty requirement, ROADMAP 2.6.3) must inject one client-side before
 * it reaches the assistant. Free-tier `/api/v1/mcp/**` responses already carry it from the API;
 * this wrapper keeps both paths structurally identical for the calling tool.
 */
export function withDisclaimer<T>(payload: T, standard: string = STANDARD_WCAG21_AA) {
  return {
    ...payload,
    coverageDisclaimer: COVERAGE_DISCLAIMER,
    scoringGuidance: NO_SCORE_INSTRUCTION,
    standard,
  } as T & { coverageDisclaimer: string; scoringGuidance: string; standard: string };
}

const TERMINAL_OK = new Set(["DONE", "COMPLETED", "PARTIAL"]);

export function summarizeScanLike(scan: ScanLike, label: string, pollHint: string): string {
  const parts = [`${label} ${scan.id} — status ${scan.status}.`];
  const c = scan.counts;
  if (TERMINAL_OK.has(scan.status) && c) {
    parts.push(
      `${scan.totalViolations ?? 0} issue(s) found (critical ${c.critical}, serious ${c.serious}, ` +
        `moderate ${c.moderate}, minor ${c.minor}).`,
    );
    // Only once there are numbers on the table — that is the moment a reader starts dividing them.
    parts.push(NO_SCORE_INSTRUCTION);
  } else if (scan.failureReason) {
    parts.push(`Did not complete: ${scan.failureReason.code}.`);
  } else {
    parts.push(pollHint);
  }
  parts.push(COVERAGE_DISCLAIMER);
  return parts.join(" ");
}
