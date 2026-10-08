# Security

## Expected capabilities

The server is meant to do exactly the following; anything else is a bug.

| Area | Behaviour |
|---|---|
| Network (outbound) | HTTPS to `api.enhancv.com` only (`ENHANCV_API_URL` can override it; HTTPS is enforced except for localhost). |
| Network (inbound) | Only in HTTP mode: `POST /mcp` with a bearer token and `GET /health`. Host and Origin headers are checked against `MCP_HTTP_ALLOWED_HOSTS`. |
| File system | Off by default. With `ENHANCV_FILES_DIR` the server reads upload files from and writes PDF exports to that directory only. |
| Processes | None are spawned. |
| Environment | Reads `ENHANCV_*` and `MCP_*` variables only. |

## Secret handling

- `ENHANCV_API_KEY` and `MCP_HTTP_AUTH_TOKEN` are read from the environment. They are not logged, not part of tool output and are removed from upstream error texts.
- The container image contains no secrets; pass them at runtime or through your orchestrator's secret store.
- Rotate an Enhancv key immediately if it leaked (Account Settings > Profile > API Keys > Delete).

## Data protection

Resumes contain personal data. Tool results enter the context of the connected AI client. Uploaded files are sent to Enhancv and to the parser provider named in the
[Enhancv documentation](https://developers.enhancv.com/api/upload). Decide whether you may process the data this way before connecting real resumes.

## Reporting a vulnerability

Please do not open a public issue. Use [GitHub private vulnerability reporting](https://github.com/kieksme/mcp-enhancv/security/advisories/new)
for this repository. Include the affected version, steps to reproduce and the impact. Expect an acknowledgement within a few days.
