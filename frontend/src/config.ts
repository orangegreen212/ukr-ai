/**
 * Centralised API configuration. The base URL is configurable via the
 * `VITE_API_BASE_URL` environment variable and defaults to the local backend.
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://127.0.0.1:8000';

/** Per-request timeout guidance (milliseconds). */
export const TIMEOUTS = {
  health: 15_000,
  articles: 30_000,
  articleDetail: 20_000,
  analysis: 180_000, // local models can take over a minute to warm up
} as const;
