import dns from "node:dns/promises";
import net from "node:net";
import { config } from "./config.js";

export class PdfFetchError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PdfFetchError";
  }
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  return true; // unrecognized shape — fail closed
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (config.pdfFetchAllowedPrivateHosts.includes(hostname.toLowerCase())) {
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new PdfFetchError("INVALID_URL", "Could not resolve the PDF URL's host.");
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new PdfFetchError("INVALID_URL", "The PDF URL must resolve to a public address.");
  }
}

/**
 * Downloads a PDF from a user-supplied URL, bounded and SSRF-guarded. wcagc-api's PDF check only
 * accepts multipart bytes (PdfCheckFacade has no URL-fetch capability), so this is the bridge for
 * the MCP `check_pdf` tool's `url` argument: http(s)-only, DNS-checked against private ranges,
 * redirects rejected outright (a redirect could repoint at a private host after the DNS check —
 * simplest safe answer is not to follow it), size- and time-bounded, and the downloaded bytes are
 * verified to actually start with the PDF magic number before use. (A DNS-rebinding window
 * between the check and the fetch is a residual risk accepted at this scope — a bounded
 * single-file GET, not a general egress path.)
 */
export async function fetchPdf(url: string): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PdfFetchError("INVALID_URL", "Not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PdfFetchError("INVALID_URL", "Only http(s) URLs are supported.");
  }
  await assertPublicHost(parsed.hostname);

  let res: Response;
  try {
    res = await fetch(parsed, {
      redirect: "error",
      signal: AbortSignal.timeout(config.pdfFetchTimeoutMs),
    });
  } catch {
    throw new PdfFetchError("INVALID_URL", "Could not fetch the PDF URL.");
  }
  if (!res.ok || !res.body) {
    throw new PdfFetchError("INVALID_URL", `Could not fetch the PDF (status ${res.status}).`);
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > config.pdfFetchMaxBytes) {
      throw new PdfFetchError("PDF_FILE_TOO_LARGE", "The PDF exceeds the size limit.");
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new PdfFetchError("PDF_FILE_INVALID", "The fetched file is not a PDF.");
  }
  return bytes;
}
