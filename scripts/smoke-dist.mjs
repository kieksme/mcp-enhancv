#!/usr/bin/env node
/**
 * Starts the compiled server (dist/index.js) over stdio, like an MCP client would after `npx @kieksme/enhancv-mcp`,
 * and checks the handshake, tools and resources. No network access to Enhancv is needed.
 */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const expectedTools = [
  'enhancv_create_resume',
  'enhancv_delete_resume',
  'enhancv_duplicate_resume',
  'enhancv_export_resume_pdf',
  'enhancv_find_resumes',
  'enhancv_get_resume',
  'enhancv_list_resumes',
  'enhancv_upload_resume'
];

const client = new Client({ name: 'smoke-dist', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'dist/index.js')],
  env: { ...process.env, ENHANCV_API_KEY: 'enh_live_smoke_test_key', MCP_TRANSPORT: 'stdio' },
  stderr: 'inherit'
});

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
  if (JSON.stringify(tools) !== JSON.stringify(expectedTools)) throw new Error(`Unexpected tools: ${tools.join(', ')}`);
  const resources = (await client.listResources()).resources.map(resource => resource.uri).sort();
  if (resources.length !== 2) throw new Error(`Unexpected resources: ${resources.join(', ')}`);
  console.log(`smoke:dist ok - ${tools.length} tools, ${resources.length} resources`);
} catch (error) {
  console.error('smoke:dist failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
