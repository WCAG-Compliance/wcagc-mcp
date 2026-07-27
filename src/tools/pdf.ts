import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiJson } from "../api-client.js";
import { resolveBearer } from "../bearer.js";
import { fetchPdf, PdfFetchError } from "../pdf-fetch.js";
import { toolError } from "../tool-error.js";
import { disclaimerShape, withDisclaimer } from "./common.js";

interface McpPdfCheckResponse {
  pdfCheck: {
    id: string;
    status: string;
    profile: string;
    summary: { totalAssertions: number | null; failedRuleCount: number | null; failedCheckCount: number | null; reportTruncated: boolean | null } | null;
    failureReason: { code: string } | null;
  };
  coverageDisclaimer: string;
  standard: string;
}

function summarizeText(response: McpPdfCheckResponse): string {
  const { pdfCheck } = response;
  const parts = [`PDF check ${pdfCheck.id} — status ${pdfCheck.status} (${pdfCheck.profile}).`];
  if (pdfCheck.status === "DONE" && pdfCheck.summary) {
    parts.push(
      `${pdfCheck.summary.failedCheckCount ?? 0} failed check(s) across ` +
        `${pdfCheck.summary.failedRuleCount ?? 0} rule(s). Standard: ${response.standard}.`,
    );
  } else if (pdfCheck.failureReason) {
    parts.push(`The check did not complete: ${pdfCheck.failureReason.code}.`);
  } else {
    parts.push("Still in progress — call get_pdf_check with this id to poll.");
  }
  parts.push(response.coverageDisclaimer);
  return parts.join(" ");
}

const pdfCheckOutputShape = {
  pdfCheck: z.object({
    id: z.string(),
    status: z.string(),
    profile: z.string(),
    summary: z.object({
      totalAssertions: z.number().nullish(),
      failedRuleCount: z.number().nullish(),
      failedCheckCount: z.number().nullish(),
      reportTruncated: z.boolean().nullish(),
    }).nullish(),
    failureReason: z.object({ code: z.string(), reason: z.string().nullish() }).nullish(),
  }),
  ...disclaimerShape,
};

export function registerPdfTools(server: McpServer): void {
  server.registerTool(
    "check_pdf",
    {
      title: "Check a PDF for PDF/UA-1 conformance",
      description:
        "Downloads a public PDF URL and runs a machine-verifiable veraPDF PDF/UA-1 check " +
        "(document structure, tags, reading order — not a full WCAG audit). Free tier, " +
        "counted against the caller's daily quota. Queues the check and returns immediately " +
        "with an id; call get_pdf_check to poll.",
      inputSchema: {
        url: z.string().url().max(2048).describe("A public URL serving a PDF file."),
      },
      outputSchema: pdfCheckOutputShape,
      annotations: {
        title: "Check a PDF for PDF/UA-1 conformance",
        // Downloads the URL and spends a daily quota slot; adds a check record, removes nothing.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const bytes = await fetchPdf(url);
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "document.pdf");
        const response = await apiJson<McpPdfCheckResponse>(bearer, "/api/v1/mcp/pdf-check", {
          method: "POST",
          body: form,
        });
        return {
          content: [{ type: "text" as const, text: summarizeText(response) }],
          structuredContent: withDisclaimer(response, response.standard) as unknown as Record<string, unknown>,
        };
      } catch (err) {
        if (err instanceof PdfFetchError) {
          return {
            content: [{ type: "text" as const, text: `${err.code}: ${err.message}` }],
            structuredContent: { code: err.code },
            isError: true as const,
          };
        }
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_pdf_check",
    {
      title: "Get a PDF check by id",
      description: "Polls a PDF check started by check_pdf — status, failed-rule and failed-check " +
        "counts, and a failure reason if it did not complete.",
      inputSchema: { checkId: z.string().uuid().describe("The id returned by check_pdf.") },
      outputSchema: pdfCheckOutputShape,
      annotations: {
        title: "Get a PDF check by id",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ checkId }, extra) => {
      try {
        const bearer = resolveBearer(extra);
        const response = await apiJson<McpPdfCheckResponse>(bearer, `/api/v1/mcp/pdf-checks/${checkId}`);
        return {
          content: [{ type: "text" as const, text: summarizeText(response) }],
          structuredContent: withDisclaimer(response, response.standard) as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
