import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FixtureResume } from '../evaluations/fixtures.js';
import { rateLimitNote, truncateText } from '../src/utils/format.js';
import { createHarness, structured, textOf, type Harness } from './helpers/harness.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

type ListOutput = { count: number; resumes: { id: string; title: string }[]; has_more: boolean; next_cursor: string | null };

describe('tool catalogue', () => {
  it('exposes the documented operations with complete metadata', async () => {
    const { tools } = await h.mcp.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'enhancv_create_resume',
      'enhancv_delete_resume',
      'enhancv_duplicate_resume',
      'enhancv_export_resume_pdf',
      'enhancv_find_resumes',
      'enhancv_get_resume',
      'enhancv_list_resumes',
      'enhancv_upload_resume'
    ]);
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.description?.length, tool.name).toBeGreaterThan(80);
      expect(tool.annotations, tool.name).toBeDefined();
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect((tool.inputSchema as { additionalProperties?: boolean }).additionalProperties, tool.name).toBe(false);
    }
    const hints = Object.fromEntries(tools.map(tool => [tool.name, tool.annotations]));
    expect(hints.enhancv_list_resumes).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(hints.enhancv_find_resumes).toMatchObject({ readOnlyHint: true });
    expect(hints.enhancv_get_resume).toMatchObject({ readOnlyHint: true });
    expect(hints.enhancv_create_resume).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(hints.enhancv_delete_resume).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(hints.enhancv_export_resume_pdf).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  });

  it('serves the reference resources', async () => {
    const { resources } = await h.mcp.listResources();
    expect(resources.map(resource => resource.uri).sort()).toEqual(['enhancv://reference/icons', 'enhancv://reference/resume-structure']);
    const structure = await h.mcp.readResource({ uri: 'enhancv://reference/resume-structure' });
    expect((structure.contents[0] as { text: string }).text).toContain('| `experiences` |');
    const icons = await h.mcp.readResource({ uri: 'enhancv://reference/icons' });
    expect((icons.contents[0] as { text: string }).text).toContain('- 54-free-code');
  });
});

describe('enhancv_list_resumes', () => {
  it('pages through the account with the documented cursor', async () => {
    const first = structured<ListOutput>(await h.call('enhancv_list_resumes', { limit: 5 }));
    expect(first.count).toBe(5);
    expect(first.has_more).toBe(true);
    expect(first.resumes[0]?.title).toBe('Backend Engineer');
    const second = structured<ListOutput>(await h.call('enhancv_list_resumes', { limit: 5, cursor: first.next_cursor! }));
    expect(second.resumes[0]?.title).toBe('Engineering Manager');
    const last = structured<ListOutput>(await h.call('enhancv_list_resumes', { limit: 5, cursor: second.next_cursor! }));
    expect(last.count).toBe(2);
    expect(last.has_more).toBe(false);
    expect(last.next_cursor).toBeNull();
    expect(h.mock.requests.map(request => request.query.limit)).toEqual(['5', '5', '5']);
  });

  it('renders markdown by default and JSON on request', async () => {
    const markdown = await h.call('enhancv_list_resumes', { limit: 2 });
    expect(textOf(markdown)).toContain('# Enhancv resumes (2 shown)');
    expect(textOf(markdown)).toContain('**Backend Engineer**');
    expect(textOf(markdown)).toContain('More results available');
    const json = await h.call('enhancv_list_resumes', { limit: 2, response_format: 'json' });
    expect(JSON.parse(textOf(json))).toMatchObject({ count: 2, has_more: true });
  });

  it('stops when the API keeps a cursor on an empty page (as shown in the docs example)', async () => {
    h.mock.failNext({ status: 200, body: { resumes: [], pagination: { cursor: 'still-set', limit: 20 } } });
    const output = structured<ListOutput>(await h.call('enhancv_list_resumes'));
    expect(output).toMatchObject({ count: 0, has_more: false, next_cursor: null });
  });

  it('rejects out-of-range input before calling the API', async () => {
    const result = await h.call('enhancv_list_resumes', { limit: 500 }).then(r => r, (e: unknown) => e);
    expect(result instanceof Error || (result as { isError?: boolean }).isError).toBeTruthy();
    expect(h.mock.requests).toHaveLength(0);
  });
});

describe('enhancv_find_resumes', () => {
  it('matches titles and file names case-insensitively', async () => {
    const byTitle = structured<{ matches: { title: string }[]; complete: boolean }>(await h.call('enhancv_find_resumes', { query: 'ARCHITECT' }));
    expect(byTitle.matches.map(match => match.title)).toEqual(['Cloud Architect']);
    expect(byTitle.complete).toBe(true);
    const byFile = structured<{ matches: { title: string }[] }>(await h.call('enhancv_find_resumes', { query: 'priyanair' }));
    expect(byFile.matches.map(match => match.title)).toEqual(['Data Platform Lead']);
  });

  it('spends at most max_pages requests and reports where to continue', async () => {
    const many: FixtureResume[] = Array.from({ length: 230 }, (_, index) => ({
      id: `64f1a2b3c4d5e6f7a8b9${(0x1000 + index).toString(16)}`,
      title: index === 205 ? 'Needle resume' : `Resume ${index}`,
      filename: `r${index}.pdf`,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      data: { header: { name: `Person ${index}` }, sections: {} }
    }));
    const big = await createHarness({ resumes: many });
    try {
      const partial = structured<{ matches: unknown[]; scanned: number; pages_fetched: number; complete: boolean; next_cursor: string | null }>(
        await big.call('enhancv_find_resumes', { query: 'needle', max_pages: 2 })
      );
      expect(partial).toMatchObject({ matches: [], scanned: 200, pages_fetched: 2, complete: false });
      expect(partial.next_cursor).toBeTruthy();
      const full = structured<{ matches: { title: string }[]; scanned: number; complete: boolean }>(await big.call('enhancv_find_resumes', { query: 'needle', max_pages: 5 }));
      expect(full.matches.map(match => match.title)).toEqual(['Needle resume']);
      expect(full).toMatchObject({ scanned: 230, complete: true });
      expect(big.mock.requests.every(request => request.query.limit === '100')).toBe(true);
    } finally {
      await big.close();
    }
  });
});

describe('enhancv_get_resume', () => {
  const id = '64f1a2b3c4d5e6f7a8b9c009';

  it('returns the create-compatible structure as JSON by default', async () => {
    const result = await h.call('enhancv_get_resume', { resume_id: id });
    const output = structured<{ id: string; resume: { header: { name: string }; style: { layout: string } } }>(result);
    expect(output.resume.header.name).toBe('Camille Dupont');
    expect(JSON.parse(textOf(result)).style.layout).toBe('double');
  });

  it('summarizes as markdown on request', async () => {
    const text = textOf(await h.call('enhancv_get_resume', { resume_id: id, response_format: 'markdown' }));
    expect(text).toContain('# Cloud Architect');
    expect(text).toContain('Camille Dupont');
    expect(text).toContain('`experiences`');
    expect(text).toContain('Cloud Architect @ Adventure Works Cloud');
  });

  it('turns an unknown resume into an actionable error', async () => {
    const result = await h.call('enhancv_get_resume', { resume_id: 'doesnotexist' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Resume not found');
    expect(textOf(result)).toContain('enhancv_list_resumes');
  });

  it('truncates oversized text but keeps the structured result complete', async () => {
    const huge = 'x'.repeat(40_000);
    expect(truncateText(huge).truncated).toBe(true);
    expect(truncateText(huge).text).toContain('[Output truncated at 25000 characters');
    expect(truncateText('short')).toEqual({ text: 'short', truncated: false });
  });
});

describe('enhancv_create_resume', () => {
  const input = {
    title: 'Created via MCP',
    header: { name: 'Jane Doe', title: 'Engineer' },
    sections: { summaries: { column: 0, order: 0, name: 'Summary', items: [{ text: 'Hello' }] } },
    style: { layout: 'double', isLetterSize: false }
  };

  it('posts the validated resume and returns the new id', async () => {
    const output = structured<{ id: string }>(await h.call('enhancv_create_resume', input));
    expect(output.id).toMatch(/^64f1a2b3/);
    const request = h.mock.requests.at(-1)!;
    expect(request.method).toBe('POST');
    expect(request.body).toEqual(input);
    expect(h.mock.resumes.get(output.id)?.title).toBe('Created via MCP');
  });

  it('rejects invalid structures without touching the API', async () => {
    const invalid = { ...input, sections: { summaries: { column: 2, items: [] } } };
    const result = await h.call('enhancv_create_resume', invalid).then(r => r, (e: unknown) => e);
    const message = result instanceof Error ? result.message : textOf(result as Awaited<ReturnType<Harness['call']>>);
    expect(message).toContain('multicolumn');
    expect(h.mock.requests).toHaveLength(0);
  });

  it('explains a reached resume limit', async () => {
    const limited = await createHarness({ maxResumes: 12 });
    try {
      const result = await limited.call('enhancv_create_resume', input);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('resume limit');
      expect(textOf(result)).toContain('enhancv_delete_resume');
    } finally {
      await limited.close();
    }
  });
});

describe('enhancv_duplicate_resume', () => {
  it('copies header, sections and style under a new title', async () => {
    const source = '64f1a2b3c4d5e6f7a8b9c005';
    const output = structured<{ id: string; source_id: string }>(await h.call('enhancv_duplicate_resume', { resume_id: source }));
    expect(output.source_id).toBe(source);
    const copy = h.mock.resumes.get(output.id)!;
    expect(copy.title).toBe('Platform Engineer - SRE (copy)');
    const original = h.mock.resumes.get(source)!.data;
    expect((copy.data as { sections: unknown }).sections).toEqual(original.sections);
    expect((copy.data as { header: unknown }).header).toEqual(original.header);
    expect(h.mock.requests.map(request => request.method)).toEqual(['GET', 'POST']);
    const custom = structured<{ id: string }>(await h.call('enhancv_duplicate_resume', { resume_id: source, title: 'Tailored' }));
    expect(h.mock.resumes.get(custom.id)?.title).toBe('Tailored');
  });
});

describe('enhancv_delete_resume', () => {
  const id = '64f1a2b3c4d5e6f7a8b9c00c';

  it('requires explicit confirmation and does not call the API without it', async () => {
    const result = await h.call('enhancv_delete_resume', { resume_id: id }).then(r => r, (e: unknown) => e);
    expect(result instanceof Error || (result as { isError?: boolean }).isError).toBeTruthy();
    const refused = await h.call('enhancv_delete_resume', { resume_id: id, confirm: false }).then(r => r, (e: unknown) => e);
    expect(refused instanceof Error || (refused as { isError?: boolean }).isError).toBeTruthy();
    expect(h.mock.requests).toHaveLength(0);
    expect(h.mock.resumes.has(id)).toBe(true);
  });

  it('deletes after confirmation and then reports 404', async () => {
    expect(structured(await h.call('enhancv_delete_resume', { resume_id: id, confirm: true }))).toEqual({ deleted: true, resume_id: id });
    expect(h.mock.resumes.has(id)).toBe(false);
    const again = await h.call('enhancv_delete_resume', { resume_id: id, confirm: true });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toContain('Resume not found');
  });
});

describe('enhancv_upload_resume', () => {
  const pdfBase64 = Buffer.from('%PDF-1.4 synthetic resume').toString('base64');
  let filesDir: string;
  let withFiles: Harness;

  beforeAll(() => {
    filesDir = realpathSync(mkdtempSync(join(tmpdir(), 'enhancv-tools-')));
    mkdirSync(join(filesDir, 'exports'));
    writeFileSync(join(filesDir, 'cv.pdf'), '%PDF-1.4 from disk');
    writeFileSync(join(filesDir, 'notes.txt'), 'just text');
  });
  afterAll(() => rmSync(filesDir, { recursive: true, force: true }));
  beforeEach(async () => {
    withFiles = await createHarness({ filesDir });
  });
  afterEach(async () => {
    await withFiles.close();
  });

  it('uploads base64 content as multipart and returns the new id', async () => {
    const output = structured<{ id: string; filename: string; bytes: number }>(await h.call('enhancv_upload_resume', { content_base64: pdfBase64, filename: 'jane-doe.pdf' }));
    expect(output).toMatchObject({ filename: 'jane-doe.pdf', bytes: 25 });
    expect(h.mock.requests.at(-1)?.upload).toEqual({ filename: 'jane-doe.pdf', type: 'application/pdf', size: 25 });
    expect(h.mock.resumes.get(output.id)?.title).toBe('jane-doe');
  });

  it('keeps local file access disabled unless ENHANCV_FILES_DIR is set', async () => {
    const result = await h.call('enhancv_upload_resume', { file_path: 'cv.pdf' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('ENHANCV_FILES_DIR');
    expect(h.mock.requests).toHaveLength(0);
  });

  it('reads files below ENHANCV_FILES_DIR and refuses paths outside', async () => {
    const ok = structured<{ filename: string }>(await withFiles.call('enhancv_upload_resume', { file_path: 'cv.pdf' }));
    expect(ok.filename).toBe('cv.pdf');
    for (const bad of ['../etc/passwd', '/etc/passwd']) {
      const result = await withFiles.call('enhancv_upload_resume', { file_path: bad });
      expect(result.isError, bad).toBe(true);
    }
    expect(withFiles.mock.requests).toHaveLength(1);
  });

  it('validates type and content before anything leaves the machine', async () => {
    const wrongType = await withFiles.call('enhancv_upload_resume', { file_path: 'notes.txt' });
    expect(wrongType.isError).toBe(true);
    expect(textOf(wrongType)).toContain('PDF, DOC and DOCX');
    const fake = await withFiles.call('enhancv_upload_resume', { content_base64: Buffer.from('MZ not a pdf').toString('base64'), filename: 'x.pdf' });
    expect(fake.isError).toBe(true);
    expect(withFiles.mock.requests).toHaveLength(0);
  });

  it('requires exactly one source and a filename for base64 content', async () => {
    for (const args of [{}, { file_path: 'a.pdf', content_base64: pdfBase64, filename: 'a.pdf' }, { content_base64: pdfBase64 }]) {
      const result = await withFiles.call('enhancv_upload_resume', args).then(r => r, (e: unknown) => e);
      expect(result instanceof Error || (result as { isError?: boolean }).isError, JSON.stringify(args)).toBeTruthy();
    }
    expect(withFiles.mock.requests).toHaveLength(0);
  });

  describe('enhancv_export_resume_pdf', () => {
    const id = '64f1a2b3c4d5e6f7a8b9c009';

    it('returns the PDF inline as an embedded resource with the suggested file name', async () => {
      const result = await h.call('enhancv_export_resume_pdf', { resume_id: id });
      expect(structured(result)).toMatchObject({ resume_id: id, filename: 'Camille Dupont.pdf', saved_to: null });
      const resource = (result.content as { type: string; resource?: { mimeType: string; blob: string; uri: string } }[]).find(block => block.type === 'resource');
      expect(resource?.resource?.mimeType).toBe('application/pdf');
      expect(Buffer.from(resource!.resource!.blob, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
      expect(resource?.resource?.uri).toBe(`enhancv://export/${id}.pdf`);
    });

    it('writes below ENHANCV_FILES_DIR, refuses to overwrite and refuses paths outside', async () => {
      const saved = structured<{ saved_to: string }>(await withFiles.call('enhancv_export_resume_pdf', { resume_id: id, output_path: 'exports/camille.pdf' }));
      expect(saved.saved_to).toBe('exports/camille.pdf');
      expect(readFileSync(join(filesDir, 'exports', 'camille.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
      const again = await withFiles.call('enhancv_export_resume_pdf', { resume_id: id, output_path: 'exports/camille.pdf' });
      expect(again.isError).toBe(true);
      expect(textOf(again)).toContain('overwrite');
      expect((await withFiles.call('enhancv_export_resume_pdf', { resume_id: id, output_path: 'exports/camille.pdf', overwrite: true })).isError).not.toBe(true);
      expect((await withFiles.call('enhancv_export_resume_pdf', { resume_id: id, output_path: '../escape.pdf' })).isError).toBe(true);
    });

    it('does not call the API when the output path is rejected', async () => {
      const result = await h.call('enhancv_export_resume_pdf', { resume_id: id, output_path: 'x.pdf' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('ENHANCV_FILES_DIR');
      expect(h.mock.requests).toHaveLength(0);
    });
  });
});

describe('API failures', () => {
  it('explains authentication problems and a nearly exhausted rate limit', async () => {
    h.mock.failNext({ status: 401, body: { error: 'Invalid API key' } });
    const unauthorized = await h.call('enhancv_list_resumes');
    expect(unauthorized.isError).toBe(true);
    expect(textOf(unauthorized)).toContain('ENHANCV_API_KEY');

    h.mock.failNext({ status: 429, body: { error: 'Rate limit exceeded. Please try again later.', retryAfter: 600 } });
    const limited = await h.call('enhancv_list_resumes');
    expect(limited.isError).toBe(true);
    expect(textOf(limited)).toContain('Retry after 600 seconds');
    expect(h.mock.requests).toHaveLength(2);
  });

  it('adds a note when few requests remain', () => {
    expect(rateLimitNote({ rateLimit: { remaining: 3, limit: 60, resetAt: '2024-01-01T00:00:00.000Z' } })).toContain('only 3 of 60');
    expect(rateLimitNote({ rateLimit: { remaining: 40, limit: 60 } })).toBe('');
    expect(rateLimitNote({ rateLimit: {} })).toBe('');
  });
});
