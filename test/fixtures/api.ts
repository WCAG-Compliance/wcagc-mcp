import express, { type Express } from "express";
import multer from "multer";
import type { AddressInfo } from "node:net";

const upload = multer({ storage: multer.memoryStorage() });

export const TOKENS = {
  FREE_OK: "test-token-free-ok",
  FREE_EXHAUSTED: "test-token-free-exhausted",
  PRO: "test-token-pro-unlimited",
  MCP_ONLY: "test-token-mcp-scope-only",
} as const;

interface Account {
  orgId: string;
  plan: string;
  limit: number | null;
}

const ACCOUNTS: Record<string, Account> = {
  [TOKENS.FREE_OK]: { orgId: "org-free-ok", plan: "FREE", limit: 2 },
  [TOKENS.MCP_ONLY]: { orgId: "org-mcp-only", plan: "PRO", limit: null },
  [TOKENS.FREE_EXHAUSTED]: { orgId: "org-free-exhausted", plan: "FREE", limit: 2 },
  [TOKENS.PRO]: { orgId: "org-pro", plan: "PRO", limit: null },
};

const SITE_ID = "11111111-1111-1111-1111-111111111111";
export const SITE_HOST = "example.com";
const JOURNEY_ID = "22222222-2222-2222-2222-222222222222";
const JOURNEY_NAME = "Checkout";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const JOURNEY_RUN_ID = "44444444-4444-4444-4444-444444444444";
const CHECKPOINT_SCAN_ID = "55555555-5555-5555-5555-555555555555";

const usage = new Map<string, number>();
usage.set(TOKENS.FREE_EXHAUSTED, 2); // pre-exhausted so the very next scan-url call is denied

const COVERAGE_DISCLAIMER =
  "Automated testing finds only a portion of accessibility barriers (commonly 30–57%). Many requirements need manual review.";

function bearerFrom(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

function account(token: string | undefined): Account | undefined {
  return token ? ACCOUNTS[token] : undefined;
}

function problem(status: number, code: string, detail: string, extra: Record<string, unknown> = {}) {
  return {
    type: `https://wcagc.com/problems/${code.toLowerCase().replace(/_/g, "-")}`,
    title: code,
    status,
    detail,
    code,
    ...extra,
  };
}

function scanResponse(id: string) {
  return {
    scan: {
      id,
      host: "example.com",
      requestedUrl: "https://example.com",
      status: "DONE",
      counts: { critical: 0, serious: 1, moderate: 2, minor: 0 },
      totalViolations: 3,
      topViolations: [
        { ruleId: "color-contrast", impact: "serious", helpUrl: "https://example.com/help", targetSelector: "button.cta" },
      ],
      incompleteCount: 0,
      passesCount: 40,
      failureReason: null,
    },
    coverageDisclaimer: COVERAGE_DISCLAIMER,
    standard: "WCAG 2.1 AA",
  };
}

function pdfResponse(id: string) {
  return {
    pdfCheck: {
      id,
      status: "DONE",
      profile: "PDF_UA_1",
      summary: { totalAssertions: 10, failedRuleCount: 1, failedCheckCount: 2, reportTruncated: false },
      failureReason: null,
    },
    coverageDisclaimer: COVERAGE_DISCLAIMER,
    standard: "PDF/UA-1",
  };
}

/** Stands in for wcagc-api's /api/v1/mcp/** surface (see wcagc-worker/test/fixtures for the pattern this mirrors). */
export function createFixtureApp(): Express {
  const app = express();
  app.use(express.json());

  app.post("/api/v1/mcp/introspect", (req, res) => {
    const token = bearerFrom(req);
    const acc = account(token);
    if (!acc) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    const used = usage.get(token!) ?? 0;
    const remaining = acc.limit === null ? null : Math.max(0, acc.limit - used);
    res.json({ orgId: acc.orgId, plan: acc.plan, scopes: ["mcp:scan"], remainingToday: remaining });
  });

  app.post("/api/v1/mcp/scan-url", (req, res) => {
    const token = bearerFrom(req);
    const acc = account(token);
    if (!acc) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    const used = usage.get(token!) ?? 0;
    if (acc.limit !== null && used >= acc.limit) {
      res.status(403).json(
        problem(403, "PLAN_LIMIT_EXCEEDED", `MCP_ACCESS is not available beyond the ${acc.plan} plan's daily limit.`, {
          feature: "MCP_ACCESS",
          targetPlan: "STARTER",
          limit: acc.limit,
        }),
      );
      return;
    }
    usage.set(token!, used + 1);
    res.status(202).json(scanResponse(`scan-${used}`));
  });

  app.get("/api/v1/mcp/scans/:id", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    res.json(scanResponse(req.params.id));
  });

  app.get("/api/v1/mcp/scans/:id/violations", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    res.json(scanResponse(req.params.id).scan.topViolations);
  });

  app.post("/api/v1/mcp/pdf-check", upload.single("file"), (req, res) => {
    const acc = account(bearerFrom(req));
    if (!acc) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    if (!req.file) {
      res.status(422).json(problem(422, "VALIDATION_FAILED", "file is required."));
      return;
    }
    res.status(202).json(pdfResponse("pdf-1"));
  });

  app.get("/api/v1/mcp/pdf-checks/:id", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    res.json(pdfResponse(req.params.id));
  });

  // A minimal-but-valid PDF for check_pdf's url-fetch path (magic bytes + trailer).
  app.get("/fixture.pdf", (_req, res) => {
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.from("%PDF-1.4\n%fixture\n%%EOF"));
  });

  // --- Pro+ v1 surface (wave 13-b) — reused endpoints, one fixture site/journey per org ------

  app.get("/api/v1/sites", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    // Mirrors ApiKeyAuthorization.requireScope: an mcp:scan-only key is authenticated but not
    // authorised for the v1 surface, and the ProblemDetail names the scope it lacked.
    if (bearerFrom(req) === TOKENS.MCP_ONLY) {
      res.status(403).json({
        ...problem(403, "API_KEY_SCOPE_MISSING", "The API key does not grant the required scope."),
        requiredScope: "sites:read",
      });
      return;
    }
    res.json([{ id: SITE_ID, name: "Example", rootUrl: `https://${SITE_HOST}`, normalizedHost: SITE_HOST, verified: true }]);
  });

  app.post("/api/v1/scans", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    // Mirrors PublicApiFacade.authorize: every v1 endpoint requires API_ACCESS after its scope
    // check, so a FREE org is refused here regardless of the key's scopes.
    if (account(bearerFrom(req))!.plan === "FREE") {
      res.status(403).json({
        ...problem(403, "FEATURE_NOT_IN_PLAN", "This feature is not included in your plan."),
        targetPlan: "PRO",
      });
      return;
    }
    // The real endpoint resolves the site from the URL's own host, so an unregistered host 404s.
    if (!String(req.body?.url ?? "").includes(SITE_HOST)) {
      res.status(404).json(problem(404, "SITE_NOT_FOUND", "Register the site before starting an API scan."));
      return;
    }
    res.status(202).json({
      id: "scan-registered-1", siteId: SITE_ID, status: "QUEUED",
      requestedUrl: req.body.url, counts: { critical: 0, serious: 0, moderate: 0, minor: 0 },
      totalViolations: 0, failureReason: null,
    });
  });

  app.post("/api/v1/scan-runs", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    res.status(202).json(runResponse(RUN_ID, req.body.siteId));
  });

  app.get("/api/v1/scan-runs/:id", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    res.json(runResponse(req.params.id, SITE_ID));
  });

  app.get("/api/v1/scan-runs/:id/violations", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    res.json([{ ruleId: "image-alt", impact: "critical", wcagSc: ["1.1.1"], url: `https://${SITE_HOST}`, helpUrl: "https://example.com/help", target: "img", htmlSnippet: "<img>", failureSummary: "Add an alt attribute" }]);
  });

  app.get("/api/v1/sites/:id/journeys", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    res.json([{ id: JOURNEY_ID, siteId: req.params.id, name: JOURNEY_NAME, usesAuth: false, createdAt: "2026-01-01T00:00:00Z" }]);
  });

  app.post("/api/v1/journeys/:id/runs", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    res.status(202).json(journeyRunResponse(JOURNEY_RUN_ID, req.params.id));
  });

  app.get("/api/v1/journey-runs/:id", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    res.json(journeyRunResponse(req.params.id, JOURNEY_ID));
  });

  app.get("/api/v1/sites/:id/trend", (req, res) => {
    if (!account(bearerFrom(req))) {
      res.status(401).json(problem(401, "API_KEY_INVALID", "Invalid API key."));
      return;
    }
    res.json({
      siteId: req.params.id, standard: "WCAG_2_1_AA",
      points: [{ scanRunId: RUN_ID, finishedAt: "2026-07-20T00:00:00Z", status: "COMPLETED", pagesScanned: 3,
        truncated: false, totalViolations: 4, bySeverity: { critical: 1, serious: 1, moderate: 1, minor: 1 },
        addedCount: null, resolvedCount: null }],
    });
  });

  return app;
}

function runResponse(id: string, siteId: string) {
  return {
    id, siteId, status: "QUEUED", pagesTotal: null, pagesDone: 0,
    counts: { critical: 0, serious: 0, moderate: 0, minor: 0 }, totalViolations: 0, failureReason: null,
  };
}

function journeyRunResponse(id: string, journeyId: string) {
  return {
    id, journeyId, siteId: SITE_ID, status: "QUEUED", failedStepIndex: null,
    failureReasonCode: null, failureReasonText: null,
    checkpoints: [{ scanId: CHECKPOINT_SCAN_ID, label: "Home", url: `https://${SITE_HOST}`, status: "QUEUED" }],
    startedAt: null, finishedAt: null, createdAt: "2026-01-01T00:00:00Z",
  };
}

export function listen(app: Express): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
