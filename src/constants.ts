/** Production base URL of the Enhancv API (https://developers.enhancv.com). */
export const DEFAULT_API_URL = 'https://api.enhancv.com/api/v1';

/** Host for which the `enh_live_` key prefix is enforced locally. */
export const DEFAULT_API_HOST = 'api.enhancv.com';

/** Documented prefix of every Enhancv API key. */
export const API_KEY_PREFIX = 'enh_live_';

/** Maximum size of an uploaded resume file accepted by Enhancv. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Largest PDF returned inline as a base64 embedded resource; larger exports must be written to a file. */
export const MAX_INLINE_PDF_BYTES = 5 * 1024 * 1024;

/** Largest HTTP request body of the MCP endpoint: a 10 MB upload as base64 plus JSON overhead. */
export const MAX_HTTP_BODY_BYTES = 16 * 1024 * 1024;

/** Maximum number of characters of a text tool result before it is truncated. */
export const CHARACTER_LIMIT = 25_000;

/** Request timeouts in milliseconds (PDF generation and upload parsing are slow by design). */
export const TIMEOUTS = {
  default: 30_000,
  upload: 60_000,
  pdf: 90_000
} as const;

/** Default upper bound for a single rate-limit wait before the error is surfaced instead. */
export const DEFAULT_MAX_RETRY_WAIT_MS = 30_000;

/** Documented per-key rate limits, used in hints only. */
export const RATE_LIMIT_SUMMARY = '60 requests/minute, 1,000/hour, 10,000/day per API key';
