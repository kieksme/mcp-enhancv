import { execFile } from 'node:child_process';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnhancvClient } from '../src/enhancv/client.js';
import { createHttpServer, parseHttpConfig } from '../src/http.js';
import { MOCK_API_KEY, startMockEnhancv, type MockEnhancv } from './helpers/mock-enhancv.js';

const run = promisify(execFile);
const TOKEN = 'mcp-secret-token';

let mock: MockEnhancv;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  mock = await startMockEnhancv();
  const client = new EnhancvClient(MOCK_API_KEY, { baseUrl: mock.url });
  server = createHttpServer({ client, filesDir: undefined }, { token: TOKEN, host: '127.0.0.1', port: 0, allowedHosts: ['127.0.0.1'] });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await mock.close();
});

const authed = () => ({ requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } });

describe('parseHttpConfig', () => {
  it('requires a token and a valid port', () => {
    expect(() => parseHttpConfig({})).toThrow('MCP_HTTP_AUTH_TOKEN');
    expect(() => parseHttpConfig({ MCP_HTTP_AUTH_TOKEN: '   ' })).toThrow('MCP_HTTP_AUTH_TOKEN');
    expect(() => parseHttpConfig({ MCP_HTTP_AUTH_TOKEN: 'x', MCP_HTTP_PORT: '70000' })).toThrow('MCP_HTTP_PORT');
    expect(parseHttpConfig({ MCP_HTTP_AUTH_TOKEN: 'x' })).toEqual({ token: 'x', host: '127.0.0.1', port: 3000, allowedHosts: ['127.0.0.1', 'localhost', '[::1]'] });
  });

  it('requires an explicit host allowlist when binding beyond localhost', () => {
    expect(() => parseHttpConfig({ MCP_HTTP_AUTH_TOKEN: 'x', MCP_HTTP_HOST: '0.0.0.0' })).toThrow('MCP_HTTP_ALLOWED_HOSTS');
    expect(parseHttpConfig({ MCP_HTTP_AUTH_TOKEN: 'x', MCP_HTTP_HOST: '0.0.0.0', MCP_HTTP_ALLOWED_HOSTS: 'Mcp.Example.com, localhost' }).allowedHosts).toEqual(['mcp.example.com', 'localhost']);
  });
});

describe('HTTP transport', () => {
  it('serves /health without credentials and nothing else without them', async () => {
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect(await (await fetch(`${baseUrl}/health`)).json()).toEqual({ status: 'ok' });
    expect((await fetch(`${baseUrl}/mcp`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { Authorization: `Basic ${TOKEN}` } })).status).toBe(401);
    expect((await fetch(`${baseUrl}/other`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/mcp`, { method: 'POST' })).headers.get('www-authenticate')).toContain('Bearer');
  });

  it('blocks foreign origins and unexpected host headers (DNS rebinding)', async () => {
    expect((await fetch(`${baseUrl}/health`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path: '/health', headers: { Host: 'evil.example' } }, response => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('serves authenticated MCP clients, including the 2026 protocol negotiation', async () => {
    for (const options of [{}, { versionNegotiation: { mode: 'auto' as const } }]) {
      const client = new Client({ name: 'http-test', version: '1.0.0' }, options);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), authed()));
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain('enhancv_list_resumes');
      const result = await client.callTool({ name: 'enhancv_list_resumes', arguments: { limit: 3 } });
      expect(result.isError).not.toBe(true);
      expect((result.structuredContent as { count: number }).count).toBe(3);
      await client.close();
    }
    expect(mock.requests.some(request => request.headers.authorization === `Bearer ${MOCK_API_KEY}`)).toBe(true);
  });

  it('accepts an 8 MB upload as base64 (body limit above the 4 MiB SDK default)', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(8 * 1024 * 1024)]);
    const client = new Client({ name: 'upload-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), authed()));
    const result = await client.callTool({ name: 'enhancv_upload_resume', arguments: { content_base64: pdf.toString('base64'), filename: 'big.pdf' } });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(mock.requests.at(-1)?.upload).toMatchObject({ filename: 'big.pdf', size: pdf.byteLength });
    await client.close();
  });
});

describe('stdio transport', () => {
  const env = (extra: Record<string, string> = {}) => ({ ...(process.env as Record<string, string>), ENHANCV_API_KEY: MOCK_API_KEY, ENHANCV_API_URL: mock.url, ...extra });

  it('speaks clean JSON-RPC on stdout (diagnostics go to stderr)', async () => {
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/index.ts'], env: env(), stderr: 'ignore' }));
    expect((await client.listTools()).tools).toHaveLength(8);
    const result = await client.callTool({ name: 'enhancv_find_resumes', arguments: { query: 'security' } });
    expect((result.structuredContent as { matches: { title: string }[] }).matches[0]?.title).toBe('Security Analyst');
    await client.close();
  });

  it.each([
    ['without an API key', { ENHANCV_API_KEY: '' }, 'ENHANCV_API_KEY is required'],
    ['with an unknown transport', { MCP_TRANSPORT: 'sse' }, 'MCP_TRANSPORT must be'],
    ['in HTTP mode without a bearer token', { MCP_TRANSPORT: 'http' }, 'MCP_HTTP_AUTH_TOKEN is required'],
    ['with a non-existing files directory', { ENHANCV_FILES_DIR: '/definitely/not/here' }, 'ENHANCV_FILES_DIR must be an existing directory'],
    ['with a production key of the wrong format', { ENHANCV_API_KEY: 'sk-wrong', ENHANCV_API_URL: 'https://api.enhancv.com/api/v1' }, 'enh_live_']
  ])('fails fast %s', async (_name, extra, message) => {
    const failure = await run(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: env(extra), timeout: 15_000 }).catch((error: { code?: number; stderr?: string }) => error);
    expect((failure as { code?: number }).code).toBe(1);
    expect((failure as { stderr?: string }).stderr).toContain(message);
    expect((failure as { stderr?: string }).stderr).not.toContain(MOCK_API_KEY);
  });
});
