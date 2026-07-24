import { COVERAGE_DISCLAIMER, STANDARD_WCAG21_AA } from "../disclaimer.js";

export interface SeverityCounts {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

/** Minimal shape shared by PublicScanResponse (free tier) and V1ScanResponse/V1ScanRunResponse (Pro+). */
export interface ScanLike {
  id: string;
  status: string;
  counts: SeverityCounts;
  totalViolations: number;
  failureReason: { code: string; reason?: string } | null;
}

/**
 * Every Pro+ tool wrapping a bare v1 REST response (which carries no disclaimer of its own —
 * that's a wcagc-mcp-only honesty requirement, ROADMAP 2.6.3) must inject one client-side before
 * it reaches the assistant. Free-tier `/api/v1/mcp/**` responses already carry it from the API;
 * this wrapper keeps both paths structurally identical for the calling tool.
 */
export function withDisclaimer<T>(payload: T, standard: string = STANDARD_WCAG21_AA) {
  return { ...payload, coverageDisclaimer: COVERAGE_DISCLAIMER, standard } as T & {
    coverageDisclaimer: string;
    standard: string;
  };
}

export function summarizeScanLike(scan: ScanLike, label: string, pollHint: string): string {
  const parts = [`${label} ${scan.id} — status ${scan.status}.`];
  if (scan.status === "DONE" || scan.status === "COMPLETED" || scan.status === "PARTIAL") {
    const c = scan.counts;
    parts.push(
      `${scan.totalViolations} issue(s) found (critical ${c.critical}, serious ${c.serious}, ` +
        `moderate ${c.moderate}, minor ${c.minor}).`,
    );
  } else if (scan.failureReason) {
    parts.push(`Did not complete: ${scan.failureReason.code}.`);
  } else {
    parts.push(pollHint);
  }
  parts.push(COVERAGE_DISCLAIMER);
  return parts.join(" ");
}
