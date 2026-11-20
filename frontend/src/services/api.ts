import type {
  AnalysisResponse,
  ApiErrorBody,
  AppModePayload,
  Article,
  ArticlesResponse,
  FrequentEntitiesResponse,
  HealthPayload,
  SentimentDistributionResponse,
} from '@/types/api';
import { API_BASE_URL, TIMEOUTS } from '@/config';

/**
 * Verified static error codes of the backend envelope (app/api/errors.py and
 * the endpoint modules). Codes outside this map fall back to a generic
 * phrase — never exception text, stack traces, or repr'd objects.
 */
const ERROR_CODE_MESSAGES: Record<string, string> = {
  article_not_found: 'That article is not available on the backend.',
  not_found: 'The requested resource was not found on the backend.',
  method_not_allowed: 'The backend does not support this request method.',
  validation_error: 'The backend rejected this request as invalid.',
  no_input: 'Provide an article or text to analyze.',
  ambiguous_input: 'Provide either an article or text, not both.',
  internal_error: 'The backend reported an internal error.',
};

function friendlyErrorMessage(status: number, parsed: unknown): string {
  // Preferred path: the fixed error envelope {"error": {code, message, ...}}.
  if (
    parsed &&
    typeof parsed === 'object' &&
    'error' in parsed &&
    typeof (parsed as ApiErrorBody).error === 'object' &&
    (parsed as ApiErrorBody).error !== null
  ) {
    const body = parsed as ApiErrorBody;
    const mapped = ERROR_CODE_MESSAGES[body.error.code];
    let message = mapped ?? body.error.message;
    if (
      typeof message !== 'string' ||
      message.trim() === ''
    ) {
      message = `Request failed with status ${status}.`;
    }
    const details = body.error.details;
    if (Array.isArray(details) && details.length > 0) {
      const fields = details
        .map((d) => d?.field)
        .filter((f): f is string => typeof f === 'string');
      if (fields.length > 0) {
        message += ` Check these fields: ${fields.join(', ')}.`;
      }
    }
    return message;
  }

  // Static fallbacks for missing/malformed bodies.
  if (status === 404) return 'The requested resource was not found on the backend.';
  if (status >= 500) {
    return 'The backend returned an error. Check the service status and try again.';
  }
  return `Request failed with status ${status}.`;
}

/** A typed, cancellable API client. No silent fallbacks to fake data. */
export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string;
  readonly aborted: boolean;
  readonly endpoint: string;
  /** Verified envelope code, when the backend provided one. */
  readonly code?: string;
  /** Native API error envelope, never a fallback. */
  readonly nativeError?: ApiErrorBody;
  /** Non-envelope failure body (e.g. a vision analysis failure record). */
  readonly payload?: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      requestId: string;
      aborted: boolean;
      endpoint: string;
      code?: string;
      nativeError?: ApiErrorBody;
      payload?: unknown;
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.requestId = options.requestId;
    this.aborted = options.aborted;
    this.endpoint = options.endpoint;
    this.code = options.code;
    this.nativeError = options.nativeError;
    this.payload = options.payload;
  }
}

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers({
    Accept: 'application/json',
    ...extra,
  });
  return headers;
}

function composeSignals(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const valid = signals.filter((s): s is AbortSignal => Boolean(s));
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of valid) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

async function parseErrorBody(response: Response): Promise<{
  parsed: unknown;
  wasJson: boolean;
}> {
  // Safe on both JSON and empty/broken bodies; never throws to the caller.
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return { parsed: undefined, wasJson: false };
  }
  try {
    return { parsed: await response.json(), wasJson: true };
  } catch {
    return { parsed: undefined, wasJson: true };
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number; externalSignal?: AbortSignal } = {},
): Promise<T> {
  const { timeoutMs = 30_000, externalSignal, ...rest } = init;
  const url = `${API_BASE_URL}${path}`;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = composeSignals([
    rest.signal ?? undefined,
    timeoutController.signal,
    externalSignal,
  ]);

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      signal,
      headers: buildHeaders(rest.headers),
      mode: 'cors',
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const aborted =
      (err instanceof DOMException && err.name === 'AbortError') ||
      timeoutController.signal.aborted ||
      (externalSignal?.aborted ?? false);
    const message = aborted
      ? 'Request timed out or was cancelled. The local backend may be slow to respond or is not reachable.'
      : 'Could not reach the local backend. Confirm it is running and accessible.';
    throw new ApiError(message, {
      status: 0,
      requestId,
      aborted,
      endpoint: path,
    });
  }

  clearTimeout(timeoutId);

  if (!response.ok) {
    const { parsed, wasJson } = await parseErrorBody(response);
    const envelope = ((): ApiErrorBody | undefined => {
      if (
        parsed &&
        typeof parsed === 'object' &&
        'error' in parsed &&
        typeof (parsed as ApiErrorBody).error === 'object' &&
        (parsed as ApiErrorBody).error !== null
      ) {
        return parsed as ApiErrorBody;
      }
      return undefined;
    })();
    const payload = wasJson && !envelope ? parsed : undefined;
    // Static 413 wording even without a parseable body.
    const message =
      response.status === 413 && !envelope && !payload
        ? 'Uploaded file exceeds the maximum allowed size.'
        : friendlyErrorMessage(response.status, parsed ?? undefined);
    throw new ApiError(message, {
      status: response.status,
      requestId,
      aborted: false,
      endpoint: path,
      code: envelope?.error?.code,
      nativeError: envelope,
      payload,
    });
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    return text as unknown as T;
  }

  return (await response.json()) as T;
}

// --- Health -----------------------------------------------------------------

export function getHealth(signal?: AbortSignal): Promise<HealthPayload> {
  return request<HealthPayload>('/health', {
    method: 'GET',
    timeoutMs: TIMEOUTS.health,
    externalSignal: signal,
  });
}

export function getAppHealth(signal?: AbortSignal): Promise<HealthPayload> {
  return request<HealthPayload>('/api/v1/health', {
    method: 'GET',
    timeoutMs: TIMEOUTS.health,
    externalSignal: signal,
  });
}

// --- Data mode --------------------------------------------------------------

export function getAppMode(signal?: AbortSignal): Promise<AppModePayload> {
  return request<AppModePayload>('/api/v1/mode', {
    method: 'GET',
    timeoutMs: TIMEOUTS.health,
    externalSignal: signal,
  });
}

/**
 * Switches the backend's explicit data-mode selection (live RSS / demo
 * fixtures). The backend returns the applied selection.
 */
export function setAppMode(
  mode: 'live' | 'demo',
  signal?: AbortSignal,
): Promise<AppModePayload> {
  return request<AppModePayload>('/api/v1/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
    timeoutMs: TIMEOUTS.health,
    externalSignal: signal,
  });
}

// --- Articles ---------------------------------------------------------------

export function listArticles(
  params: { limit?: number } = {},
  signal?: AbortSignal,
): Promise<ArticlesResponse> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<ArticlesResponse>(`/api/v1/articles${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    timeoutMs: TIMEOUTS.articles,
    externalSignal: signal,
  });
}

export function getArticle(articleId: string, signal?: AbortSignal): Promise<Article> {
  return request<Article>(`/api/v1/articles/${encodeURIComponent(articleId)}`, {
    method: 'GET',
    timeoutMs: TIMEOUTS.articleDetail,
    externalSignal: signal,
  });
}

export function analyzeArticle(
  articleId: string,
  signal?: AbortSignal,
): Promise<AnalysisResponse> {
  return request<AnalysisResponse>(
    `/api/v1/articles/${encodeURIComponent(articleId)}/analysis`,
    {
      method: 'POST',
      timeoutMs: TIMEOUTS.analysis,
      externalSignal: signal,
    },
  );
}

// --- Multimodal (Phase 10, same-record combined view) ------------------------
// Note: multimodal analysis is omitted from the online edition. Only sentiment
// and NER are supported; image analysis is replaced with placeholders.

/**
 * POST /api/v1/multimodal/analyze is not available in the online edition.
 * Sentiment and NER analysis are performed separately via /analysis endpoint.
 */
export function analyzeMultimodalRecord = undefined as any;
