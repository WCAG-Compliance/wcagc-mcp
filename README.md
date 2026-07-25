# wcagc-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (Claude, ChatGPT, or
any MCP-compatible client) run real, deterministic accessibility scans through
[wcagc](https://wcagc.com) — axe-core under the hood, not an LLM guess. Every scan result carries
an explicit coverage disclaimer and never claims "compliant": automated testing finds only a
portion of accessibility barriers, and this tool says so in every response.

This package is a **thin, stateless adapter**. It holds no database, no scan logic, and no
secrets beyond the wcagc API base URL — it translates MCP tool calls into HTTP calls against the
wcagc API and forwards the caller's own API key. All authentication, entitlements, quotas, and
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

**Hosted (Streamable HTTP)** — what Claude web/desktop/mobile connectors and ChatGPT use, since
neither runs a local process for you. Add this as a remote MCP connector and paste the same API
key as the bearer token:

```
https://mcp.wcagc.com/mcp
```

In ChatGPT, full tool access currently requires a Business, Enterprise, or Edu workspace; on Plus
you can use the read-only Custom GPT Action instead. See
[wcagc.com/integrations/mcp](https://wcagc.com/integrations/mcp).

## Tools

| Tool | Plan | What it does |
|---|---|---|
| `scan_url` | all | Scan any public URL, or a registered site for full tracking (Pro+). |
| `check_pdf` | all | Run a PDF/UA-1 structure check on a public PDF. |
| `get_scan` · `get_findings` | all | Read a scan's status, severity counts, and findings. |
| `list_sites` | Pro+ | List the account's registered sites. |
| `scan_site` | Pro+ | Crawl and scan every reachable page of a registered site. |
| `get_run` · `get_run_findings` | Pro+ | Read a full-site run. |
| `run_journey` | Pro+ | Replay a saved multi-step journey and check each step. |
| `get_trends` | Pro+ | Read a site's violation-count history over time. |

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
