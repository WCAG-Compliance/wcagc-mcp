# AGENTS.md — wcagc-mcp (Node/TS, MCP server)

A thin, stateless adapter: it translates MCP tool calls into HTTP calls against `wcagc-api`, forwarding the caller's own bearer. No database, no scan logic, no secrets beyond `WCAGC_API_BASE_URL`. Authentication, entitlements, quotas and scan orchestration all live in the API — keep it that way.

Unlike the other services, this one leaves the monorepo twice: as **public source** (`WCAG-Compliance/wcagc-mcp`) and as a **public npm package** (`@wcagc/mcp`). Both are mirrored automatically; never push to either by hand.

---

## 1. ⚠️ Bump the version — every change that ships

**If you change anything under `wcagc-mcp/src/`, you MUST raise the version.** The version *is* the release trigger: `mcp.yml` publishes to npm and to the MCP Registry only when `package.json`'s `version` differs from the previous commit's. Forget it and your change silently deploys to Fly while every local `npx @wcagc/mcp` user stays on the old build — the two drift apart with nothing pointing it out.

Change all **four** in the same commit:

| File | Field |
|---|---|
| `package.json` | `version` |
| `server.json` | `version` |
| `server.json` | `packages[0].version` |
| `src/server.ts` | `VERSION` |

`npm run verify` fails if they disagree (`test/version.test.ts`) — so a mismatch cannot reach main, but *nobody* catches a version you never bumped at all. That check is on you.

Semver, judged by what an MCP client sees:
- **patch** — internal fix, no change to tool names, arguments or output shape.
- **minor** — new tool, new optional argument, new output field.
- **major** — renamed/removed tool, changed argument semantics, changed output shape.

Docs-only or test-only edits do not need a bump.

## 2. Releasing is automatic — do not run publish commands

Push to `main`, and CI does the rest: checks → deploy to Fly → sync the public repo → (on a version change) `npm publish` → MCP Registry listing → tag `mcp-v<version>`.

Never run `npm publish`, `mcp-publisher publish`, or push to the public mirror manually. Doing so is how `0.2.1` reached npm carrying a `dist/` built from `0.2.0` source. Full description: `../docs/wcagc-deploy-secrets.md` §5.0.

## 3. Hosted and local must stay identical

One codebase ships both transports — hosted Streamable HTTP (`src/hosted.ts`) and local stdio (`src/stdio.ts`) — over one shared tool catalog (`src/server.ts`). **Never** add a tool, argument or behaviour to one transport only: a user's result must not depend on how they connected.

`GET /health` reports the running version, and the release job refuses to publish to npm until `https://mcp.wcagc.com/health` answers with the exact version being published. Keep that endpoint working and unauthenticated — it is the parity signal, and Fly's health probe. It is deliberately mounted *before* the SDK's Host-header validation; `/mcp` keeps that protection.

## 4. Honesty rules (ROADMAP §2.6 — non-negotiable)

- Every scan-producing tool returns `coverageDisclaimer` **and** `standard` in **both** `content[].text` and `structuredContent`. Text alone is not enough — an assistant may only read one of them.
- **No score, no grade, no compliance verdict**, in tool output, tool descriptions, the README, `server.json`, or the Action manifest. "No automated issues found" is not "accessible".
- Forbidden words (DESIGN.md §9) must not appear anywhere, including in negated or instructional form.
- Never accept credentials, cookies or headers as tool arguments. Authenticated and journey scans use the site's already-saved auth profile in the API.

## 5. Verify

```bash
npm run typecheck && npm run verify
```

`verify` is `node:test` against a fixture API (`test/fixtures/api.ts`) — no backend, no Playwright. Add a test with every tool you add: happy path, the paywall/error branch, and the disclaimer's presence in both output channels.

Backend-side behaviour (`/api/v1/mcp/**`, `MCP_ACCESS` quota, key minting) is verified separately by `../wcagc-api/scripts/verify.sh --slice mcp-access` and `--slice mcp-pro` against a live stack.

## 6. Traps already paid for

- `allowedHosts` must be `undefined` when unset — an empty array opts into host validation with zero allowed hosts and rejects everything.
- `AuthInfo.expiresAt` is **seconds**, not milliseconds, and must not be floored — a truncated value can read as already expired.
- The npm package is scoped, so `publishConfig.access: "public"` is required or it publishes privately.
- `prepublishOnly` rebuilds `dist/`; don't remove it, or a stale build ships again.
- Test fixture ids must be real UUIDs — the tools validate them with `z.string().uuid()`.
