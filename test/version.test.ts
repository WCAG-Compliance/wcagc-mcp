import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VERSION } from "../src/server.js";

// The protocol version the server reports, the npm package version, and the MCP Registry listing
// all have to be the same number. They have drifted once already (0.2.1 shipped a dist built from
// the 0.2.0 source, so the server announced 0.2.0 to clients), which is invisible without a check
// like this — nothing else compares them.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));

test("the version the server reports matches the published package version", () => {
  assert.equal(VERSION, pkg.version);
});

test("server.json declares the same version, for both the listing and its npm package entry", () => {
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].version, pkg.version);
});

test("server.json points at the package this repo actually publishes", () => {
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.name, pkg.mcpName);
});
