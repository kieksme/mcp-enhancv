/**
 * Starts the Enhancv API mock with the synthetic evaluation account so the MCP server can be tried without an
 * Enhancv Business Plus account (for example with the MCP Inspector):
 *
 *   pnpm mock:api
 *   ENHANCV_API_URL=http://127.0.0.1:8787/api/v1 ENHANCV_API_KEY=enh_live_mock_key_for_tests \
 *     npx @modelcontextprotocol/inspector node dist/index.js
 */
import { MOCK_API_KEY, startMockEnhancv } from '../test/helpers/mock-enhancv.js';

const port = Number(process.env.MOCK_PORT || 8787);
const mock = await startMockEnhancv({ port });

console.log(`Enhancv API mock listening (synthetic data only).
  ENHANCV_API_URL=${mock.url}
  ENHANCV_API_KEY=${MOCK_API_KEY}
Press Ctrl+C to stop.`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void mock.close().finally(() => process.exit(0));
  });
}
