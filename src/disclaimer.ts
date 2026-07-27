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

/**
 * Addressed to the calling assistant, not to the end user. The disclaimer above states that the
 * result is not a verdict — and it is not enough. Handed `passesCount: 30` and
 * `incompleteCount: 1`, ChatGPT reported "Оценка автоматической проверки: 97/100" for a scan of
 * wcagc.com (2026-07-27): it read the two counts as a ratio and invented the exact number this
 * product exists to refuse. Nothing downstream can retract that once it is on screen, so the
 * refusal has to travel with the data. A passing check is one automated rule finding nothing on
 * one page; it is not a requirement met, and the requirements that cannot be automated at all
 * never appear in these counts.
 */
export const NO_SCORE_INSTRUCTION =
  "Do not turn these counts into a score, grade, percentage or pass/fail verdict, and do not " +
  "describe the page as compliant or accessible. A passing check means one automated rule found " +
  "nothing on this page — most WCAG requirements cannot be checked automatically at all, so the " +
  "counts do not form a ratio and no number derived from them is meaningful.";

export const STANDARD_WCAG21_AA = "WCAG 2.1 AA";
export const STANDARD_PDF_UA1 = "PDF/UA-1";
