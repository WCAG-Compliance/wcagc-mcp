#!/usr/bin/env node
/**
 * Sets the release version in the four places that must agree.
 *
 * They are separate files for good reasons — npm reads package.json, the MCP Registry reads
 * server.json, and clients read the VERSION the server announces over the protocol — but editing
 * them by hand is a trap: miss one and `npm run verify` fails the build (test/version.test.ts),
 * or, before that check existed, a release shipped announcing the wrong version entirely.
 *
 *   npm run set-version 0.2.6
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: npm run set-version <major.minor.patch>   e.g. npm run set-version 0.2.6");
  process.exit(1);
}

const read = (f) => readFileSync(join(root, f), "utf8");
const write = (f, text) => writeFileSync(join(root, f), text, "utf8");

// Edited as text, not re-serialised, so hand-maintained formatting survives.
const pkg = read("package.json");
const previous = JSON.parse(pkg).version;
if (previous === version) {
  console.error(`Already at ${version} — nothing to do.`);
  process.exit(1);
}

write("package.json", pkg.replace(`"version": "${previous}"`, `"version": "${version}"`));

const server = read("server.json");
const occurrences = server.split(`"${previous}"`).length - 1;
if (occurrences !== 2) {
  // The listing version and packages[].version must both move; bail rather than half-update.
  console.error(`server.json: expected 2 occurrences of "${previous}", found ${occurrences}.`);
  process.exit(1);
}
write("server.json", server.split(`"${previous}"`).join(`"${version}"`));

write("src/server.ts", read("src/server.ts").replace(`const VERSION = "${previous}";`, `const VERSION = "${version}";`));

// Fail loudly here rather than leaving a half-applied bump for CI to find.
const check = {
  "package.json": JSON.parse(read("package.json")).version,
  "server.json": JSON.parse(read("server.json")).version,
  "server.json packages[0]": JSON.parse(read("server.json")).packages[0].version,
  "src/server.ts": read("src/server.ts").match(/const VERSION = "([^"]+)"/)?.[1],
};
const wrong = Object.entries(check).filter(([, v]) => v !== version);
if (wrong.length > 0) {
  console.error("Version not applied everywhere:", Object.fromEntries(wrong));
  process.exit(1);
}

console.log(`${previous} -> ${version}`);
for (const [file, v] of Object.entries(check)) console.log(`  ${file.padEnd(24)} ${v}`);
console.log("\nCommit this on main and CI does the rest: deploy, npm publish, registry listing, tags.");
