import type { CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { EnhancvClient } from '../enhancv/client.js';

/** Dependencies shared by all tool registrations. */
export type ToolContext = {
  client: EnhancvClient;
  /** Base directory for file_path/output_path; `undefined` means local file access is disabled. */
  filesDir: string | undefined;
};

export const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
export const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
export const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

export const responseFormat = z.enum(['markdown', 'json']);

export const RESUME_ID = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Use an Enhancv resume ID from enhancv_list_resumes')
  .describe('Enhancv resume ID, e.g. "64f1a2b3c4d5e6f7a8b9c0d1" (from enhancv_list_resumes)');

/** A successful result with human-readable text and machine-readable structured content. */
export function ok(text: string, structured: Record<string, unknown>, extra: CallToolResult['content'] = []): CallToolResult {
  return { content: [{ type: 'text', text }, ...extra], structuredContent: structured };
}

export function failure(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Run a tool body; every error becomes an `isError` result with an actionable message. */
export async function run(operation: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error) return failure(error.message);
    console.error('Unexpected non-Error thrown in a tool:', error);
    return failure('Unexpected error. Check the server logs.');
  }
}
