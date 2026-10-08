# syntax=docker/dockerfile:1
#
# Enhancv MCP server as a container (Streamable HTTP on port 3000, endpoint /mcp, health check /health).
# Needs at runtime: ENHANCV_API_KEY and MCP_HTTP_AUTH_TOKEN (the bearer token MCP clients must send).
# For stdio use: docker run -i --rm -e MCP_TRANSPORT=stdio -e ENHANCV_API_KEY ghcr.io/kieksme/enhancv-mcp

# ---- build ----
FROM node:24-alpine AS build
# Keep in sync with "packageManager" in package.json (checked by test/release-metadata.test.ts).
ARG PNPM_VERSION=10.33.2
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY package.json pnpm-lock.yaml .pnpmfile.cjs ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

# ---- runtime ----
FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.title="enhancv-mcp" \
      org.opencontainers.image.description="MCP server for the Enhancv resume API" \
      org.opencontainers.image.source="https://github.com/kieksme/mcp-enhancv" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3000 \
    MCP_HTTP_ALLOWED_HOSTS=localhost,127.0.0.1
WORKDIR /app
# package.json is required at runtime for "type": "module".
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node LICENSE ./LICENSE
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
# Least privilege: the unprivileged "node" user; no secrets are baked into the image.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_HTTP_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
