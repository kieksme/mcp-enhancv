# Agent rules

1. Use [Conventional Commits](https://www.conventionalcommits.org/) in English (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `build`, `perf`, `deps`, `security`). Release Please derives versions and the changelog from them: `feat` and `fix` create a release, `docs`/`test`/`ci`/`chore`/`refactor`/`build` do not.
2. Use pnpm 10 for dependencies, builds and tests; commit `pnpm-lock.yaml`. Never use npm or yarn to install.
3. Only create commits when the user explicitly asks. Never commit secrets (`.env`, API keys, tokens).
4. Never log or return `ENHANCV_API_KEY` or `MCP_HTTP_AUTH_TOKEN`; keep them out of error messages and tests.
5. Tests and evaluations must use synthetic data only (fictional people, `example.com`). No real resumes, no real API keys.
6. Follow the Enhancv documentation (https://developers.enhancv.com). Do not guess undocumented endpoints; document gaps in the README instead.
7. When changing tools or schemas run `pnpm typecheck && pnpm build && pnpm test && pnpm pack:check && pnpm smoke:dist`. A new tool needs a unit test, annotations, an `outputSchema` and (if it reads data) a look at the evaluations.
8. Keep `src/version.ts`, `package.json`, `.release-please-manifest.json` and the Dockerfile's `PNPM_VERSION` aligned; `test/release-metadata.test.ts` enforces it. Do not edit the version by hand, Release Please does.
9. The workflow file name `publish.yml` is registered as the npm Trusted Publisher. Do not rename it.
10. Names: repository `kieksme/mcp-enhancv`, package `@kieksme/enhancv-mcp`, image `ghcr.io/kieksme/enhancv-mcp`. License GPL-3.0-or-later; keep the full text in `LICENSE`.
11. Keep user-facing documentation in English.
