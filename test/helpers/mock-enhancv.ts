/**
 * In-process mock of the Enhancv API (https://developers.enhancv.com) for tests, evaluations and manual
 * runs (`pnpm mock:api`). Behaviour follows the documentation: cursor pagination sorted by ID, `{ error, status,
 * requestId }` error bodies, 201 on create, 200 on upload, Content-Disposition on PDF export, X-RateLimit headers.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FIXTURE_RESUMES, type FixtureResume } from '../../evaluations/fixtures.js';

export const MOCK_API_KEY = 'enh_live_mock_key_for_tests';

export type RecordedRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: IncomingMessage['headers'];
  body?: unknown;
  upload?: { filename: string; type: string; size: number };
};

export type InjectedFailure = { status: number; body?: Record<string, unknown>; headers?: Record<string, string> };

export type MockOptions = {
  resumes?: FixtureResume[];
  apiKey?: string;
  /** Plan limit for stored resumes (create/upload answer 403 beyond it). */
  maxResumes?: number;
  /** Fixed port instead of a random free one (manual runs). */
  port?: number;
};

export type MockEnhancv = {
  /** Base URL to pass as ENHANCV_API_URL, including `/api/v1`. */
  url: string;
  requests: RecordedRequest[];
  resumes: Map<string, FixtureResume>;
  /** The next request(s) fail with the given response before normal handling. */
  failNext: (...failures: InjectedFailure[]) => void;
  close: () => Promise<void>;
};

const MIN_PDF = (title: string) => Buffer.from(`%PDF-1.4\n% mock export of ${title}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);

export async function startMockEnhancv(options: MockOptions = {}): Promise<MockEnhancv> {
  const apiKey = options.apiKey ?? MOCK_API_KEY;
  const store = new Map<string, FixtureResume>((options.resumes ?? FIXTURE_RESUMES).map(resume => [resume.id, structuredClone(resume)]));
  const requests: RecordedRequest[] = [];
  const failures: InjectedFailure[] = [];
  let counter = 0;
  let nextId = 0x100;

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk as Buffer));
    request.on('end', () => {
      void handle(request, Buffer.concat(chunks)).catch(error => {
        send(500, { error: `mock failure: ${String(error)}` });
      });
    });

    const requestId = `req_mock_${++counter}`;
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
      response.writeHead(status, {
        'Content-Type': typeof body === 'string' || Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json',
        'X-Request-Id': requestId,
        'X-RateLimit-Limit': '60',
        'X-RateLimit-Remaining': String(Math.max(0, 60 - counter)),
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
        ...headers
      });
      response.end(payload);
    };
    const error = (status: number, message: string, extra: Record<string, unknown> = {}) => send(status, { error: message, status, requestId, ...extra });

    async function handle(req: IncomingMessage, body: Buffer): Promise<void> {
      const url = new URL(req.url ?? '/', 'http://mock');
      const record: RecordedRequest = { method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers };
      requests.push(record);

      const injected = failures.shift();
      if (injected) {
        send(injected.status, JSON.stringify({ status: injected.status, requestId, ...(injected.body ?? { error: 'injected failure' }) }), {
          'Content-Type': 'application/json',
          ...injected.headers
        });
        return;
      }

      const auth = req.headers.authorization;
      if (!auth) return error(401, 'Missing Authorization header');
      if (auth !== `Bearer ${apiKey}`) return error(401, 'Invalid API key');

      const match = /^\/api\/v1\/resumes(?:\/([^/]+?))?(\/pdf)?$/.exec(url.pathname);
      if (!match) return error(404, 'Not found');
      const [, idOrUpload, pdf] = match;

      if (!idOrUpload) {
        if (req.method === 'GET') {
          const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 100);
          const cursor = url.searchParams.get('cursor');
          const sorted = [...store.values()].sort((a, b) => a.id.localeCompare(b.id));
          const rest = cursor ? sorted.filter(resume => resume.id > cursor) : sorted;
          const page = rest.slice(0, limit);
          const more = rest.length > page.length;
          return send(200, {
            resumes: page.map(({ id, title, filename, createdAt, updatedAt }) => ({ id, title, filename, createdAt, updatedAt })),
            pagination: { cursor: more ? (page.at(-1)?.id ?? null) : null, limit }
          });
        }
        if (req.method === 'POST') {
          const parsed = parseJson(body);
          record.body = parsed;
          if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { header?: unknown }).header !== 'object') {
            return error(400, 'Missing required field: header (must be an object)');
          }
          if (typeof (parsed as { sections?: unknown }).sections !== 'object') return error(400, 'Missing required field: sections (must be an object)');
          if (options.maxResumes !== undefined && store.size >= options.maxResumes) {
            return error(403, `Maximum resume limit reached. Your plan allows ${options.maxResumes} resumes`);
          }
          const created = add(parsed as Record<string, unknown>);
          return send(201, { id: created });
        }
        return error(404, 'Not found');
      }

      if (idOrUpload === 'upload' && req.method === 'POST') {
        const form = await new Response(new Uint8Array(body), { headers: { 'content-type': req.headers['content-type'] ?? '' } }).formData().catch(() => undefined);
        const file = form?.get('file');
        if (!(file instanceof File)) return error(400, 'No file uploaded');
        record.upload = { filename: file.name, type: file.type, size: file.size };
        if (file.size > 10 * 1024 * 1024) return error(400, 'File size exceeds 10MB');
        if (!/\.(pdf|docx?)$/i.test(file.name)) return error(400, 'Invalid file type. Only PDF, DOC, and DOCX are allowed');
        if (options.maxResumes !== undefined && store.size >= options.maxResumes) return error(403, 'Maximum resume limit reached');
        const created = add({ title: file.name.replace(/\.[^.]+$/, ''), header: { name: 'Parsed Person' }, sections: {} });
        return send(200, { id: created });
      }

      const stored = store.get(idOrUpload);
      if (!stored) return error(404, 'Resume not found');

      if (pdf && req.method === 'GET') {
        const name = (stored.data.header as { name?: string } | undefined)?.name ?? 'resume';
        return send(200, MIN_PDF(stored.title), {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${name}.pdf"`
        });
      }
      if (req.method === 'GET') return send(200, stored.data);
      if (req.method === 'DELETE') {
        store.delete(idOrUpload);
        return send(200, { success: true });
      }
      return error(404, 'Not found');
    }

    function add(data: Record<string, unknown>): string {
      const id = `64f1a2b3c4d5e6f7a8b9c${(nextId++).toString(16).padStart(3, '0')}`;
      const now = new Date().toISOString();
      const title = typeof data.title === 'string' ? data.title : 'New Resume';
      store.set(id, { id, title, filename: `${title}.pdf`, createdAt: now, updatedAt: now, data });
      return id;
    }
  });

  await new Promise<void>(resolve => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    requests,
    resumes: store,
    failNext: (...next) => {
      failures.push(...next);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })
  };
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
}
