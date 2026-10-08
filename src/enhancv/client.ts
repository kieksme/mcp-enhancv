import * as z from 'zod/v4';
import {
  API_KEY_PREFIX,
  DEFAULT_API_HOST,
  DEFAULT_API_URL,
  DEFAULT_MAX_RETRY_WAIT_MS,
  TIMEOUTS
} from '../constants.js';
import { VERSION } from '../version.js';
import { EnhancvError, hintFor, redact } from './errors.js';

type Fetcher = typeof fetch;
type Sleep = (ms: number) => Promise<void>;

export type RateLimitInfo = { limit?: number; remaining?: number; resetAt?: string };
export type ResponseMeta = { requestId?: string; rateLimit: RateLimitInfo };
export type ApiResult<T> = { data: T; meta: ResponseMeta };

export type ResumeSummary = {
  id: string;
  title?: string;
  filename?: string;
  createdAt?: string;
  updatedAt?: string;
};
export type ResumeList = { resumes: ResumeSummary[]; pagination: { cursor: string | null; limit: number } };
/** A resume in the "analyzer format": identical for retrieve and create. */
export type ResumeData = Record<string, unknown>;

export type ClientOptions = {
  baseUrl?: string;
  fetcher?: Fetcher;
  /** Longest single wait for a 429 retry; a longer wait is reported as an error instead. */
  maxRetryWaitMs?: number;
  /** Replaceable for tests. */
  sleep?: Sleep;
};

/** Resume IDs are opaque strings (ObjectId-like). Anything else must never reach a URL path. */
export const RESUME_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_SERVER_RETRIES = 1;

const listResponseSchema = z.object({
  resumes: z.array(z.object({ id: z.string() }).loose()),
  pagination: z.object({ cursor: z.string().nullable().optional(), limit: z.number().optional() }).loose().optional()
}).loose();
const idResponseSchema = z.object({ id: z.string().min(1) }).loose();

type RequestSpec = {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  form?: FormData;
  timeoutMs?: number;
};

type ErrorBody = { message?: string; retryAfter?: number; requestId?: string };

export class EnhancvClient {
  private readonly baseUrl: URL;
  private readonly fetcher: Fetcher;
  private readonly maxRetryWaitMs: number;
  private readonly sleep: Sleep;

  constructor(private readonly apiKey: string, options: ClientOptions = {}) {
    if (!apiKey.trim()) throw new Error('ENHANCV_API_KEY is required');
    const baseUrl = options.baseUrl ?? DEFAULT_API_URL;
    this.baseUrl = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(this.baseUrl.hostname);
    if (this.baseUrl.protocol !== 'https:' && !local) {
      throw new Error('ENHANCV_API_URL must use HTTPS outside localhost');
    }
    if (this.baseUrl.username || this.baseUrl.password || this.baseUrl.search || this.baseUrl.hash) {
      throw new Error('ENHANCV_API_URL must not contain credentials, query or fragment');
    }
    if (this.baseUrl.hostname === DEFAULT_API_HOST && !apiKey.startsWith(API_KEY_PREFIX)) {
      throw new Error(`ENHANCV_API_KEY must start with "${API_KEY_PREFIX}" (Account Settings > Profile > API Keys)`);
    }
    this.fetcher = options.fetcher ?? fetch;
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  /** `GET /resumes` - cursor pagination, `limit` 1-100. */
  async listResumes(params: { cursor?: string; limit?: number } = {}): Promise<ApiResult<ResumeList>> {
    const limit = params.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100');
    const { response, meta } = await this.request({ method: 'GET', path: 'resumes', query: { limit, cursor: params.cursor } });
    const body = await this.readJson(response);
    const parsed = listResponseSchema.safeParse(body);
    if (!parsed.success) throw this.invalidResponse('the resume list had an unexpected shape', meta);
    const resumes = parsed.data.resumes as ResumeSummary[];
    return {
      data: { resumes, pagination: { cursor: parsed.data.pagination?.cursor ?? null, limit: parsed.data.pagination?.limit ?? limit } },
      meta
    };
  }

  /** `GET /resumes/{id}` - complete resume in create-compatible format. */
  async getResume(id: string): Promise<ApiResult<ResumeData>> {
    const { response, meta } = await this.request({ method: 'GET', path: `resumes/${this.resumeId(id)}` });
    const body = await this.readJson(response);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw this.invalidResponse('the resume had an unexpected shape', meta);
    }
    return { data: body as ResumeData, meta };
  }

  /** `POST /resumes` - create a resume from structured data (201). */
  async createResume(resume: Record<string, unknown>): Promise<ApiResult<{ id: string }>> {
    const { response, meta } = await this.request({ method: 'POST', path: 'resumes', json: resume });
    return { data: this.parseId(await this.readJson(response), meta), meta };
  }

  /** `POST /resumes/upload` - parse a PDF/DOC/DOCX into a new resume (multipart, slow). */
  async uploadResume(file: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<ApiResult<{ id: string }>> {
    const form = new FormData();
    form.append('file', new Blob([file.bytes as BlobPart], { type: file.mimeType }), file.filename);
    const { response, meta } = await this.request({ method: 'POST', path: 'resumes/upload', form, timeoutMs: TIMEOUTS.upload });
    return { data: this.parseId(await this.readJson(response), meta), meta };
  }

  /** `GET /resumes/{id}/pdf` - raw PDF bytes (5-15 s). */
  async exportPdf(id: string): Promise<ApiResult<{ bytes: Uint8Array; filename?: string }>> {
    const { response, meta } = await this.request({ method: 'GET', path: `resumes/${this.resumeId(id)}/pdf`, timeoutMs: TIMEOUTS.pdf });
    const bytes = await this.readBytes(response, TIMEOUTS.pdf);
    const header = new TextDecoder().decode(bytes.subarray(0, 8));
    if (!header.startsWith('%PDF-')) throw this.invalidResponse('the export was not a PDF', meta);
    return { data: { bytes, filename: parseFilename(response.headers.get('content-disposition')) }, meta };
  }

  /** `DELETE /resumes/{id}` - permanent. */
  async deleteResume(id: string): Promise<ApiResult<{ success: boolean }>> {
    const { response, meta } = await this.request({ method: 'DELETE', path: `resumes/${this.resumeId(id)}` });
    const body = await this.readJson(response);
    const success = typeof body === 'object' && body !== null && (body as { success?: unknown }).success === true;
    return { data: { success }, meta };
  }

  private resumeId(id: string): string {
    if (!RESUME_ID_PATTERN.test(id)) throw new Error('resume_id must be an Enhancv resume ID (letters, digits, "-" or "_")');
    return encodeURIComponent(id);
  }

  private parseId(body: unknown, meta: ResponseMeta): { id: string } {
    const parsed = idResponseSchema.safeParse(body);
    if (!parsed.success) throw this.invalidResponse('the response did not contain a resume id', meta);
    return { id: parsed.data.id };
  }

  /** Read a response body; a timeout while the body is still streaming is reported like a request timeout. */
  private async readBytes(response: Response, timeoutMs: number): Promise<Uint8Array> {
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      throw this.transportError(error, timeoutMs);
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    let text: string;
    try {
      text = new TextDecoder().decode(await this.readBytes(response, TIMEOUTS.upload));
    } catch (error) {
      throw error instanceof EnhancvError ? error : this.transportError(error, TIMEOUTS.default);
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new EnhancvError('Enhancv returned a response that is not valid JSON.', response.status, 'invalid_response', response.headers.get('x-request-id') ?? undefined);
    }
  }

  private invalidResponse(what: string, meta: ResponseMeta): EnhancvError {
    return new EnhancvError(`Unexpected Enhancv response: ${what}. The API may have changed; please report it with the request ID.`, 502, 'invalid_response', meta.requestId);
  }

  private async request(spec: RequestSpec): Promise<{ response: Response; meta: ResponseMeta }> {
    const url = new URL(spec.path, this.baseUrl);
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const timeoutMs = spec.timeoutMs ?? TIMEOUTS.default;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': `enhancv-mcp/${VERSION}`,
      ...(spec.json !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {})
    };
    let rateLimitRetries = 0;
    let serverRetries = 0;

    for (;;) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: spec.method,
          headers,
          ...(spec.json !== undefined ? { body: JSON.stringify(spec.json) } : {}),
          ...(spec.form ? { body: spec.form } : {}),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        throw this.transportError(error, timeoutMs);
      }
      const meta = readMeta(response);
      if (response.ok) return { response, meta };

      const body = await this.readErrorBody(response);
      const retryAfterSeconds = body.retryAfter ?? parseSeconds(response.headers.get('retry-after'));

      if (response.status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
        // Documented backoff: retryAfter * 2^attempt. Longer waits are reported instead of blocking the tool call.
        const waitMs = (retryAfterSeconds ?? 60) * 1000 * 2 ** rateLimitRetries;
        if (waitMs <= this.maxRetryWaitMs) {
          rateLimitRetries++;
          await this.sleep(waitMs);
          continue;
        }
      }
      // Only GET is retried on server errors: a repeated POST could create a duplicate resume.
      if (spec.method === 'GET' && [500, 502, 504].includes(response.status) && serverRetries < MAX_SERVER_RETRIES) {
        serverRetries++;
        await this.sleep(Math.min(1000 * 2 ** serverRetries, this.maxRetryWaitMs));
        continue;
      }
      throw this.apiError(response.status, body, meta, retryAfterSeconds);
    }
  }

  private async readErrorBody(response: Response): Promise<ErrorBody> {
    const text = await response.text().catch(() => '');
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        const message = typeof record.error === 'string' ? record.error : typeof record.message === 'string' ? record.message : undefined;
        return {
          message,
          retryAfter: typeof record.retryAfter === 'number' ? record.retryAfter : undefined,
          requestId: typeof record.requestId === 'string' ? record.requestId : undefined
        };
      }
    } catch {
      /* not JSON - fall through to a short text excerpt */
    }
    return { message: text.slice(0, 200) || undefined };
  }

  private apiError(status: number, body: ErrorBody, meta: ResponseMeta, retryAfterSeconds?: number): EnhancvError {
    const requestId = body.requestId ?? meta.requestId;
    const apiMessage = redact(body.message ?? `HTTP ${status}`, this.apiKey);
    const hint = hintFor(status, apiMessage, retryAfterSeconds);
    const parts = [`Enhancv API ${status}: ${apiMessage}.`, hint, requestId ? `Request ID: ${requestId}.` : ''].filter(Boolean);
    return new EnhancvError(parts.join(' '), status, 'api', requestId, retryAfterSeconds);
  }

  private transportError(error: unknown, timeoutMs: number): EnhancvError {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return new EnhancvError(
        `The request to Enhancv timed out after ${Math.round(timeoutMs / 1000)} s. Uploads and PDF exports take 10-20 s; retry once, and check the Enhancv status if it keeps failing.`,
        0,
        'timeout'
      );
    }
    const detail = redact(error instanceof Error ? error.message : 'unknown error', this.apiKey);
    return new EnhancvError(`Could not reach Enhancv (${detail}). Check the network connection and ENHANCV_API_URL.`, 0, 'network');
  }
}

function readMeta(response: Response): ResponseMeta {
  const num = (name: string): number | undefined => {
    const raw = response.headers.get(name);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const reset = num('x-ratelimit-reset');
  return {
    requestId: response.headers.get('x-request-id') ?? undefined,
    rateLimit: {
      limit: num('x-ratelimit-limit'),
      remaining: num('x-ratelimit-remaining'),
      resetAt: reset === undefined ? undefined : new Date(reset * 1000).toISOString()
    }
  };
}

function parseSeconds(value: string | null): number | undefined {
  const seconds = value === null ? Number.NaN : Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Extract a safe download name from `Content-Disposition` (plain or RFC 5987 form). */
export function parseFilename(header: string | null): string | undefined {
  if (!header) return undefined;
  const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1];
  const plain = /filename\s*=\s*"([^"]*)"/.exec(header)?.[1] ?? /filename\s*=\s*([^;]+)/.exec(header)?.[1];
  let name = plain?.trim();
  if (encoded) {
    try {
      name = decodeURIComponent(encoded.trim());
    } catch {
      /* keep the plain value */
    }
  }
  if (!name) return undefined;
  // eslint-disable-next-line no-control-regex
  const safe = name.replace(/[\\/\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 200);
  return safe || undefined;
}
