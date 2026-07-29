# wcagc-mcp

[![WCAG-Compliance/wcagc-mcp MCP server](https://glama.ai/mcp/servers/WCAG-Compliance/wcagc-mcp/badges/score.svg)](https://glama.ai/mcp/servers/WCAG-Compliance/wcagc-mcp)
[![smithery badge](https://smithery.ai/badge/wcag-compliance/wcagc-mcp)](https://smithery.ai/servers/wcag-compliance/wcagc-mcp)

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (Claude, ChatGPT, or
any MCP-compatible client) run real, deterministic accessibility scans through
[wcagc](https://wcagc.com) — axe-core under the hood, not an LLM guess. Every scan result carries
an explicit coverage disclaimer and never claims "compliant": automated testing finds only a
portion of accessibility barriers, and this tool says so in every response.

This package is a **thin, stateless adapter**. It holds no database, no scan logic, and no
secrets beyond the wcagc API base URL — it translates MCP tool calls into HTTP calls against the
wcagc API and forwards the caller's own bearer. All authentication, entitlements, quotas, and
scan orchestration live in the API; this code is safe to read end to end.

## Two ways to run it

**Local (stdio)** — for Claude Desktop, Cursor, or any MCP client that spawns a local process:

```bash
npx @wcagc/mcp
```

Configure your MCP client with:

```json
{
  "mcpServers": {
    "wcagc": {
      "command": "npx",
      "args": ["-y", "@wcagc/mcp"],
      "env": {
        "WCAGC_MCP_KEY": "<your mcp:scan API key>"
      }
    }
  }
}
```

Mint an `mcp:scan` key from your wcagc account under Settings → API keys — available on every
plan, with a daily quota on Free/Starter and unlimited on Pro/Agency.

**Hosted (Streamable HTTP + managed OAuth)** — what Claude web/desktop/mobile connectors and
ChatGPT use, since neither runs a local process for you. Add this remote MCP connector:

```
https://mcp.wcagc.com/mcp
```

The client discovers `/.well-known/oauth-protected-resource/mcp`, opens the wcagc login/consent
flow, and binds the connection to one Organization. No key copy/paste is required. API-key bearer
authentication remains supported for local stdio and CI.

ChatGPT availability depends on the ChatGPT plan and on whether the client permits action tools;
`scan_url` creates a scan and is not a read-only operation. See
[wcagc.com/integrations/mcp](https://wcagc.com/integrations/mcp).

## Tools

| Tool | Plan | What it does |
|---|---|---|
| `scan_url` | all | Scan any public URL, or a registered site for full tracking (Pro+). |
| `check_pdf` | all | Run a PDF/UA-1 structure check on a public PDF. |
| `get_scan` · `get_findings` | all | Read a `scan_url` scan's status, severity counts, and findings — either kind, recorded or one-off. |
| `list_sites` | Pro+ | List the account's registered sites. |
| `scan_site` | Pro+ | Crawl and scan every reachable page of a registered site. |
| `get_run` · `get_run_findings` | Pro+ | Read a full-site run from `scan_site`. |
| `get_root_causes` | Pro+ | Group a run's repeated DOM patterns and return factual element/page blast radius. |
| `run_journey` | Pro+ | Replay a saved multi-step journey and check each step. |
| `get_trends` | Pro+ | Read a site's violation-count history over time. |

One id, one poll tool: whatever `scan_url` did with a URL, `get_scan` and `get_findings` read it
back. `get_run` and `get_run_findings` are only for full-site runs from `scan_site`.

Every scan-producing tool returns the coverage disclaimer in both the text content and the
structured content. There is no score, grade, or conformance verdict — automated testing finds
roughly 30–57% of accessibility issues, and the remainder needs manual review.

## Configuration

| Env var | Used by | Meaning |
|---|---|---|
| `WCAGC_API_BASE_URL` | both | The wcagc API to call. Defaults to `https://api.wcagc.com`; set it only when self-hosting. |
| `WCAGC_MCP_KEY` | stdio | Your `mcp:scan` API key. |
| `PORT` | hosted | Port to listen on (default `8080`). |
| `WCAGC_MCP_ALLOWED_HOSTS` | hosted | Comma-separated Host-header allowlist (DNS-rebinding protection when bound to `0.0.0.0`). |
| `WCAGC_MCP_INTROSPECT_TTL_SECONDS` | hosted | How long a verified bearer is cached before re-checking with the API (default `60`). |
| `WCAGC_MCP_OAUTH_ISSUER` | hosted | Expected OAuth issuer (defaults to `WCAGC_API_BASE_URL`). |
| `WCAGC_MCP_OAUTH_JWKS_URL` | hosted | Authorization Server public JWKS URL. |
| `WCAGC_MCP_URL` | hosted | Canonical RFC 9728 protected-resource URL (defaults to `https://mcp.wcagc.com/mcp`). |
| `WCAGC_MCP_JWKS_TTL_SECONDS` | hosted | JWKS cache TTL; an unknown `kid` triggers an immediate refetch. |
| `WCAGC_OPENAI_APPS_CHALLENGE` | hosted | OpenAI Plugins Directory domain-verification token; keep it in the deployment secret store, never in source. |

## Development

```bash
npm install
npm run dev        # hosted, watch mode
npm run start:stdio # stdio mode
npm run typecheck
npm run verify      # node:test against a local fixture API
```

## License

MIT — see [LICENSE](./LICENSE).
