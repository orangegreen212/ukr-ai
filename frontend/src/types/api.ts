/**
 * Frozen backend API contracts, mirrored from the Python response models.
 * Every interface below maps 1:1 to a named backend definition; no
 * guess-based alternative keys, no permissive catch-all index signatures.
 *
 * Sources of truth (uncomment when cross-checking):
 * - HealthPayload            -> app/api/health.py:20-30
 * - ArticleOut               -> app/api/v1.py:44-61
 * - ArticlesResponse         -> app/api/v1.py:64-73
 * - ArticleAnalysisResponse,
 *   _SentimentSection, _NerSection, _EntityItem -> app/api/analysis.py:281-336
 * - Error envelope           -> app/api/errors.py:53-71
 */

// --- Health endpoints -------------------------------------------------------

/** GET /health and GET /api/v1/health return the same payload. */
export interface HealthPayload {
  status: string;
  app: string;
  version: string;
  /** Demo fixtures load successfully. */
  demo_ok: boolean;
  /** Number of demo fixture articles. */
  demo_articles: number;
  /** Present when the demo fixtures failed to load. */
  demo_error: string | null;
  /** LM Studio is configured AND enabled on the backend. */
  lm_studio_enabled: boolean;
  /** True only when feed_url_primary starts with http(s) — configuration
   * shape, NOT reachability. */
  live_feed_configured: boolean;
}

// --- Articles ---------------------------------------------------------------

/** `ArticleOut` — field names are exactly the frozen `Article.to_dict()` keys.
 * Slice B (2026-11-09) adds the multi-source attribution fields additively;
 * they are optional so older backends without them still type-check. */
export interface Article {
  id: string;
  title: string;
  /** Demo fixtures carry no body text (analysis uses the summary instead). */
  text: string | null;
  summary: string | null;
  source_name: string | null;
  source_url: string | null;
  canonical_url: string | null;
  published_at: string | null;
  retrieved_at: string | null;
  language: string;
  content_hash: string | null;
  /** True when this record is a synthetic demo fixture. */
  is_demo_data: boolean;
  /** Human-readable synthetic-data notice (Ukrainian). */
  usage_note: string | null;
  /** Registry source ID (e.g. `pravda`, `kyivindependent`). */
  source_id?: string | null;
  /** Publisher's declared feed language (base subtag, e.g. `uk`/`en`). */
  source_language?: string;
  /** Explicit processing state: eligible | metadata_only | unsupported_language
   * | pending_validation | failed (`app/models.py` vocabulary). */
  analysis_status?: string | null;
  /** Why analysis is unavailable (e.g. `source_metadata_only`). */
  analysis_exclusion_reason?: string | null;
}

/** `SourceStatusOut` (Slice B) — one enabled source's outcome for the current
 * ingestion pass. Mirrors `app.ingestion.service.SourceStatus` field-for-field
 * (no parallel registry). */
export interface SourceStatusInfo {
  source_id: string;
  display_name: string;
  ingestion_mode: string;
  /** `ok` | `error` for this pass. */
  status: string;
  article_count: number;
  feed_url: string | null;
  retrieved_at: string | null;
  /** One-line failure reason (no stack traces), or null. */
  error: string | null;
  /** True when the statuses describe the CACHED pass (live_stale mode). */
  stale: boolean;
}

/** `ArticlesResponse` — serving mode of the record list. `live`: fresh real
 * RSS; `demo`: explicit demo fixtures; `live_stale`: live fetch failed, cached
 * real articles from a previous pass are served (with `error` set);
 * `live_error`: live fetch failed, nothing cached — empty list; the legacy
 * `demo_fallback` value is no longer produced but stays in the union so older
 * contract readers type-check. */
export type ArticlesServingMode =
  | 'live'
  | 'demo'
  | 'live_stale'
  | 'live_error'
  | 'demo_fallback';

export interface ArticlesResponse {
  mode: ArticlesServingMode;
  feed_used: string | null;
  count: number;
  articles: Article[];
  /** Static safe phrase ('live_feed_unavailable') in failed-live runs;
   * the detailed cause stays in the backend log. */
  error: string | null;
  /** Slice B (additive): per-source outcomes of the current pass. Absent or
   * empty on demo mode and on older backends. */
  sources?: SourceStatusInfo[];
}

/** GET/POST `/api/v1/mode` — the explicit data-mode selection of the backend
 * (in-process state; defaults to `live` on server start). */
export interface AppModePayload {
  mode: 'live' | 'demo';
}

// --- NLP Analysis -----------------------------------------------------------

/** POST /api/v1/articles/{id}/analysis — top-level `article_id` +
 * `content_hash` + derived `status` ('ok'|'partial'|'failed'). */
export interface AnalysisResponse {
  article_id: string;
  content_hash: string;
  status: 'ok' | 'partial' | 'failed';
  sentiment: SentimentSection;
  ner: NerSection;
}

/** `_SentimentSection` — no score distribution exists in this contract. */
export interface SentimentSection {
  article_id: string;
  content_hash: string;
  task: 'sentiment';
  status: string;
  label: string | null;
  confidence: number | null;
  model_id: string;
  model_revision: string;
  predicted_at: string;
  error_reason: string | null;
  caveat: string | null;
  /** Predictive-quality validation marker (e.g. 'unreviewed'); technical
   * inference success is NOT quality validation. */
  evaluation_status: string;
}

/** `_EntityItem`. */
export interface NamedEntity {
  entity_type: string;
  text: string;
  start: number;
  end: number;
  confidence: number | null;
}

/** `_NerSection` — note: `entities` is a collection INSIDE this object. */
export interface NerSection {
  article_id: string;
  content_hash: string;
  task: 'ner';
  status: string;
  entities: NamedEntity[];
  model_id: string;
  model_revision: string;
  predicted_at: string;
  error_reason: string | null;
  caveat: string | null;
  evaluation_status: string;
}

// --- Image analysis is omitted from the online edition; only sentiment + NER are supported.

// --- Frequent entities (M6 analytics) ---------------------------------------

/** `FrequentEntityOut` — one aggregated surface form (verbatim model text). */
export interface FrequentEntityItem {
  entity_type: string;
  text: string;
  /** Number of DISTINCT articles mentioning this key. */
  count: number;
  article_ids: string[];
}

/** `FrequentEntitiesResponse` — NER aggregation over the first `articles`
 * records of the current serving mode. `status` is ok/partial/failed. */
export interface FrequentEntitiesResponse {
  status: 'ok' | 'partial' | 'failed';
  ingestion_mode: string;
  articles_requested: number;
  articles_available: number;
  articles_analyzed: number;
  articles_failed: number;
  entities: FrequentEntityItem[];
  model_id: string;
  model_revision: string;
  predicted_at: string;
  evaluation_status: string;
  caveat: string | null;
  error_reason: string | null;
}

/** `SentimentDistributionResponse` — batch sentiment aggregation over the
 * first `limit` eligible records of the current serving mode.
 * `status` is ok/partial/failed; counts are machine estimates (unreviewed). */
export interface SentimentDistributionResponse {
  status: 'ok' | 'partial' | 'failed';
  ingestion_mode: string;
  articles_requested: number;
  articles_available: number;
  articles_analyzed: number;
  articles_failed: number;
  counts: { positive: number; neutral: number; negative: number };
  model_id: string;
  model_revision: string;
  predicted_at: string;
  evaluation_status: string;
  caveat: string | null;
  error_reason: string | null;
}

// --- API error envelope -----------------------------------------------------

/** One simplified validation issue echoed by 422 responses. */
export interface ErrorFieldDetail {
  field: string;
  message: string;
}

/** `{"error": {"code", "message", "details?"}}` — the fixed envelope used by
 * every backend error path (app/api/errors.py:66-71). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: ErrorFieldDetail[];
  };
}