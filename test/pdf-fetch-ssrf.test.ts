import { strict as assert } from "node:assert";
import test from "node:test";
import { PdfFetchError, fetchPdf } from "../src/pdf-fetch.js";

// Every case is an IP literal or a reserved name, so nothing here performs a real DNS query and
// none of it depends on a resolver that hijacks NXDOMAIN.
const BLOCKED = [
  "http://127.0.0.1/report.pdf",
  "http://0.0.0.0/report.pdf",
  "http://169.254.169.254/latest/meta-data/",   // cloud metadata
  "http://10.0.0.5/report.pdf",
  "http://172.16.0.1/report.pdf",
  "http://192.168.1.1/report.pdf",
  "http://100.64.0.1/report.pdf",               // CGNAT — missed by the previous predicate
  "http://198.18.0.1/report.pdf",               // benchmarking range — likewise
  "http://203.0.113.1/report.pdf",              // TEST-NET-3 — likewise
  "http://224.0.0.1/report.pdf",                // multicast — likewise
  "http://240.0.0.1/report.pdf",                // reserved — likewise
  "http://[::1]/report.pdf",
  "http://[fc00::1]/report.pdf",
  "http://[fe80::1]/report.pdf",
  "http://[::ffff:127.0.0.1]/report.pdf",       // IPv4-mapped — waved through by default-allow
  "http://metadata.google.internal/computeMetadata/v1/",
  "http://anything.internal/report.pdf",
];

for (const url of BLOCKED) {
  test(`refuses ${url}`, async () => {
    await assert.rejects(
      () => fetchPdf(url),
      (error: unknown) => {
        assert.ok(error instanceof PdfFetchError, `expected PdfFetchError, got ${String(error)}`);
        assert.equal(error.code, "INVALID_URL");
        return true;
      },
    );
  });
}

test("refuses a non-http scheme outright", async () => {
  for (const url of ["file:///etc/passwd", "ftp://example.com/x.pdf", "gopher://example.com/"]) {
    await assert.rejects(() => fetchPdf(url), (error: unknown) => error instanceof PdfFetchError);
  }
});
