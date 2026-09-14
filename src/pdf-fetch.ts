import dns from "node:dns/promises";
import net from "node:net";
import { BlockList } from "node:net";
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

// Same rule set as wcagc-worker/src/network-policy.ts, deliberately: two different answers to
// "is this address reachable" is how one of them ends up wrong. The hand-rolled predicate this
// replaced missed 100.64.0.0/10 (CGNAT), the reserved and documentation ranges, multicast, and —
// because its IPv6 arm was default-ALLOW — every IPv4-mapped address such as ::ffff:127.0.0.1.
const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(network, prefix, "ipv4");

const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 32], ["2001:2::", 48], ["2001:db8::", 32],
  ["2001:10::", 28], ["2001:20::", 28], ["2002::", 16], ["fc00::", 7],
  ["fec0::", 10], ["fe80::", 10], ["ff00::", 8],
] as const) blockedV6.addSubnet(network, prefix, "ipv6");

// Default-deny for IPv6: an address must be inside the globally routable 2000::/3 to pass, so a
// shape nobody anticipated is refused rather than waved through.
const publicV6 = new BlockList();
publicV6.addSubnet("2000::", 3, "ipv6");

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return blockedV4.check(ip, "ipv4");
  if (net.isIPv6(ip)) return !(publicV6.check(ip, "ipv6") && !blockedV6.check(ip, "ipv6"));
  return true; // unrecognized shape — fail closed
}

// Hostnames that never resolve publicly but are the classic metadata targets.
const FORBIDDEN_HOSTNAMES = new Set([
  "instance-data", "metadata", "metadata.google.internal", "metadata.google.internal.",
]);

async function assertPublicHost(hostname: string): Promise<void> {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (config.pdfFetchAllowedPrivateHosts.includes(normalized)) {
    return;
  }
  if (FORBIDDEN_HOSTNAMES.has(normalized) || normalized.endsWith(".internal")) {
    throw new PdfFetchError("INVALID_URL", "The PDF URL must resolve to a public address.");
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
