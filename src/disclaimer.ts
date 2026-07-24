/**
 * Honest-output constants every scan-producing tool result carries (ROADMAP iron rule 2.6.3).
 * Verbatim copy of the EN report string
 * (wcagc-api/compliance/.../i18n/report_en.properties, key report.coverageDisclaimer) — not
 * reworded, and not localized: an MCP agent reads this in content[].text regardless of the
 * caller's own locale, so it must always be present in one language the calling assistant is
 * guaranteed to render faithfully. Never paired with a score/grade/"compliant" claim.
 */
export const COVERAGE_DISCLAIMER =
  "Automated testing finds only a portion of accessibility barriers (commonly 30–57%). " +
  "Many requirements need manual review.";

export const STANDARD_WCAG21_AA = "WCAG 2.1 AA";
export const STANDARD_PDF_UA1 = "PDF/UA-1";
