#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig, type TransportMode } from './config.js';
import { EnhancvClient } from './enhancv/client.js';
import { createHttpServer, parseHttpConfig } from './http.js';
import { createEnhancvServer } from './server.js';

function transportMode(env: NodeJS.ProcessEnv): TransportMode {
  const mode = env.MCP_TRANSPORT || 'stdio';
  if (mode !== 'stdio' && mode !== 'http') throw new Error('MCP_TRANSPORT must be "stdio" or "http"');
  return mode;
}

async function main(): Promise<void> {
  const mode = transportMode(process.env);
  const config = loadConfig(process.env, mode);
  const client = new EnhancvClient(config.apiKey, { baseUrl: config.apiUrl, maxRetryWaitMs: config.maxRetryWaitMs });
  const context = { client, filesDir: config.filesDir };

  if (mode === 'stdio') {
    // stdout carries the protocol: all diagnostics go to stderr.
    await serveStdio(() => createEnhancvServer(context));
    return;
  }

  const http = parseHttpConfig();
  const server = createHttpServer(context, http);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(http.port, http.host, resolve);
  });
  console.error(`Enhancv MCP listening on ${http.host}:${http.port} (POST /mcp, GET /health)`);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => server.close());
  }
}

main().catch(error => {
  // Messages are built without secrets (see EnhancvClient / loadConfig).
  console.error(error instanceof Error ? error.message : 'Failed to start the Enhancv MCP server');
  process.exitCode = 1;
});
