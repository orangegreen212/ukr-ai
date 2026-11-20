import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  ExternalLink,
  ArrowLeft,
  Sparkles,
  RotateCw,
  FileText,
  Info,
  Layers,
} from 'lucide-react';
import type {
  Article,
  AnalysisResponse,
  ArticlesResponse,
  SourceStatusInfo,
} from '@/types/api';
import {
  analyzeArticle,
  getArticle,
  listArticles,
  setAppMode,
  ApiError,
} from '@/services/api';
import {
  articleTitle,
  articleSource,
  articleSourceId,
  articleAnalysisStatus,
  articleExclusionReason,
  articlePublishedAt,
  articlePublishedDate,
  articleUrl,
  articleExcerpt,
  articleIsDemo,
  formatDate,
  formatDateShort,
  servingModeState,
  sourceArticleCounts,
} from '@/lib/normalize';
import type { ServingModeState } from '@/lib/normalize';
import { useAsyncRequest } from '@/hooks/useAsyncRequest';
import { ArticleCard } from '@/components/ArticleCard';
import { Badge } from '@/components/Badge';
import { Callout } from '@/components/Callout';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { SentimentVisual } from '@/components/SentimentVisual';
import { EntityTags } from '@/components/EntityTags';

// Retry control for failed live ingestion (stale / error views).
function RetryArticlesButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn-outline text-xs"
      onClick={onClick}
      disabled={disabled}
    >
      <RotateCw size={13} aria-hidden />
      Retry live ingestion
    </button>
  );
}

export function NewsPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [sourceStatusList, setSourceStatusList] = useState<SourceStatusInfo[]>([]);
  const [servingMode, setServingMode] = useState<ServingModeState>('live');
  const [modeSwitching, setModeSwitching] = useState(false);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [languageFilter, setLanguageFilter] = useState<string | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<string | 'all'>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset the source/date filters whenever a fresh pass arrives, so a filter
  // naming a source that failed in the new pass cannot hide the whole list.
  const applyResponse = useCallback(
    (res: ArticlesResponse) => {
      setArticles(res.articles ?? []);
      setSourceStatusList(sourceStatuses(res));
      setServingMode(servingModeState(res));
      setSourceFilter('all');
      setDateFilter('');
    },
    [],
  );

  const fetchArticles = useCallback(
    (selectedLimit: number) => {
      const controller = new AbortController();
      setLoading(true);
      setError(null);
      listArticles({ limit: selectedLimit }, controller.signal)
        .then((res: ArticlesResponse) => {
          applyResponse(res);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(
            err instanceof ApiError
              ? err.aborted
                ? 'Request timed out. The local backend may be slow to respond.'
                : err.message
              : 'Could not load articles.',
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      return controller;
    },
    [applyResponse],
  );

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = fetchArticles(limit);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  /** Re-runs the articles request after a failure or a mode switch. */
  const refetchArticles = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = fetchArticles(limit);
  }, [fetchArticles, limit]);

  /** Explicit data-mode switch: live RSS by default, demo on request. The
   * backend confirms the switch; the news list is then re-fetched so the
   * banner and records always reflect the mode the backend actually serves. */
  const switchAppMode = useCallback(
    (mode: 'live' | 'demo') => {
      const servingNow: 'live' | 'demo' = servingMode === 'demo' ? 'demo' : 'live';
      if (modeSwitching || mode === servingNow) return;
      const controller = new AbortController();
      setModeSwitching(true);
      setAppMode(mode, controller.signal)
        .then((applied) => {
          window.dispatchEvent(
            new CustomEvent('app-mode-changed', { detail: applied.mode }),
          );
          refetchArticles();
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(
            err instanceof ApiError && !err.aborted
              ? err.message
              : 'Could not switch the data mode. Try again.',
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setModeSwitching(false);
        });
    },
    [modeSwitching, servingMode, refetchArticles],
  );

  const languages = useMemo(() => {
    const set = new Set<string>();
    articles.forEach((a) => {
      if (a.language) set.add(a.language);
    });
    return Array.from(set).sort();
  }, [articles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => {
      if (languageFilter !== 'all' && a.language !== languageFilter) return false;
      if (sourceFilter !== 'all') {
        const key = articleSourceId(a) ?? articleSource(a);
        if (key !== sourceFilter) return false;
      }
      if (dateFilter && articlePublishedDate(a) !== dateFilter) return false;
      if (!q) return true;
      const headline = articleTitle(a).toLowerCase();
      const source = (articleSource(a) ?? '').toLowerCase();
      const excerpt = (articleExcerpt(a) ?? '').toLowerCase();
      return (
        headline.includes(q) ||
        source.includes(q) ||
        excerpt.includes(q)
      );
    });
  }, [articles, query, languageFilter, sourceFilter, dateFilter]);

  /** Client-side counts of the CURRENTLY RETURNED records per source — shown
   * inside the source filter labels (the backend slice is small; the strip
   * below shows what the ingestion pass actually produced). */
  const sourceOptions = useMemo(
    () => sourceArticleCounts(articles),
    [articles],
  );

  const selected = useMemo(
    () => (selectedId ? articles.find((a) => a.id === selectedId) ?? null : null),
    [selectedId, articles],
  );

  /** The honest "as of" time for stale cached articles: their own
   * retrieved_at from the ingestion pass that actually produced them. */
  const staleAsOf = useMemo(() => articles[0]?.retrieved_at ?? undefined, [articles]);

  return (
    <div className="animate-fade-in space-y-4">
      {selected ? (
        <ArticleDetail
          articleId={selected.id}
          fallbackArticle={selected}
          onBack={() => setSelectedId(null)}
        />
      ) : (
        <>
          <div className="surface p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                  aria-hidden
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by headline, source, or excerpt (client-side)"
                  className="input pl-9"
                  aria-label="Filter articles"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {servingMode === 'live' ? (
                  <Badge tone="success" size="sm">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                    Live RSS
                  </Badge>
                ) : servingMode === 'stale' ? (
                  <Badge tone="warning" size="sm">Cached (stale)</Badge>
                ) : servingMode === 'error' ? (
                  <Badge tone="danger" size="sm">Feed unavailable</Badge>
                ) : null}
                <select
                  value={languageFilter}
                  onChange={(e) => setLanguageFilter(e.target.value)}
                  className="input w-auto py-1.5 text-xs"
                  aria-label="Filter by language"
                  disabled={languages.length === 0}
                >
                  <option value="all">All languages</option>
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="input w-auto py-1.5 text-xs"
                  aria-label="Filter by source"
                  disabled={sourceOptions.length === 0}
                >
                  <option value="all">All sources</option>
                  {sourceOptions.map(({ key, sourceName, count }) => (
                    <option key={key} value={key}>
                      {sourceName} ({count})
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="input w-auto py-1.5 text-xs"
                  aria-label="Filter by publication date"
                />
                <span className="text-[11px] text-slate-500">
                  {filtered.length} of {articles.length} shown
                </span>
                <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  Limit
                  <select
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    className="input w-auto py-1.5 text-xs"
                    aria-label="Article limit"
                  >
                    {LIMITS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  className="flex items-center gap-0.5 rounded-md border border-base-800 p-0.5"
                  role="group"
                  aria-label="Data mode"
                >
                  <button
                    type="button"
                    className={`rounded px-2.5 py-1 text-xs transition-colors ${
                      servingMode === 'demo'
                        ? 'text-slate-400 hover:text-slate-200'
                        : 'bg-base-800 font-medium text-white'
                    }`}
                    onClick={() => switchAppMode('live')}
                    disabled={modeSwitching}
                    aria-pressed={servingMode !== 'demo'}
                  >
                    Live
                  </button>
                  <button
                    type="button"
                    className={`rounded px-2.5 py-1 text-xs transition-colors ${
                      servingMode === 'demo'
                        ? 'bg-base-800 font-medium text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    onClick={() => switchAppMode('demo')}
                    disabled={modeSwitching}
                    aria-pressed={servingMode === 'demo'}
                  >
                    Demo
                  </button>
                </div>
              </div>
            </div>
          </div>

          {servingMode === 'demo' ? (
            <Callout variant="info" title="Demo Mode">
              Showing the synthetic demo fixtures (self-authored Ukrainian articles dated
              October 21, 2026). These are demonstration data, not live news.
            </Callout>
          ) : null}
          {servingMode === 'stale' ? (
            <div className="space-y-2">
              <Callout variant="warning" title="Live news could not be loaded right now">
                The backend could not reach the configured RSS feed in this pass. Showing
                real articles cached from an earlier ingestion
                {staleAsOf ? ` (${formatDate(staleAsOf)})` : ''} — they may be outdated.
              </Callout>
              <RetryArticlesButton onClick={refetchArticles} disabled={modeSwitching} />
            </div>
          ) : null}
          {servingMode === 'error' ? (
            <div className="space-y-2">
              <Callout variant="error" title="Live news could not be loaded">
                The configured RSS feed is unreachable and no cached articles are
                available yet. No demo or synthetic data is substituted in Live Mode.
              </Callout>
              <RetryArticlesButton onClick={refetchArticles} disabled={modeSwitching} />
            </div>
          ) : null}

          {error ? (
            <Callout variant="error" title="Could not load articles">
              {error}
            </Callout>
          ) : null}

          {sourceStatusList.length > 0 ? (
            <SourceStatusStrip sources={sourceStatusList} mode={servingMode} />
          ) : null}

          <div className="surface">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                <Spinner size={16} className="text-ukon-300" />
                Loading articles…
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No matching articles"
                description={
                  error
                    ? 'The article request failed.'
                    : 'Try clearing the filters or increasing the article limit.'
                }
              />
            ) : (
              <ul className="divide-y divide-base-800">
                {filtered.map((article) => (
                  <li key={article.id}>
                    <ArticleCard
                      article={article}
                      onClick={() => setSelectedId(article.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[11px] text-slate-600">
            Showing {filtered.length} of {articles.length} returned articles
            {servingMode === 'demo' ? ' · synthetic demo fixtures' : ''}.
          </p>
        </>
      )}
    </div>
  );
}

// --- Per-source ingestion status (Slice B) -----------------------------------

/**
 * Display per-source success/error/stale statuses reported by the backend for
 * THIS ingestion pass (live/stale modes). Honesty rules:
 * - a FAILED source is shown as failed even when other sources have articles —
 *   partial success is never presented as fully healthy;
 * - `ok` with `article_count === 0` is shown distinctly ("0 articles") so an
 *   empty-but-reachable feed is never confused with a failed feed;
 * - in stale mode every entry is labeled as describing the CACHED pass that
 *   produced the currently served articles, not a fresh fetch.
 */
function SourceStatusStrip({
  sources,
  mode,
}: {
  sources: SourceStatusInfo[];
  mode: ServingModeState;
}) {
  const okSources = sources.filter((s) => s.status !== 'error');
  const okArticles = okSources.reduce(
    (sum, s) => sum + (Number.isFinite(s.article_count) ? s.article_count : 0),
    0,
  );
  const staleLabel = mode === 'stale' || sources.some((s) => s.stale);

  if (sources.length === 0) return null;

  return (
    <section
      className="surface p-3 space-y-2"
      data-testid="source-status-strip"
      aria-label="Per-source ingestion status"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-200">Sources ({sources.length})</p>
        <p className="text-[11px] text-slate-500">
          {okSources.length} fetched · {okArticles} articles{staleLabel ? ' · from cached pass' : ''}
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map((s) => {
          const isError = s.status === 'error';
          return (
            <li
              key={s.source_id}
              className={`flex items-start gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                isError
                  ? 'border-danger/50 bg-danger/10'
                  : 'border-base-800 bg-base-900'
              }`}
              data-source-status={s.source_id}
            >
              <span
                aria-hidden
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  isError ? 'bg-danger' : s.article_count === 0 ? 'bg-warning' : 'bg-success'
                }`}
              />
              <span className="min-w-0">
                <span className="font-medium text-slate-200">{s.display_name}</span>
                <span className="text-slate-500">
                  {' '}
                  — {isError ? 'feed unavailable' : `${s.article_count} article${s.article_count === 1 ? '' : 's'}`}
                  {isError && s.error ? `: ${s.error}` : ''}
                  {!isError && s.article_count === 0 ? ' (feed reachable, no articles returned)' : ''}
                  {staleLabel ? ' · cached' : ''}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// --- Article detail ---------------------------------------------------------

interface ArticleDetailProps {
  articleId: string;
  fallbackArticle: Article;
  onBack: () => void;
}

function ArticleDetail({ articleId, fallbackArticle, onBack }: ArticleDetailProps) {
  const [article, setArticle] = useState<Article>(fallbackArticle);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const analysis = useAsyncRequest<AnalysisResponse>();

  useEffect(() => {
    // Never show a stale combined result after switching articles.
    analysis.reset();
    setLoadingDetail(true);
    setDetailError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  const validateCombinedFile = (file: File): string | null => {
    return null; // image analysis omitted in online edition
  };

  const acceptCombinedFile = (file: File | null) => {
    analysis.reset();
    setCombinedFileError(null);
    if (!file) {
      setCombinedFile(null);
      return;
    }
    const error = validateCombinedFile(file);
    if (error) {
      setCombinedFile(null);
      setCombinedFileError(error);
      return;
    }
    setCombinedFile(file);
  };

  const runAnalysis = () => {
    analysis.run((signal) => analyzeArticle(articleId, signal));
  };

  const headline = articleTitle(article);
  const source = articleSource(article);
  const published = articlePublishedAt(article);
  const url = articleUrl(article);
  const excerpt = articleExcerpt(article);
  const fullText = articleFullText(article);
  const demo = articleIsDemo(article);
  /** Slice B: only eligible Ukrainian records offer an active analysis
   * action; excluded records get the explicit backend reason instead. */
  const analyzable = isArticleAnalyzable(article);
  const analysisStatusValue = articleAnalysisStatus(article);
  const exclusionReason = articleExclusionReason(article);

  return (
    <div className="space-y-4 animate-fade-in">
      <button type="button" className="btn-ghost text-xs" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden />
        Back to articles
      </button>

      <article className="surface p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {demo ? (
            <Badge tone="demo" size="sm">
              DEMO DATA
            </Badge>
          ) : null}
          {article.language ? (
            <Badge tone="neutral" size="sm" className="uppercase">
              {article.language}
            </Badge>
          ) : null}
          {source ? <Badge tone="neutral" size="sm">{source}</Badge> : null}
        </div>

        <h2 className="font-serif text-2xl font-semibold text-white leading-tight text-balance">
          {headline}
        </h2>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {published ? (
            <span>Published {formatDate(published) ?? formatDateShort(published) ?? published}</span>
          ) : (
            <span>No publication date provided</span>
          )}
          {article.usage_note ? <span>· {article.usage_note}</span> : null}
        </div>

        {loadingDetail ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Spinner size={14} className="text-ukon-300" />
            Loading full article metadata…
          </div>
        ) : null}

        {detailError ? (
          <Callout variant="warning" title="Full detail unavailable">
            {detailError} Showing the summary fields from the list response.
          </Callout>
        ) : null}

        {excerpt ? (
          <p className="text-sm text-slate-300 leading-relaxed">{excerpt}</p>
        ) : null}

        {fullText ? (
          <div className="space-y-2">
            <p className="label">Article text</p>
            <p className="whitespace-pre-line text-sm text-slate-300 leading-relaxed max-h-72 overflow-y-auto scrollbar-thin pr-1">
              {fullText}
            </p>
          </div>
        ) : (
          !loadingDetail && (
            <Callout variant="info" title="Article text not provided">
              The backend did not return body text for this article. Analysis runs on whatever text the backend supplies.
            </Callout>
          )
        )}

        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-ukon-300 hover:text-ukon-200">
            <ExternalLink size={13} aria-hidden />
            Open source link
          </a>
        ) : null}
      </article>

      <section className="surface-raised p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Sparkles size={16} className="mt-0.5 text-ukon-300" aria-hidden />
            <div>
              <h3 className="text-sm font-semibold text-white">NLP Analysis</h3>
              <p className="text-xs text-slate-500">
                Sentiment and named-entity recognition. Models run locally.
              </p>
            </div>
          </div>
          {analyzable ? (
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={runAnalysis}
              disabled={analysis.isPending}
            >
              {analysis.isPending ? (
                <>
                  <Spinner size={14} />
                  Analyzing…
                </>
              ) : analysis.status === 'error' ? (
                <>
                  <RotateCw size={14} aria-hidden />
                  Retry analysis
                </>
              ) : (
                <>
                  <Sparkles size={14} aria-hidden />
                  Analyze article
                </>
              )}
            </button>
          ) : null}
        </div>

        {!analyzable ? (
          <Callout
            variant="info"
            title="Analysis unavailable for this article"
          >
            This article's analysis status on the backend is{' '}
            <code className="font-mono">{analysisStatusValue}</code>
            {exclusionReason ? (
              <>
                {' '}
                (reason: <code className="font-mono">{exclusionReason}</code>)
              </>
            ) : null}
            {' — '}by the source-language policy its content is not passed to Ukrainian
            sentiment, NER or LLM processing. Source metadata is preserved; no analysis was run.
          </Callout>
        ) : null}

        {analysis.isPending ? (
          <div className="space-y-3">
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-base-800">
              <div className="absolute inset-y-0 w-1/3 animate-progress rounded-full bg-ukon-500" />
            </div>
            <Callout variant="info" title="Models warming up">
              The first analysis can take over a minute while local models load. The interface stays responsive — you can navigate away and come back.
            </Callout>
          </div>
        ) : null}

        {analysis.status === 'error' && analysis.error ? (
          <Callout variant="error" title="Analysis failed">
            {analysis.error instanceof ApiError
              ? analysis.error.message
              : analysis.error.message || 'The backend did not return a successful analysis.'}
          </Callout>
        ) : null}

        {analysis.status === 'success' && analysis.data ? (
          <AnalysisResultView analysis={analysis.data} />
        ) : null}

        <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
          <Info size={11} className="mt-0.5 shrink-0" aria-hidden />
          Sentiment and NER models are experimental and have limited validation on Ukrainian text. The sentiment model is a Russian-language model (<code className="font-mono">ssb000ss/regional-sentiment-ru</code>); quality on Ukrainian news is unknown. Treat outputs as estimates, not verified facts.
        </p>
      </section>
    </div>
  );
}

function AnalysisResultView({ analysis }: { analysis: AnalysisResponse }) {
  const overall = analysisStatus(analysis);
  const sentLabel = sentimentLabel(analysis);
  const sentError = sentimentErrorReason(analysis);
  const nerError = nerErrorReason(analysis);
  const entities = analysisEntities(analysis);

  // Truthful failed view: the derived status is 'failed' AND neither section
  // produced usable output. Partial views still render their ok section.
  const bothFailed =
    overall === 'failed' &&
    sentimentStatus(analysis) !== 'ok' &&
    nerStatus(analysis) !== 'ok';
  if (bothFailed) {
    const reason = sentError ?? nerError ?? 'both analysis sections failed on the backend.';
    return (
      <Callout variant="warning" title="Analysis unavailable">
        {`The backend could not complete text analysis: ${reason} No predictions are shown.`}
      </Callout>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {overall !== 'ok' ? (
        <p className="text-xs text-warning">
          Derived status: {overall} — at least one section did not complete; failed sections show
          no predictions.
        </p>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="surface p-4">
          <SentimentVisual analysis={analysis} />
        </div>
        <div className="surface p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="label">Named entities</p>
            {nerStatus(analysis) !== 'ok' ? (
              <Badge tone="warning" size="sm">
                {nerStatus(analysis)}
              </Badge>
            ) : null}
          </div>
          {nerStatus(analysis) !== 'ok' && nerError ? (
            <p className="text-xs text-slate-500">
              NER did not complete: {nerError}. No entities are shown.
            </p>
          ) : null}
          <EntityTags entities={entities} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        {sentimentModelId(analysis) ? (
          <span className="inline-flex items-center gap-1 rounded bg-base-800 px-2 py-0.5 font-mono">
            <FileText size={10} aria-hidden />
            Sentiment: {sentimentModelId(analysis)} @{analysis.sentiment.model_revision}
          </span>
        ) : null}
        {nerModelId(analysis) ? (
          <span className="inline-flex items-center gap-1 rounded bg-base-800 px-2 py-0.5 font-mono">
            <FileText size={10} aria-hidden />
            NER: {nerModelId(analysis)} @{analysis.ner.model_revision}
          </span>
        ) : null}
        {analysis.sentiment.evaluation_status ? (
          <span className="rounded bg-base-800 px-2 py-0.5 font-mono">
            Evaluation: {analysis.sentiment.evaluation_status}
          </span>
        ) : null}
        {sentError ? (
          <span className="inline-flex items-center gap-1 text-warning">
            <AlertCircle size={11} aria-hidden />
            Sentiment: {sentLabel ? 'failed after prediction' : 'not completed'} ({sentError})
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Renders the Phase-10 combined same-record response: the article's verbatim
 * Phase-2 NLP result (through the unchanged `AnalysisResultView`) plus the
 * uploaded image's frozen vision result (through the shared
 * `VisionResultView`). Every honest failure state renders truthfully — no
 * slot is ever shown as successful with fabricated content.
 */
function CombinedResultView({ data }: { data: any }) {
  // Note: multimodal/combined analysis is omitted from the online edition.
  return (
    <Callout variant="info" title="Image analysis omitted">
      Image analysis is not available in the online edition. Only sentiment and
      named-entity recognition are supported.
    </Callout>
  );
}