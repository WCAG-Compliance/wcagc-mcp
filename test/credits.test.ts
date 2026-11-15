import assert from "node:assert/strict";
import { test } from "node:test";
import { McpApiError } from "../src/api-client.js";
import { toolError } from "../src/tool-error.js";

test("Pricing V2: INSUFFICIENT_CREDITS reaches the assistant with required/available and where to top up", () => {
  const result = toolError(
    new McpApiError(402, "INSUFFICIENT_CREDITS", "This needs 6 credits; 2 are available.", undefined, undefined, undefined, {
      required: 6,
      available: 2,
      operation: "AI_EXPLANATION",
    }),
  );
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "INSUFFICIENT_CREDITS");
  assert.equal(result.structuredContent.required, 6);
  assert.equal(result.structuredContent.available, 2);
  assert.equal(result.structuredContent.operation, "AI_EXPLANATION");
  assert.match(result.content[0].text, /Required: 6 credits, available: 2\. Nothing was charged\./);
  assert.match(result.content[0].text, /\/billing\/credits/);
});
