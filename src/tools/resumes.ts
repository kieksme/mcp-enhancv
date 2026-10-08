import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ResumeSummary } from '../enhancv/client.js';
import { formatSummaries, rateLimitNote, summarizeResume, truncateText } from '../utils/format.js';
import { RESUME_ID, ok, readOnly, responseFormat, run, type ToolContext } from './common.js';

const summaryOutput = z.object({
  id: z.string(),
  title: z.string().optional(),
  filename: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

const pick = (resume: ResumeSummary): ResumeSummary => ({
  id: resume.id,
  title: resume.title,
  filename: resume.filename,
  createdAt: resume.createdAt,
  updatedAt: resume.updatedAt
});

export function registerResumeReadTools(server: McpServer, { client }: ToolContext): void {
  server.registerTool(
    'enhancv_list_resumes',
    {
      title: 'List Enhancv resumes',
      description: `List the resumes in the Enhancv account, oldest first, with cursor pagination. Read-only. Cover letters are not part of the API.

Args:
  - cursor (string, optional): next_cursor from a previous call.
  - limit (number): 1-100, default 20.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns (structuredContent): { count, resumes: [{ id, title, filename, createdAt, updatedAt }], has_more, next_cursor }.
Use the id with enhancv_get_resume, enhancv_export_resume_pdf, enhancv_duplicate_resume or enhancv_delete_resume.
To look for a resume by name use enhancv_find_resumes instead of paging manually. The API allows 60 requests per minute per key.`,
      inputSchema: z
        .object({
          cursor: z.string().min(1).max(200).optional().describe('Pagination cursor (next_cursor of the previous call)'),
          limit: z.number().int().min(1).max(100).default(20).describe('Resumes per page (1-100)'),
          response_format: responseFormat.default('markdown').describe("'markdown' for reading, 'json' for processing")
        })
        .strict(),
      outputSchema: z.object({
        count: z.number(),
        resumes: z.array(summaryOutput),
        has_more: z.boolean(),
        next_cursor: z.string().nullable()
      }),
      annotations: readOnly
    },
    async ({ cursor, limit, response_format }) =>
      run(async () => {
        const { data, meta } = await client.listResumes({ cursor, limit });
        const next = data.pagination.cursor;
        // An empty page ends the listing even if the API still hands out a cursor.
        const hasMore = next !== null && data.resumes.length > 0;
        const output = { count: data.resumes.length, resumes: data.resumes.map(pick), has_more: hasMore, next_cursor: hasMore ? next : null };
        const text =
          response_format === 'json'
            ? JSON.stringify(output, null, 2)
            : `# Enhancv resumes (${output.count} shown)\n\n${output.count ? formatSummaries(output.resumes) : 'No resumes found.'}${
                hasMore ? `\n\nMore results available: call again with cursor "${next}".` : ''
              }`;
        return ok(truncateText(text).text + rateLimitNote(meta), output);
      })
  );

  server.registerTool(
    'enhancv_find_resumes',
    {
      title: 'Find Enhancv resumes by name',
      description: `Find resumes whose title or file name contains a text (case-insensitive). Read-only. Scans the account page by page (100 per request) and stops after max_pages requests or when the rate limit is nearly used up, so the API load stays bounded.

Args:
  - query (string): text to look for in title/filename, e.g. "data engineer".
  - max_pages (number): 1-10 requests to spend, default 5 (up to 500 resumes).
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns (structuredContent): { query, matches: [...], scanned, pages_fetched, complete, next_cursor }.
If complete is false not every resume was scanned; continue with enhancv_list_resumes(cursor=next_cursor) or raise max_pages.`,
      inputSchema: z
        .object({
          query: z.string().trim().min(1).max(200).describe('Text to search for in the resume title or file name'),
          max_pages: z.number().int().min(1).max(10).default(5).describe('Maximum number of API requests (100 resumes each)'),
          response_format: responseFormat.default('markdown')
        })
        .strict(),
      outputSchema: z.object({
        query: z.string(),
        matches: z.array(summaryOutput),
        scanned: z.number(),
        pages_fetched: z.number(),
        complete: z.boolean(),
        next_cursor: z.string().nullable()
      }),
      annotations: readOnly
    },
    async ({ query, max_pages, response_format }) =>
      run(async () => {
        const needle = query.toLowerCase();
        const matches: ResumeSummary[] = [];
        let cursor: string | undefined;
        let pages = 0;
        let scanned = 0;
        let complete = false;
        let lastMeta;
        while (pages < max_pages) {
          const { data, meta } = await client.listResumes({ cursor, limit: 100 });
          lastMeta = meta;
          pages++;
          scanned += data.resumes.length;
          for (const resume of data.resumes) {
            if (`${resume.title ?? ''}\n${resume.filename ?? ''}`.toLowerCase().includes(needle)) matches.push(pick(resume));
          }
          const next = data.pagination.cursor;
          if (!next || data.resumes.length === 0 || next === cursor) {
            complete = true;
            cursor = undefined;
            break;
          }
          cursor = next;
          if (meta.rateLimit.remaining !== undefined && meta.rateLimit.remaining <= 2) break;
        }
        const output = { query, matches, scanned, pages_fetched: pages, complete, next_cursor: complete ? null : (cursor ?? null) };
        const text =
          response_format === 'json'
            ? JSON.stringify(output, null, 2)
            : `# Resumes matching "${query}" (${matches.length})\n\n${matches.length ? formatSummaries(matches) : 'No matching resume found.'}\n\nScanned ${scanned} resume(s) in ${pages} request(s)${
                complete ? '.' : `; not every resume was scanned. Continue with cursor "${output.next_cursor}".`
              }`;
        return ok(truncateText(text).text + (lastMeta ? rateLimitNote(lastMeta) : ''), output);
      })
  );

  server.registerTool(
    'enhancv_get_resume',
    {
      title: 'Get an Enhancv resume',
      description: `Retrieve the complete content of one resume in Enhancv's "analyzer format": { title, header, sections, style }. Read-only. The same structure is accepted by enhancv_create_resume, so a resume can be fetched, modified and re-created (Enhancv has no update endpoint; see enhancv_duplicate_resume). Only visible fields are returned; cover letters cannot be retrieved.

Args:
  - resume_id (string): ID from enhancv_list_resumes.
  - response_format ('markdown' | 'json'): 'json' (default) returns the full structure, 'markdown' a compact overview.

Returns (structuredContent): { id, resume }. Months in dateRange are 0-based (0 = January).`,
      inputSchema: z.object({ resume_id: RESUME_ID, response_format: responseFormat.default('json') }).strict(),
      outputSchema: z.object({ id: z.string(), resume: z.record(z.string(), z.unknown()) }),
      annotations: readOnly
    },
    async ({ resume_id, response_format }) =>
      run(async () => {
        const { data, meta } = await client.getResume(resume_id);
        const text = response_format === 'json' ? JSON.stringify(data, null, 2) : summarizeResume(resume_id, data);
        return ok(truncateText(text).text + rateLimitNote(meta), { id: resume_id, resume: data });
      })
  );
}
