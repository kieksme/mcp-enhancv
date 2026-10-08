import { RATE_LIMIT_SUMMARY } from '../constants.js';

export type EnhancvErrorCode = 'api' | 'timeout' | 'network' | 'invalid_response';

/** An error from the Enhancv API (or the network path to it) with an actionable, secret-free message. */
export class EnhancvError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: EnhancvErrorCode = 'api',
    public readonly requestId?: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'EnhancvError';
  }
}

/** Replace every occurrence of a secret in a text. */
export function redact(text: string, secret: string): string {
  return secret ? text.replaceAll(secret, '[redacted]') : text;
}

/** Next-step hint for an API error, derived from the documented status codes and messages. */
export function hintFor(status: number, apiMessage: string, retryAfterSeconds?: number): string {
  switch (status) {
    case 400:
      return 'Check the input against the enhancv://reference/resume-structure resource.';
    case 401:
      return 'Check ENHANCV_API_KEY: it must be an Enhancv API key starting with "enh_live_" (Account Settings > Profile > API Keys). Deleted keys are rejected.';
    case 403:
      if (/resume limit/i.test(apiMessage)) {
        return 'The resume limit of the plan is reached. Delete unused resumes with enhancv_delete_resume or upgrade the plan. Uploads and created resumes both count.';
      }
      return 'API access requires an Enhancv Business Plus plan with API keys enabled.';
    case 404:
      return 'The resume does not exist or belongs to another account. Get valid IDs from enhancv_list_resumes.';
    case 429:
      return `Rate limit exceeded (${RATE_LIMIT_SUMMARY}). Retry after ${retryAfterSeconds ?? 60} seconds and avoid bulk calls.`;
    case 502:
    case 504:
      return 'The upstream step timed out or failed. Retry shortly; PDF exports are cached per resume content, so a retry is usually faster.';
    default:
      return status >= 500
        ? 'Enhancv reported a server error. Retry later and quote the request ID when contacting support@enhancv.com.'
        : '';
  }
}
