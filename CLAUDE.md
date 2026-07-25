# CLAUDE.md — wcagc-mcp

Canonical rules for this service live in **[AGENTS.md](AGENTS.md)** — read it before changing anything here.

## The one that bites

**Changed anything in `src/`? Bump the version in all four places, same commit:** `package.json` `version` · `server.json` `version` · `server.json` `packages[0].version` · `src/server.ts` `VERSION`.

The version is the release trigger. Skip it and your change deploys to Fly while every `npx @wcagc/mcp` user stays on the old build, with nothing flagging the drift. `npm run verify` catches the four disagreeing with each other — it cannot catch a bump you never made.

## Quick reminders (full detail in AGENTS.md)

- **Never publish by hand** — no `npm publish`, no `mcp-publisher publish`, no pushing to the public mirror. CI owns all of it on a version change.
- **Hosted and local are one codebase.** Never add a tool or behaviour to only one transport.
- **Every scan result carries `coverageDisclaimer` + `standard` in BOTH `content[].text` and `structuredContent`.** No score, no grade, no compliance verdict, anywhere.
- **No credentials as tool arguments** — authenticated scans use the site's saved auth profile in the API.
- `GET /health` must stay working and unauthenticated: it is Fly's probe *and* the hosted/npm parity check.
- Verify with `npm run typecheck && npm run verify` (`node:test` + fixture API — no backend, no Playwright).
