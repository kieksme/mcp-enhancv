import { describe, expect, it, vi } from 'vitest';
import { EnhancvClient, parseFilename } from '../src/enhancv/client.js';
import { EnhancvError } from '../src/enhancv/errors.js';

const KEY = 'enh_live_unit_test_key';
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) }, ...init });

function make(responses: Response[] | ((call: number) => Response), options: { maxRetryWaitMs?: number } = {}) {
  let call = 0;
  const fetcher = vi.fn(async (_url: URL | string, _init?: RequestInit) => {
    const index = call++;
    return typeof responses === 'function' ? responses(index) : (responses[index] ?? responses.at(-1)!);
  });
  const sleep = vi.fn(async (_ms: number) => undefined);
  const client = new EnhancvClient(KEY, { fetcher: fetcher as unknown as typeof fetch, sleep, ...options });
  return { client, fetcher, sleep };
}

const lastCall = (fetcher: ReturnType<typeof make>['fetcher'], index = 0) => {
  const [url, init] = fetcher.mock.calls[index] as unknown as [URL, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
};

describe('EnhancvClient construction', () => {
  it('requires a key, HTTPS outside localhost and a clean URL', () => {
    expect(() => new EnhancvClient('  ')).toThrow('ENHANCV_API_KEY is required');
    expect(() => new EnhancvClient(KEY, { baseUrl: 'http://api.example.com/v1' })).toThrow('HTTPS');
    expect(() => new EnhancvClient(KEY, { baseUrl: 'https://user:pw@api.example.com/v1' })).toThrow('credentials');
    expect(() => new EnhancvClient(KEY, { baseUrl: 'https://api.example.com/v1?x=1' })).toThrow('credentials, query or fragment');
    expect(() => new EnhancvClient(KEY, { baseUrl: 'http://127.0.0.1:9999/api/v1' })).not.toThrow();
  });

  it('enforces the documented enh_live_ prefix only for the production host', () => {
    expect(() => new EnhancvClient('wrong-key')).toThrow('enh_live_');
    expect(() => new EnhancvClient('anything', { baseUrl: 'http://localhost:1/api/v1' })).not.toThrow();
  });
});

describe('EnhancvClient requests', () => {
  it('lists resumes with bearer auth, limit and cursor', async () => {
    const { client, fetcher } = make([
      json(
        { resumes: [{ id: 'a1', title: 'One', filename: 'One.pdf', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z' }], pagination: { cursor: 'a1', limit: 10 } },
        { headers: { 'X-Request-Id': 'req_1', 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '58', 'X-RateLimit-Reset': '1640000000' } }
      )
    ]);
    const { data, meta } = await client.listResumes({ cursor: 'zz', limit: 10 });
    expect(data.resumes[0]?.title).toBe('One');
    expect(data.pagination).toEqual({ cursor: 'a1', limit: 10 });
    expect(meta).toEqual({ requestId: 'req_1', rateLimit: { limit: 60, remaining: 58, resetAt: '2021-12-20T11:33:20.000Z' } });
    const { url, headers, init } = lastCall(fetcher);
    expect(url.pathname).toBe('/api/v1/resumes');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('cursor')).toBe('zz');
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers['User-Agent']).toMatch(/^enhancv-mcp\//);
    expect(init.method).toBe('GET');
  });

  it('treats a missing cursor as the end of the list and rejects an invalid limit', async () => {
    const { client } = make([json({ resumes: [] })]);
    expect((await client.listResumes()).data.pagination.cursor).toBeNull();
    await expect(client.listResumes({ limit: 101 })).rejects.toThrow('1 to 100');
    await expect(client.listResumes({ limit: 0 })).rejects.toThrow('1 to 100');
  });

  it('rejects an unexpected list shape instead of passing garbage on', async () => {
    const { client } = make([json({ items: [] })]);
    await expect(client.listResumes()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('never lets a resume id escape the URL path', async () => {
    const { client, fetcher } = make([json({ header: {}, sections: {} })]);
    await expect(client.getResume('../../account')).rejects.toThrow('resume_id');
    await expect(client.getResume('a/b')).rejects.toThrow('resume_id');
    await client.getResume('64f1a2b3c4d5e6f7a8b9c001');
    expect(lastCall(fetcher).url.pathname).toBe('/api/v1/resumes/64f1a2b3c4d5e6f7a8b9c001');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('creates a resume with a JSON body and returns the id', async () => {
    const { client, fetcher } = make([json({ id: 'new1' }, { status: 201 })]);
    const { data } = await client.createResume({ header: { name: 'Jane' }, sections: {} });
    expect(data).toEqual({ id: 'new1' });
    const { init, headers } = lastCall(fetcher);
    expect(init.method).toBe('POST');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ header: { name: 'Jane' }, sections: {} });
  });

  it('uploads a file as multipart form data without forcing a content type', async () => {
    const { client, fetcher } = make([json({ id: 'up1' })]);
    await client.uploadResume({ filename: 'cv.pdf', mimeType: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4 test') });
    const { init, headers, url } = lastCall(fetcher);
    expect(url.pathname).toBe('/api/v1/resumes/upload');
    expect(headers['Content-Type']).toBeUndefined();
    const file = (init.body as FormData).get('file') as File;
    expect(file.name).toBe('cv.pdf');
    expect(file.type).toBe('application/pdf');
    expect(file.size).toBe(13);
  });

  it('exports a PDF and reads the suggested file name', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4 content');
    const { client } = make([new Response(pdf, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="John Doe.pdf"' } })]);
    const { data } = await client.exportPdf('a1');
    expect(data.filename).toBe('John Doe.pdf');
    expect(data.bytes.byteLength).toBe(pdf.byteLength);
  });

  it('rejects an export that is not a PDF', async () => {
    const { client } = make([new Response('<html>oops</html>', { status: 200 })]);
    await expect(client.exportPdf('a1')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('deletes a resume and reports success', async () => {
    const { client, fetcher } = make([json({ success: true })]);
    expect((await client.deleteResume('a1')).data.success).toBe(true);
    expect(lastCall(fetcher).init.method).toBe('DELETE');
  });
});

describe('EnhancvClient error handling', () => {
  const error = (status: number, message: string, extra: Record<string, unknown> = {}) =>
    json({ error: message, status, requestId: 'req_err', ...extra }, { status });

  it.each([
    [401, 'Invalid API key', 'enh_live_'],
    [403, 'API access requires a business plan', 'Business Plus'],
    [403, 'Maximum resume limit reached. Your plan allows 5 resumes', 'resume limit'],
    [404, 'Resume not found', 'enhancv_list_resumes'],
    [400, 'Missing required field: header (must be an object)', 'resume-structure']
  ])('maps %i "%s" to an actionable error', async (status, message, hint) => {
    const { client } = make([error(status, message)]);
    const failure = await client.getResume('a1').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(EnhancvError);
    expect((failure as EnhancvError).status).toBe(status);
    expect((failure as EnhancvError).message).toContain(message);
    expect((failure as EnhancvError).message).toContain(hint);
    expect((failure as EnhancvError).requestId).toBe('req_err');
    expect((failure as EnhancvError).message).toContain('Request ID: req_err');
  });

  it('redacts the API key if the server echoes it', async () => {
    const { client } = make([error(400, `bad token ${KEY}`)]);
    const failure = (await client.getResume('a1').catch((e: unknown) => e)) as EnhancvError;
    expect(failure.message).toContain('[redacted]');
    expect(failure.message).not.toContain(KEY);
  });

  it('keeps a short excerpt of non-JSON error bodies', async () => {
    const { client } = make([new Response('<html>Bad gateway</html>', { status: 502 })]);
    const failure = (await client.deleteResume('a1').catch((e: unknown) => e)) as EnhancvError;
    expect(failure.status).toBe(502);
    expect(failure.message).toContain('Bad gateway');
  });

  it('reports a timeout that happens while the response body is still streaming', async () => {
    const stalled = new Response(new ReadableStream({ pull: controller => controller.error(new DOMException('timed out', 'TimeoutError')) }), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' }
    });
    const { client } = make([stalled]);
    await expect(client.exportPdf('a1')).rejects.toMatchObject({ code: 'timeout', status: 0 });
  });

  it('names the timeout of the request when a JSON body stalls', async () => {
    const stall = () =>
      new Response(new ReadableStream({ pull: controller => controller.error(new DOMException('timed out', 'TimeoutError')) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    const { client } = make([stall(), stall()]);
    await expect(client.listResumes()).rejects.toMatchObject({ code: 'timeout', message: expect.stringContaining('after 30 s') });
    await expect(client.uploadResume({ filename: 'cv.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1]) })).rejects.toMatchObject({
      code: 'timeout',
      message: expect.stringContaining('after 60 s')
    });
  });

  it('maps timeouts and network failures without leaking details of the key', async () => {
    const timeout = new EnhancvClient(KEY, { fetcher: (async () => { throw new DOMException('timed out', 'TimeoutError'); }) as unknown as typeof fetch });
    await expect(timeout.getResume('a1')).rejects.toMatchObject({ code: 'timeout', status: 0 });
    const network = new EnhancvClient(KEY, { fetcher: (async () => { throw new TypeError(`connect failed for ${KEY}`); }) as unknown as typeof fetch });
    const failure = (await network.getResume('a1').catch((e: unknown) => e)) as EnhancvError;
    expect(failure.code).toBe('network');
    expect(failure.message).not.toContain(KEY);
  });
});

describe('EnhancvClient retries', () => {
  const limited = (retryAfter: number) => json({ error: 'Rate limit exceeded. Please try again later.', status: 429, retryAfter, requestId: 'req_rl' }, { status: 429 });

  it('waits retryAfter seconds on 429 and then succeeds', async () => {
    const { client, sleep, fetcher } = make([limited(2), json({ resumes: [], pagination: { cursor: null, limit: 20 } })]);
    await client.listResumes();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('doubles the wait for repeated 429 responses and gives up after three retries', async () => {
    const { client, sleep, fetcher } = make(() => limited(1));
    const failure = (await client.listResumes().catch((e: unknown) => e)) as EnhancvError;
    expect(failure.status).toBe(429);
    expect(failure.retryAfterSeconds).toBe(1);
    expect(sleep.mock.calls.map(call => call[0])).toEqual([1000, 2000, 4000]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('reports a long wait instead of blocking the tool call', async () => {
    const { client, sleep, fetcher } = make([limited(120)], { maxRetryWaitMs: 30_000 });
    const failure = (await client.listResumes().catch((e: unknown) => e)) as EnhancvError;
    expect(failure.message).toContain('Retry after 120 seconds');
    expect(sleep).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries a GET once on 504 but never repeats a POST on a server error', async () => {
    const gateway = () => json({ error: 'PDF generation timeout. Please try again later.', status: 504 }, { status: 504 });
    const get = make([gateway(), json({ header: {}, sections: {} })]);
    await get.client.getResume('a1');
    expect(get.fetcher).toHaveBeenCalledTimes(2);

    const gaveUp = make(() => gateway());
    await expect(gaveUp.client.getResume('a1')).rejects.toMatchObject({ status: 504 });
    expect(gaveUp.fetcher).toHaveBeenCalledTimes(2);

    const post = make(() => json({ error: 'Internal server error', status: 500 }, { status: 500 }));
    await expect(post.client.createResume({ header: {}, sections: {} })).rejects.toMatchObject({ status: 500 });
    expect(post.fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('parseFilename', () => {
  it('reads quoted, unquoted and RFC 5987 names and strips path characters', () => {
    expect(parseFilename('attachment; filename="John Doe.pdf"')).toBe('John Doe.pdf');
    expect(parseFilename('attachment; filename=resume.pdf')).toBe('resume.pdf');
    expect(parseFilename("attachment; filename*=UTF-8''Jos%C3%A9%20Garc%C3%ADa.pdf")).toBe('José García.pdf');
    expect(parseFilename('attachment; filename="../../etc/passwd"')).toBe('_.._etc_passwd');
    expect(parseFilename(null)).toBeUndefined();
    expect(parseFilename('attachment')).toBeUndefined();
  });
});
