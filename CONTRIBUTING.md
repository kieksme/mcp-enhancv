# Contributing

## Prerequisites

- Node.js 22.14 or newer (CI runs 22 and 24), pnpm 10 (`corepack enable` picks the version from `package.json`), Docker for the container checks.
- No Enhancv account is needed: tests and evaluations run against an in-process mock with synthetic data.

## Setup and checks

```bash
pnpm install --frozen-lockfile
pnpm lint           # ESLint (typescript-eslint); pnpm lint:fix for autofixes
pnpm typecheck
pnpm build
pnpm test            # unit tests + evaluation reference solutions
pnpm audit --prod --audit-level=high
pnpm pack:check      # fails if sources/tests leak into the npm package or dist is missing
pnpm smoke:dist      # starts dist/index.js over stdio
```

Container: `docker build -t enhancv-mcp:test .`, then run it as shown in the README and check `GET /health` (200) and `POST /mcp` without a token (401).

Try the server by hand without an Enhancv account:

```bash
pnpm mock:api                          # prints ENHANCV_API_URL and a mock API key
pnpm build
ENHANCV_API_URL=http://127.0.0.1:8787/api/v1 ENHANCV_API_KEY=enh_live_mock_key_for_tests \
  npx @modelcontextprotocol/inspector node dist/index.js
```

## Conventions

- [Conventional Commits](https://www.conventionalcommits.org/) in English. Pull request titles follow the same format.
- Match the existing code: strict Zod schemas, one registration function per tool group in `src/tools/`, shared helpers instead of copy-paste, no `any`.
- Documentation changes (README, tool descriptions) must stay faithful to <https://developers.enhancv.com>.
- New behaviour needs tests. Evaluation questions follow [`evaluations/README.md`](evaluations/README.md).

## Releases (maintainers)

Releases are automated with [Release Please](https://github.com/googleapis/release-please):

1. Merge changes to `main` with Conventional Commits. Release Please opens or updates a PR `chore(main): release X.Y.Z` with the changelog and version bumps
   (`package.json`, `.release-please-manifest.json`, `src/version.ts`).
2. Merging that PR creates the tag `X.Y.Z` (no `v` prefix) and the GitHub release. `release-please.yml` then dispatches
   - `publish.yml`: validates, then publishes to **npmjs.com** (Trusted Publishing, provenance) and **GitHub Packages** as two independent jobs,
   - `docker-publish.yml`: smoke-tests and pushes `ghcr.io/kieksme/enhancv-mcp` (`X.Y.Z`, `X.Y`, `latest`; `linux/amd64` + `linux/arm64`; provenance and SBOM attached).
3. Any of these can be re-run manually from the Actions tab with the tag as input.

`feat` bumps the minor version, breaking changes bump minor while the version is below 1.0.0 (major afterwards), `fix`/`perf`/`deps`/`security` are listed in the changelog;
`docs`, `test`, `ci`, `chore`, `refactor`, `build` and `style` do not trigger a release.
Release PRs created with the default `GITHUB_TOKEN` do not start the CI workflow; run it with *Re-run* or push an empty commit to the release branch if you need the check.

### One-time setup of a new repository

1. **Actions permission:** Settings > Actions > General > *Allow GitHub Actions to create and approve pull requests*.
2. **First npm publish (bootstrap).** npm Trusted Publishing can only be configured once the package exists.
   1. Create a granular npm access token with publish rights for the `@kieksme` scope and store it as the repository secret `NPM_TOKEN`.
   2. Merge the first release PR (tag `0.1.0`). `publish-npm` fails as expected; `publish-github` and the Docker build succeed.
   3. Run the workflow **npm Bootstrap (one-time)** with the tag `0.1.0`.
3. **Trusted Publisher:** npmjs.com > `@kieksme/enhancv-mcp` > Settings > Trusted Publisher > GitHub Actions: organization/user `kieksme`, repository `mcp-enhancv`,
   workflow file `publish.yml`, no environment. Optionally restrict publishing to Trusted Publishers only (disallow tokens).
4. **Clean up:** delete the `NPM_TOKEN` secret and `.github/workflows/npm-bootstrap.yml`.
5. **GHCR visibility:** a new container package starts private. Open *Packages > enhancv-mcp > Package settings* and set the visibility to public.
   Packages published to GitHub Packages must have the scope `@kieksme` (the repository owner).

### Security notes for workflows

- Secrets are only used by `npm-bootstrap.yml` (`NPM_TOKEN`); everything else runs on the short-lived `GITHUB_TOKEN` and OIDC.
- Workflow inputs are passed through `env`, never interpolated into shell scripts.
- Dependabot keeps npm packages, the Docker base image and GitHub Actions current. Consider pinning actions to commit SHAs if your policy requires it.

## License

By contributing you agree that your contributions are licensed under GPL-3.0-or-later.
