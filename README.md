# Enhancv MCP server

[Model Context Protocol](https://modelcontextprotocol.io) server for the [Enhancv](https://enhancv.com) resume API
([API documentation](https://developers.enhancv.com)). It lets an AI assistant list, read, create, upload, export (PDF),
duplicate and delete resumes in an Enhancv account.

- npm: [`@kieksme/enhancv-mcp`](https://www.npmjs.com/package/@kieksme/enhancv-mcp) (also on GitHub Packages)
- Container: `ghcr.io/kieksme/enhancv-mcp` (`linux/amd64`, `linux/arm64`)
- Transports: stdio (local) and Streamable HTTP (container / remote, bearer token required)
- License: GPL-3.0-or-later

> **Requirements:** an Enhancv account on the **Business Plus** plan with an API key
> (Enhancv > Account Settings > Profile > API Keys; the key is shown once and starts with `enh_live_`) and Node.js 22.14 or newer
> (not needed for the container). Use of the API is subject to Enhancv's [terms](https://enhancv.com/terms).

## Quick start

### Claude Desktop / any MCP client that uses a JSON config

```json
{
  "mcpServers": {
    "enhancv": {
      "command": "npx",
      "args": ["-y", "@kieksme/enhancv-mcp"],
      "env": {
        "ENHANCV_API_KEY": "<your Enhancv API key>",
        "ENHANCV_FILES_DIR": "/Users/me/Documents/resumes"
      }
    }
  }
}
```

`ENHANCV_FILES_DIR` is optional: it enables uploading local files and saving exported PDFs below that directory (see [Security](#security)).

### Claude Code

```bash
claude mcp add enhancv -e ENHANCV_API_KEY=<your Enhancv API key> -e ENHANCV_FILES_DIR="$HOME/Documents/resumes" -- npx -y @kieksme/enhancv-mcp
```

### Docker (Streamable HTTP)

```bash
docker run -d --name enhancv-mcp --init -p 127.0.0.1:3000:3000 \
  -e ENHANCV_API_KEY=<your Enhancv API key> \
  -e MCP_HTTP_AUTH_TOKEN="$(openssl rand -hex 32)" \
  ghcr.io/kieksme/enhancv-mcp:latest
```

The endpoint is `http://127.0.0.1:3000/mcp`; every request needs `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>`.
`GET /health` needs no token. For access from other machines put a TLS-terminating reverse proxy in front and add its
public host name to `MCP_HTTP_ALLOWED_HOSTS`. A ready-made [`docker-compose.yml`](docker-compose.yml) (read-only file system, no
capabilities) and [`.env.example`](.env.example) are included.

The image can also run over stdio: `docker run -i --rm -e MCP_TRANSPORT=stdio -e ENHANCV_API_KEY ghcr.io/kieksme/enhancv-mcp`.

### GitHub Packages

```ini
# ~/.npmrc  (token with the read:packages scope)
@kieksme:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then use the same `npx -y @kieksme/enhancv-mcp` command as above.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ENHANCV_API_KEY` | required | Enhancv API key (`enh_live_...`). Never logged. |
| `ENHANCV_FILES_DIR` | unset (file access off) | Directory below which `file_path` (upload) and `output_path` (PDF export) are allowed. Symlinks that leave it are refused. |
| `ENHANCV_MAX_RETRY_WAIT_MS` | `30000` | Longest single wait for a rate-limit (429) retry. A longer wait is reported as an error instead of blocking the call. |
| `ENHANCV_API_URL` | `https://api.enhancv.com/api/v1` | Override for tests/mocks. HTTPS is required except for localhost. |
| `MCP_TRANSPORT` | `stdio` (`http` in the image) | `stdio` or `http`. |
| `MCP_HTTP_AUTH_TOKEN` | required for `http` | Bearer token MCP clients must send. Compared in constant time. |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | `127.0.0.1` / `3000` | Bind address and port (the image binds `0.0.0.0`). |
| `MCP_HTTP_ALLOWED_HOSTS` | `127.0.0.1,localhost,[::1]` | Accepted `Host`/`Origin` host names (DNS rebinding protection). Required when binding beyond localhost. |

## Tools

All tools return human-readable text plus `structuredContent`; list-like tools accept `response_format` (`markdown` or `json`).

| Tool | Hints | What it does |
|---|---|---|
| `enhancv_list_resumes` | read-only | Page through the account (cursor, `limit` 1-100). |
| `enhancv_find_resumes` | read-only | Find resumes by title or file name; scans at most `max_pages` pages so API load stays bounded. |
| `enhancv_get_resume` | read-only | Full content in Enhancv's analyzer format (identical to the create format) or a compact summary. |
| `enhancv_create_resume` | write | Create a resume from structured data (`header`, `sections`, `style`), validated against the documented structure. |
| `enhancv_upload_resume` | write | Upload a PDF/DOC/DOCX (file path or base64) and let Enhancv parse it. 10 MB limit. |
| `enhancv_duplicate_resume` | write | Copy a resume (retrieve + create). Building block for edits, because Enhancv has no update endpoint. |
| `enhancv_export_resume_pdf` | writes a local file only with `output_path` | Render the PDF exactly like the Enhancv editor; returns it inline or saves it. |
| `enhancv_delete_resume` | destructive | Permanently delete a resume; requires `confirm: true`. |

Resources: `enhancv://reference/resume-structure` (sections, fields, ranges, layouts, fonts) and `enhancv://reference/icons`
(the 230 documented icon identifiers). The create tool's input schema is about 17 KB because it describes all 26 section types.

Example prompts:

- "List my Enhancv resumes and tell me which one was changed last."
- "Export the resume titled *Cloud Architect* as PDF to `exports/cloud-architect.pdf`."
- "Create a one-page resume for Jane Doe, backend engineer, with these three positions: ..."
- "Duplicate *Backend Engineer* as *Backend Engineer - Fintech* and show me the structure so we can tailor it."

## Behaviour worth knowing

- **Rate limits** (documented): 60 requests/minute, 1,000/hour, 10,000/day per key. On `429` the client waits `retryAfter` seconds with
  exponential backoff (max. 3 retries, only while the wait stays below `ENHANCV_MAX_RETRY_WAIT_MS`). `GET` requests are retried once on `500/502/504`;
  `POST`/`DELETE` are never retried after a server error because that could create duplicates. Tool results warn when few requests remain.
- **Months are 0-based** in Enhancv's date format (0 = January). The tool descriptions and the reference resource say so.
- **No update endpoint.** Edit = `enhancv_get_resume`, change the structure, `enhancv_create_resume` (or `enhancv_duplicate_resume`), then optionally delete the old one.
- **Resume limit:** both `create` and `upload` count toward the plan's resume limit; the API answers `403` when it is reached.
- **Time:** uploads take 10-20 s and PDF exports 5-15 s. Timeouts are 60 s and 90 s.

### Not implemented

The Enhancv documentation does not specify these, so they are intentionally absent rather than guessed:

- **LinkedIn import** (the docs only say Enhancv enables it per account on request; no endpoint is documented).
- **TXT export** (only mentioned in an error message; the documented export is PDF).
- **Cover letters** (explicitly unsupported by the API).

Documentation inconsistencies worth knowing: the docs speak of 27 section types but list 26 keys; API access is called "business plan" in
errors and "Business Plus" on the authentication page; the rate-limit guide reads `Retry-After` from a header while the API returns `retryAfter` in the body (this server uses the body and falls back to the header).

## Security

- **Least privilege by default:** local file access is **off** unless `ENHANCV_FILES_DIR` is set, and then confined to that directory
  (real-path checks defeat `..` and symlink escapes; exports use `0600` permissions and never overwrite without `overwrite: true`).
  This limits what a prompt-injected tool call can read or write. In HTTP mode, prefer `content_base64` and inline PDFs and leave `ENHANCV_FILES_DIR` unset.
- **Personal data:** resumes are personal data. Everything a tool returns enters the LLM context of your client, and an upload sends the document to
  Enhancv **and its parsing provider (HRFlow)**. Check your data-protection obligations (for example a data processing agreement) before using real resumes.
- **Secrets:** the API key is read from the environment only, redacted from error messages and never logged. The HTTP endpoint needs a bearer token;
  use a long random value and TLS in front of it.
- **Destructive actions:** `enhancv_delete_resume` needs `confirm: true`; tool annotations (`destructiveHint`, ...) are hints, so keep your client's approval prompts on.
- **Inputs are validated** (strict schemas, URL schemes, file types and magic bytes, size limits) before anything is sent to Enhancv.

See [SECURITY.md](SECURITY.md) for the capability list and how to report a vulnerability.

## Development

```bash
pnpm install
pnpm typecheck && pnpm build
pnpm test            # unit tests + evaluation reference solutions (no Enhancv account needed)
pnpm pack:check      # what npm would publish
pnpm smoke:dist      # start dist/index.js over stdio and list the tools
pnpm mock:api        # local mock of the Enhancv API with synthetic resumes, for manual tries / MCP Inspector
```

[`evaluations/`](evaluations) holds ten read-only evaluation questions with a synthetic account; see its README. Contributions and the
release process are described in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

GPL-3.0-or-later, see [LICENSE](LICENSE). Enhancv is a trademark of its owner; this project is an independent integration and is not affiliated with or endorsed by Enhancv.
