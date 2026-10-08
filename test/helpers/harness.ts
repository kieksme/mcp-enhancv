import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { EnhancvClient } from '../../src/enhancv/client.js';
import { createEnhancvServer } from '../../src/server.js';
import { MOCK_API_KEY, startMockEnhancv, type MockEnhancv, type MockOptions } from './mock-enhancv.js';

export type ToolResult = Awaited<ReturnType<Client['callTool']>>;

export type Harness = {
  mock: MockEnhancv;
  mcp: Client;
  call: (name: string, args?: Record<string, unknown>) => Promise<ToolResult>;
  close: () => Promise<void>;
};

/** Mock Enhancv API + real EnhancvClient + real MCP server, connected to an MCP client in memory. */
export async function createHarness(options: MockOptions & { filesDir?: string } = {}): Promise<Harness> {
  const mock = await startMockEnhancv(options);
  const client = new EnhancvClient(options.apiKey ?? MOCK_API_KEY, { baseUrl: mock.url, sleep: async () => undefined });
  const server = createEnhancvServer({ client, filesDir: options.filesDir });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'enhancv-test-client', version: '0.0.0' });
  await mcp.connect(clientTransport);
  return {
    mock,
    mcp,
    call: (name, args = {}) => mcp.callTool({ name, arguments: args }),
    close: async () => {
      await mcp.close();
      await server.close();
      await mock.close();
    }
  };
}

/** Concatenated text blocks of a tool result. */
export function textOf(result: ToolResult): string {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n');
}

export function structured<T = Record<string, unknown>>(result: ToolResult): T {
  if (result.isError) throw new Error(`Tool returned an error: ${textOf(result)}`);
  return result.structuredContent as T;
}
