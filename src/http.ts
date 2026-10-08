import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { MAX_HTTP_BODY_BYTES } from './constants.js';
import { createEnhancvServer } from './server.js';
import type { ToolContext } from './tools/common.js';

export type HttpConfig = { token: string; host: string; port: number; allowedHosts: string[] };

/** Read `MCP_HTTP_*` settings. A bearer token is mandatory; binding beyond localhost needs an explicit host allowlist. */
export function parseHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const token = env.MCP_HTTP_AUTH_TOKEN?.trim();
  if (!token) throw new Error('MCP_HTTP_AUTH_TOKEN is required for HTTP mode (e.g. generate one with: openssl rand -hex 32)');
  const host = env.MCP_HTTP_HOST || '127.0.0.1';
  const port = Number(env.MCP_HTTP_PORT || '3000');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('MCP_HTTP_PORT must be 0..65535');
  const allowedHosts = (env.MCP_HTTP_ALLOWED_HOSTS || '127.0.0.1,localhost,[::1]')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
  if (host !== '127.0.0.1' && host !== 'localhost' && !env.MCP_HTTP_ALLOWED_HOSTS) {
    throw new Error('MCP_HTTP_ALLOWED_HOSTS is required when binding beyond localhost (comma-separated host names clients use)');
  }
  return { token, host, port, allowedHosts };
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function validOrigin(origin: string | undefined, allowedHosts: string[]): boolean {
  if (!origin) return true;
  try {
    return allowedHosts.includes(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Stateless Streamable HTTP endpoint: `POST /mcp` (bearer token required) and `GET /health`.
 * Host and Origin headers are checked against the allowlist to defeat DNS rebinding.
 */
export function createHttpServer(context: ToolContext, config: HttpConfig): HttpServer {
  const handler = createMcpHandler(() => createEnhancvServer(context), { maxRequestBodySize: MAX_HTTP_BODY_BYTES });
  // The Node adapter has its own 4 MiB body bound that applies before the handler's; raise both for base64 uploads.
  const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: MAX_HTTP_BODY_BYTES });
  const server = createServer((request, response) => {
    const hostname = request.headers.host?.replace(/:\d+$/, '').toLowerCase();
    if (!hostname || !config.allowedHosts.includes(hostname) || !validOrigin(request.headers.origin, config.allowedHosts)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const pathname = new URL(request.url ?? '/', `http://${request.headers.host}`).pathname;
    if (pathname === '/health' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
      return;
    }
    if (pathname !== '/mcp') {
      response.writeHead(404).end('Not found');
      return;
    }
    if (!authorized(request.headers.authorization, config.token)) {
      response.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="enhancv-mcp"' }).end('Unauthorized');
      return;
    }
    void nodeHandler(request, response).catch(error => {
      console.error('MCP HTTP request failed:', error instanceof Error ? error.message : error);
      if (!response.headersSent) response.writeHead(500).end('Server error');
    });
  });
  server.on('close', () => {
    void handler.close();
  });
  return server;
}
