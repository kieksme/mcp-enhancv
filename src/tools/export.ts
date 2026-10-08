import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { MAX_INLINE_PDF_BYTES } from '../constants.js';
import { formatBytes, resolveWritablePath, writeOutputFile } from '../utils/files.js';
import { rateLimitNote } from '../utils/format.js';
import { RESUME_ID, failure, ok, run, type ToolContext } from './common.js';

export function registerExportTools(server: McpServer, { client, filesDir }: ToolContext): void {
  server.registerTool(
    'enhancv_export_resume_pdf',
    {
      title: 'Export an Enhancv resume as PDF',
      description: `Render a resume as PDF exactly as the Enhancv editor shows it (A4 or US Letter as configured). Takes 5-15 seconds; repeated exports of an unchanged resume are faster. Cover letters are not supported. Creates no resume and changes nothing in the account.

Args:
  - resume_id (string): ID from enhancv_list_resumes.
  - output_path (string, optional): write the PDF to this path below ENHANCV_FILES_DIR (required for PDFs larger than 5 MB; disabled unless that variable is set). Without it the PDF is returned inline as a base64 embedded resource.
  - overwrite (boolean): allow replacing an existing file, default false.

Returns (structuredContent): { resume_id, filename, bytes, saved_to }.`,
      inputSchema: z
        .object({
          resume_id: RESUME_ID,
          output_path: z.string().min(1).max(1024).optional().describe('Target file below ENHANCV_FILES_DIR, e.g. "jane-doe.pdf"'),
          overwrite: z.boolean().default(false).describe('Replace an existing file')
        })
        .strict(),
      outputSchema: z.object({
        resume_id: z.string(),
        filename: z.string(),
        bytes: z.number(),
        saved_to: z.string().nullable()
      }),
      // Not read-only: with output_path the tool writes a local file. That is its only side effect, it is confined to
      // ENHANCV_FILES_DIR and refuses to replace files unless overwrite is set. The Enhancv account is never changed.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ resume_id, output_path, overwrite }) =>
      run(async () => {
        const target = output_path === undefined ? undefined : resolveWritablePath(filesDir, output_path);
        const { data, meta } = await client.exportPdf(resume_id);
        const filename = data.filename ?? `${resume_id}.pdf`;
        const size = formatBytes(data.bytes.byteLength);

        if (target !== undefined) {
          writeOutputFile(target, data.bytes, overwrite);
          return ok(`Saved the PDF (${size}) to ${output_path}.${rateLimitNote(meta)}`, {
            resume_id,
            filename,
            bytes: data.bytes.byteLength,
            saved_to: output_path ?? null
          });
        }
        if (data.bytes.byteLength > MAX_INLINE_PDF_BYTES) {
          return failure(`The PDF is ${size}, too large to return inline (limit 5 MB). Set output_path (and ENHANCV_FILES_DIR) to save it as a file.`);
        }
        return ok(
          `Exported ${filename} (${size}) as an embedded PDF resource.${rateLimitNote(meta)}`,
          { resume_id, filename, bytes: data.bytes.byteLength, saved_to: null },
          [
            {
              type: 'resource',
              resource: { uri: `enhancv://export/${resume_id}.pdf`, mimeType: 'application/pdf', blob: Buffer.from(data.bytes).toString('base64') }
            }
          ]
        );
      })
  );
}
