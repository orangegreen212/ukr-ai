import type {
  AnalysisResponse,
  Article,
  ArticlesResponse,
  NamedEntity,
  SourceStatusInfo,
} from '@/types/api';

/**
 * Accessors for the frozen backend contracts. Each function reads exactly the
 * fields defined in the Python response models — no guess-based fallbacks for
 * alternative key names, and no fabricated values.
 */

// --- Article accessors ------------------------------------------------------

export function articleTitle(article: Article): string {
  return article.title || 'Untitled article';
}

export function articleSource(article: Article): string | undefined {
  return article.source_name ?? undefined;
}

/** Registry source ID, when the backend supplies it (Slice B contract). */
export function articleSourceId(article: Article): string | undefined {
  return article.source_id ?? undefined;
}

export function articlePublishedAt(article: Article): string | undefined {
  return article.published_at ?? undefined;
}

// --- Analysis eligibility ---------------------------------------------------

/** Explicit analysis status, when the backend supplies one (Slice B). */
export function articleAnalysisStatus(article: Article): string | undefined {
  const status = article.analysis_status;
  if (typeof status !== 'string' || status.trim() === '') return undefined;
  return status.trim().toLowerCase();
}

/**
 * True exactly when this stored record may run Ukrainian text analysis.
 * Articles reported by a backend WITHOUT the Slice B fields are treated as
 * eligible (transparent for older contracts); every excluded record must have
 * an explicit non-`eligible` status.
 */
export function isArticleAnalyzable(article: Article): boolean {
  const status = articleAnalysisStatus(article);
  return status === undefined || status === 'eligible';
}

/** Stable exclusion reason (`source_metadata_only`, `language_…_unsupported`,
 * ...) or undefined for eligible/unknown articles. */
export function articleExclusionReason(article: Article): string | undefined {
  const reason = article.analysis_exclusion_reason;
  if (typeof reason !== 'string' || reason.trim() === '') return undefined;
  return reason;
}

function absoluteHttpUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function articleUrl(article: Article): string | undefined {
  return absoluteHttpUrl(article.source_url) ?? absoluteHttpUrl(article.canonical_url);
}

/** Simple truth from the real `is_demo_data` field. */
export function articleIsDemo(article: Article): boolean {
  return article.is_demo_data === true;
}

export function articleExcerpt(article: Article): string | undefined {
  const text = article.summary ?? article.text ?? undefined;
  if (typeof text !== 'string' || text.trim() === '') return undefined;
  return text;
}

/** Full body text; demo fixtures have none (analysis runs on the summary). */
export function articleFullText(article: Article): string | undefined {
  const text = article.text ?? undefined;
  if (typeof text !== 'string' || text.trim() === '') return undefined;
  return text;
}

// --- Date / formatting helpers ---------------------------------------------

export function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateShort(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// --- Multi-source status helpers (Slice B) -----------------------------------

/** Per-source article counts over the CURRENT returned list (the strip shows
 * what the backend actually served; nothing is invented for capped pages).
 * `key` is the filter value and matches the filter comparison key
 * (`source_id` when present, otherwise the display name) — the source filter
 * and these options always speak the same key language. */
export function sourceArticleCounts(
  articles: Article[],
): { key: string; sourceName: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const article of articles) {
    const key = articleSourceId(article) ?? articleSource(article) ?? 'Unknown source';
    const name = articleSource(article) ?? key;
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(key, { name, count: 1 });
    }
  }
  return Array.from(counts, ([key, { name, count }]) => ({ key, sourceName: name, count }))
    .sort((a, b) => b.count - a.count || a.sourceName.localeCompare(b.sourceName));
}

/**
 * Honest per-source status entries for display. Returns [] when the response
 * carries no `sources` (demo mode, older backends), and never rewrites an
 * `error` status into anything positive — a FAILED source stays visibly
 * failed even when other sources produced articles.
 */
export function sourceStatuses(
  response: ArticlesResponse,
): SourceStatusInfo[] {
  const sources = response.sources;
  return Array.isArray(sources) ? sources : [];
}

/** Date (YYYY-MM-DD) of an article's publication timestamp, if any. */
export function articlePublishedDate(article: Article): string | undefined {
  const value = article.published_at;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

// --- Serving-mode detection -------------------------------------------------

/** True exactly when the response serves demo data: either the explicit demo
 * mode or the legacy `demo_fallback` records produced by older backends.
 * Any other `mode` is treated as NOT demo (truthful default, no invented
 * modes). */
export function isDemoFallback(response: ArticlesResponse): boolean {
  return response.mode === 'demo_fallback' || response.mode === 'demo';
}

/** Honest serving-state for the news page banner. Unknown modes are treated
 * like a failed live pass (error view + retry) — never shown as fresh news. */
export type ServingModeState = 'live' | 'demo' | 'stale' | 'error';

export function servingModeState(response: ArticlesResponse): ServingModeState {
  switch (response.mode) {
    case 'live':
      return 'live';
    case 'demo':
    case 'demo_fallback':
      return 'demo';
    case 'live_stale':
      return 'stale';
    case 'live_error':
      return 'error';
    default:
      return 'error';
  }
}

// --- Analysis accessors -----------------------------------------------------

export function analysisStatus(analysis: AnalysisResponse): string {
  return analysis.status;
}

export function sentimentStatus(analysis: AnalysisResponse): string {
  return analysis.sentiment?.status ?? 'unavailable';
}

export function sentimentLabel(analysis: AnalysisResponse): string | undefined {
  return analysis.sentiment?.label ?? undefined;
}

export function sentimentConfidence(analysis: AnalysisResponse): number | undefined {
  const v = analysis.sentiment?.confidence;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return v;
}

export function sentimentCaveat(analysis: AnalysisResponse): string | undefined {
  return analysis.sentiment?.caveat ?? undefined;
}

export function sentimentErrorReason(analysis: AnalysisResponse): string | undefined {
  return analysis.sentiment?.error_reason ?? undefined;
}

export function sentimentModelId(analysis: AnalysisResponse): string | undefined {
  return analysis.sentiment?.model_id ?? undefined;
}

/** NER entities live INSIDE the `ner` object (`analysis.ner.entities`).
 * The array guard keeps rendering exception-safe even against a
 * contract-violating response. */
export function analysisEntities(analysis: AnalysisResponse): NamedEntity[] {
  const entities = analysis.ner?.entities;
  return Array.isArray(entities) ? entities : [];
}

export function nerStatus(analysis: AnalysisResponse): string {
  return analysis.ner?.status ?? 'unavailable';
}

export function nerErrorReason(analysis: AnalysisResponse): string | undefined {
  return analysis.ner?.error_reason ?? undefined;
}

export function nerModelId(analysis: AnalysisResponse): string | undefined {
  return analysis.ner?.model_id ?? undefined;
}

export function entityText(entity: NamedEntity): string {
  return typeof entity?.text === 'string' && entity.text !== '' ? entity.text : 'Unknown';
}

export function entityType(entity: NamedEntity): string {
  return typeof entity?.entity_type === 'string' && entity.entity_type !== ''
    ? entity.entity_type
    : 'ENTITY';
}

export function entityConfidence(entity: NamedEntity): number | undefined {
  const v = entity?.confidence;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return v;
}

// --- Vision accessors are omitted from the online edition ---

// --- Misc -------------------------------------------------------------------

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function sentimentColor(label?: string): string {
  const lower = (label ?? '').toLowerCase();
  if (['positive', 'pos', 'позитивний', 'позитивне'].some((k) => lower.includes(k))) {
    return 'text-success';
  }
  if ((['negative', 'neg', 'негативний', 'негативне'] as const).some((k) => lower.includes(k))) {
    return 'text-danger';
  }
  if (['neutral', 'neu', 'нейтральний', 'нейтральне'].some((k) => lower.includes(k))) {
    return 'text-slate-300';
  }
  return 'text-ukon-300';
}
