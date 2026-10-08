import { basename } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { createResumeSchema } from '../enhancv/schemas.js';
import { decodeBase64, formatBytes, readInputFile, resolveReadablePath, validateUpload } from '../utils/files.js';
import { rateLimitNote } from '../utils/format.js';
import { RESUME_ID, destructive, failure, ok, run, write, type ToolContext } from './common.js';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function registerResumeWriteTools(server: McpServer, { client, filesDir }: ToolContext): void {
  server.registerTool(
    'enhancv_create_resume',
    {
      title: 'Create an Enhancv resume',
      description: `Create a new resume from structured data. Not idempotent: every call creates another resume and counts toward the plan's resume limit. Fields left empty or omitted are hidden in the resume.

Structure (full reference: resource enhancv://reference/resume-structure, icons: enhancv://reference/icons):
  - header (required): { name, title, email, phone, location, website }
  - sections (required): object keyed by section type, e.g. summaries, experiences, educations, skills, industryExperiences, languages, certificates, projects ... Every section needs a "column" (0 left, 1 right, 2 third column only with style.layout "multicolumn"); "order" sorts sections within the page, "name" is the heading.
  - title (optional), style (optional: layout, colors, fonts, isLetterSize ...)
  - dateRange months are 0-based (0 = January, 11 = December); use isOngoing: true instead of toYear/toMonth for current positions.
  - industryExperiences.level is 0-10, languages.level is 0-5.

Example: { "title": "Backend Engineer", "header": { "name": "Jane Doe", "title": "Engineer" }, "sections": { "summaries": { "column": 0, "order": 0, "name": "Summary", "items": [{ "text": "..." }] } } }

Returns (structuredContent): { id }. Check the result with enhancv_get_resume or enhancv_export_resume_pdf.`,
      inputSchema: createResumeSchema,
      outputSchema: z.object({ id: z.string() }),
      annotations: write
    },
    async input =>
      run(async () => {
        const { data, meta } = await client.createResume(input);
        return ok(`Created resume ${data.id}.${rateLimitNote(meta)}`, { id: data.id });
      })
  );

  server.registerTool(
    'enhancv_upload_resume',
    {
      title: 'Upload and parse a resume file',
      description: `Upload a PDF, DOC or DOCX file; Enhancv parses it with an AI parser and creates a new resume. Not idempotent and counts toward the plan's resume limit. Takes 10-20 seconds.

Privacy: the file content is sent to Enhancv and to its parsing provider (HRFlow). Only upload documents you are allowed to share. The parsed result can be inaccurate and the original layout is not kept, so review it afterwards with enhancv_get_resume.

Args (provide exactly one source):
  - file_path (string): path below the server's ENHANCV_FILES_DIR (disabled unless that variable is set).
  - content_base64 (string) + filename (string): the file as base64, for remote/Docker use. filename must end in .pdf, .doc or .docx.
Limits: 10 MB; the content must match the file type.

Returns (structuredContent): { id, filename, bytes }.`,
      inputSchema: z
        .object({
          file_path: z.string().min(1).max(1024).optional().describe('Path of the file below ENHANCV_FILES_DIR, e.g. "cv.pdf"'),
          content_base64: z.string().min(1).max(14_000_000).optional().describe('File content as standard base64 (max 10 MB decoded)'),
          filename: z.string().min(1).max(200).optional().describe('File name with .pdf/.doc/.docx extension; required with content_base64')
        })
        .strict()
        .refine(value => (value.file_path === undefined) !== (value.content_base64 === undefined), {
          message: 'Provide exactly one of file_path or content_base64.'
        })
        .refine(value => value.content_base64 === undefined || value.filename !== undefined, {
          message: 'filename is required together with content_base64.'
        }),
      outputSchema: z.object({ id: z.string(), filename: z.string(), bytes: z.number() }),
      annotations: write
    },
    async ({ file_path, content_base64, filename }) =>
      run(async () => {
        let name: string;
        let bytes: Uint8Array;
        if (file_path !== undefined) {
          const resolved = resolveReadablePath(filesDir, file_path);
          name = basename(resolved);
          bytes = readInputFile(resolved);
        } else {
          name = filename as string;
          bytes = decodeBase64(content_base64 as string);
        }
        const upload = validateUpload(name, bytes);
        const { data, meta } = await client.uploadResume({ filename: upload.filename, mimeType: upload.mimeType, bytes: upload.bytes });
        return ok(
          `Uploaded ${upload.filename} (${formatBytes(bytes.byteLength)}); created resume ${data.id}. Review the parsed content with enhancv_get_resume.${rateLimitNote(meta)}`,
          { id: data.id, filename: upload.filename, bytes: bytes.byteLength }
        );
      })
  );

  server.registerTool(
    'enhancv_duplicate_resume',
    {
      title: 'Duplicate an Enhancv resume',
      description: `Copy a resume into a new resume (retrieve, then create). Enhancv has no update endpoint, so this is the building block for edits: duplicate, or fetch with enhancv_get_resume, change the structure and create it with enhancv_create_resume, then delete the old one if it is obsolete. Not idempotent; counts toward the resume limit. Fields that are hidden in the source are not copied. Cover letters are not supported.

Args:
  - resume_id (string): source resume.
  - title (string, optional): title of the copy, default "<source title> (copy)".

Returns (structuredContent): { id, source_id }.`,
      inputSchema: z
        .object({
          resume_id: RESUME_ID,
          title: z.string().trim().min(1).max(200).optional().describe('Title of the copy')
        })
        .strict(),
      outputSchema: z.object({ id: z.string(), source_id: z.string() }),
      annotations: write
    },
    async ({ resume_id, title }) =>
      run(async () => {
        const source = await client.getResume(resume_id);
        const { header, sections, style } = source.data;
        if (!isRecord(header) || !isRecord(sections)) {
          return failure('The source resume has no header/sections and cannot be copied (cover letters are not supported).');
        }
        const sourceTitle = typeof source.data.title === 'string' && source.data.title ? source.data.title : 'Resume';
        const payload = { title: (title ?? `${sourceTitle} (copy)`).slice(0, 200), header, sections, ...(isRecord(style) ? { style } : {}) };
        const { data, meta } = await client.createResume(payload);
        return ok(`Created resume ${data.id} as a copy of ${resume_id}.${rateLimitNote(meta)}`, { id: data.id, source_id: resume_id });
      })
  );

  server.registerTool(
    'enhancv_delete_resume',
    {
      title: 'Delete an Enhancv resume',
      description: `Permanently delete a resume. This cannot be undone and the resume cannot be recovered. Cover letters cannot be deleted through the API. Check the ID with enhancv_get_resume first and only call this when the user explicitly asked for the deletion.

Args:
  - resume_id (string): resume to delete.
  - confirm (true): must be literally true to acknowledge the deletion.

Returns (structuredContent): { deleted, resume_id }.`,
      inputSchema: z
        .object({
          resume_id: RESUME_ID,
          confirm: z.literal(true).describe('Must be true after the user confirmed the permanent deletion')
        })
        .strict(),
      outputSchema: z.object({ deleted: z.boolean(), resume_id: z.string() }),
      annotations: destructive
    },
    async ({ resume_id }) =>
      run(async () => {
        const { data, meta } = await client.deleteResume(resume_id);
        if (!data.success) return failure('Enhancv did not confirm the deletion. Check with enhancv_list_resumes whether the resume still exists.');
        return ok(`Deleted resume ${resume_id}.${rateLimitNote(meta)}`, { deleted: true, resume_id });
      })
  );
}
