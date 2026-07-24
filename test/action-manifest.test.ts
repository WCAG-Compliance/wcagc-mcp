import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const MANIFEST_PATH = fileURLToPath(new URL("../chatgpt-action/manifest.json", import.meta.url));

// The exact list from DESIGN.md §9 (ROADMAP iron rule 2.6.2) — never a compliance/legal claim
// this product can't back, anywhere in wcagc-facing output, including this Action config.
const FORBIDDEN_WORDS = [
  "guaranteed compliant",
  "lawsuit-proof",
  "100% accessible",
  "fully wcag compliant",
  "certified",
  "court-proof",
  "fully compliant",
];

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

test("Action manifest shape is stable (top-level keys required by ChatGPT's Custom-GPT Action config)", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), [
    "auth",
    "availability_note",
    "description_for_human",
    "description_for_model",
    "legal_info_url",
    "name",
    "openapi_url",
    "privacy_policy_url",
  ]);
  assert.equal(manifest.auth.authorization_type, "bearer");
  assert.ok(manifest.openapi_url.startsWith("https://"));
});

test("Action manifest has no forbidden compliance/legal claims anywhere in its strings", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const haystack = collectStrings(manifest).join(" \n ").toLowerCase();
  for (const word of FORBIDDEN_WORDS) {
    assert.equal(haystack.includes(word), false, `forbidden phrase found: "${word}"`);
  }
});

test("Action manifest links to real, existing legal pages", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  assert.equal(manifest.legal_info_url, "https://wcagc.com/legal/terms-of-service");
  assert.equal(manifest.privacy_policy_url, "https://wcagc.com/legal/privacy-policy");
});
