import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_API_URL, DEFAULT_MAX_RETRY_WAIT_MS } from './constants.js';

export type TransportMode = 'stdio' | 'http';

export type Config = {
  apiKey: string;
  apiUrl: string;
  /** Base directory for file_path/output_path. `undefined` disables all local file access. */
  filesDir: string | undefined;
  maxRetryWaitMs: number;
};

/**
 * Read the server configuration from the environment.
 *
 * File access is opt-in: `ENHANCV_FILES_DIR` must be set explicitly. Defaulting to the working
 * directory would be unsafe because MCP clients start servers from arbitrary directories (often `/`
 * or the home directory), and a prompt-injected tool call could then read or overwrite any file there.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, mode: TransportMode = 'stdio'): Config {
  const apiKey = env.ENHANCV_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('ENHANCV_API_KEY is required. Create a key in Enhancv under Account Settings > Profile > API Keys (Business Plus plan).');
  }

  const apiUrl = env.ENHANCV_API_URL?.trim() || DEFAULT_API_URL;

  const rawWait = env.ENHANCV_MAX_RETRY_WAIT_MS?.trim();
  const maxRetryWaitMs = rawWait === undefined || rawWait === '' ? DEFAULT_MAX_RETRY_WAIT_MS : Number(rawWait);
  if (!Number.isInteger(maxRetryWaitMs) || maxRetryWaitMs < 0 || maxRetryWaitMs > 300_000) {
    throw new Error('ENHANCV_MAX_RETRY_WAIT_MS must be an integer from 0 to 300000');
  }

  const rawDir = env.ENHANCV_FILES_DIR?.trim();
  let filesDir: string | undefined;
  if (rawDir) {
    const absolute = resolve(rawDir);
    try {
      filesDir = realpathSync(absolute);
      if (!statSync(filesDir).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new Error(`ENHANCV_FILES_DIR must be an existing directory: ${absolute}`);
    }
    if (mode === 'http') {
      console.error('Warning: ENHANCV_FILES_DIR is set in HTTP mode; every authenticated MCP client can read and write files below it.');
    }
  }

  return { apiKey, apiUrl, filesDir, maxRetryWaitMs };
}
