/**
 * Slice B (2026-11-09) offline frontend tests: multi-source attribution,
 * source/date filters, analysis-eligibility display, and Live/Demo behavior.
 *
 * The API client (`@/services/api`) is fully mocked — no network, no backend.
 * Response fixtures mirror the frozen backend contracts (`app/api/v1.py`,
 * `app/api/eligibility.py` refusal semantics are NOT tested here; those are
 * backend tests — the frontend only needs the additive fields).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type {
  AnalysisResponse,
  ArticlesResponse,
  FrequentEntitiesResponse,
  LlmResponse,
  MultimodalResponse,
  SourceStatusInfo,
} from '@/types/api';

// --- Mock of the API client ---------------------------------------------------

vi.mock('@/services/api', () => {
  // Faithful-enough ApiError for `instanceof` checks in NewsPage/hooks.
  class ApiError extends Error {
    status: number;
    requestId: string;
    aborted: boolean;
    endpoint: string;
    constructor(
      message: string,
      options: { status: number; requestId: string; aborted: boolean; endpoint: string },
    ) {
      super(message);
      this.name = 'ApiError';
      this.status = options.status;
      this.requestId = options.requestId;
      this.aborted = options.aborted;
      this.endpoint = options.endpoint;
    }
  }
  return {
    ApiError,
    listArticles: vi.fn(),
    getArticle: vi.fn(),
    analyzeArticle: vi.fn(),
    llmArticle: vi.fn(),
    analyzeMultimodalRecord: vi.fn(),
    getFrequentEntities: vi.fn(),
    setAppMode: vi.fn(),
  };
});

import {
  analyzeArticle,
  analyzeMultimodalRecord,
  getArticle,
  getFrequentEntities,
  listArticles,
  llmArticle,
  setAppMode,
} from '@/services/api';

import { NewsPage } from '@/pages/NewsPage';

vi.mocked(analyzeArticle).mockResolvedValue({} as AnalysisResponse);
vi.mocked(analyzeMultimodalRecord).mockResolvedValue({} as MultimodalResponse);
vi.mocked(getFrequentEntities).mockResolvedValue({
  status: 'ok',
  ingestion_mode: 'full_content',
  articles_available: 1,
  articles_analyzed: 1,
  articles_failed: 0,
  entities: [],
  model_id: null,
  model_revision: null,
  evaluation_status: 'unreviewed',
  caveat: 'fake caveat',
} as unknown as FrequentEntitiesResponse);
vi.mocked(llmArticle).mockResolvedValue({} as LlmResponse);
vi.mocked(setAppMode).mockResolvedValue({ mode: 'demo' });

// --- Fixtures -----------------------------------------------------------------

const TS_1 = '2026-11-05T10:00:00Z'; // 2026-11-05 (UTC date, TZ-independent)
const TS_2 = '2026-11-06T09:00:00Z'; // 2026-11-06

function makeArticle(overrides: Record<string, unknown>) {
  return {
    id: 'art',
    title: 'Заголовок статті',
    text: 'Текст новини українською.',
    summary: 'Короткий реррат.',
    source_name: 'Українська правда',
    source_url: null,
    canonical_url: null,
    published_at: TS_1,
    retrieved_at: TS_1,
    language: 'uk',
    image_url: null,
    content_hash: 'a'.repeat(64),
    is_demo_data: false,
    usage_note: null,
    ...overrides,
  };
}

const UK_ARTICLE = makeArticle({
  id: 'uk-1',
  title: 'Обладнання для армії',
  source_id: 'pravda',
  source_name: 'Українська правда',
  analysis_status: 'eligible',
});

/** Kyiv Independent metadata-only record (en; excluded from Ukrainian NLP). */
const KI_ARTICLE = makeArticle({
  id: 'ki-1',
  title: 'Festival decision reported',
  text: null,
  summary: 'Headline reference stored.',
  source_id: 'kyivindependent',
  source_name: 'The Kyiv Independent',
  language: 'en',
  source_language: 'en',
  published_at: TS_2,
  analysis_status: 'metadata_only',
  analysis_exclusion_reason: 'source_metadata_only',
});

const SOURCES: SourceStatusInfo[] = [
  {
    source_id: 'pravda',
    display_name: 'Українська правда',
    ingestion_mode: 'full_content',
    status: 'ok',
    article_count: 1,
    feed_url: 'https://feeds.example/pravda',
    retrieved_at: TS_1,
    error: null,
    stale: false,
  },
  {
    source_id: 'kyivindependent',
    display_name: 'The Kyiv Independent',
    ingestion_mode: 'metadata_only',
    status: 'ok',
    article_count: 1,
    feed_url: 'https://feeds.example/ki',
    retrieved_at: TS_2,
    error: null,
    stale: false,
  },
  // FAILED source: must stay visibly failed (test 6).
  {
    source_id: 'unian',
    display_name: 'УНІАН',
    ingestion_mode: 'full_content',
    status: 'error',
    article_count: 0,
    feed_url: 'https://feeds.example/unian',
    retrieved_at: null,
    error: 'connection timeout after 10s',
    stale: false,
  },
  // SUCCESSFUL but EMPTY source (test 6): not failed, just zero articles.
  {
    source_id: 'slovidilo',
    display_name: 'Слово і Діло',
    ingestion_mode: 'full_content',
    status: 'ok',
    article_count: 0,
    feed_url: 'https://feeds.example/slovidilo',
    retrieved_at: TS_1,
    error: null,
    stale: false,
  },
];

function liveResponse(): ArticlesResponse {
  return {
    mode: 'live',
    feed_used: 'https://feeds.example/pravda',
    count: 2,
    articles: [UK_ARTICLE, KI_ARTICLE],
    error: null,
    sources: SOURCES,
  };
}

function demoResponse(): ArticlesResponse {
  return {
    mode: 'demo',
    feed_used: null,
    count: 1,
    articles: [
      makeArticle({
        id: 'demo-1',
        title: 'Демо новина',
        text: null,
        is_demo_data: true,
        usage_note: 'Синтетичні демо-дані.',
        published_at: '2026-10-21T12:00:00Z',
        source_id: null,
        source_name: 'Demo fixture',
        language: 'uk',
      }),
    ],
    error: null,
  };
}

function liveStaleResponse(): ArticlesResponse {
  return {
    mode: 'live_stale',
    feed_used: 'https://feeds.example/pravda',
    count: 1,
    articles: [UK_ARTICLE],
    error: 'live_feed_unavailable',
    sources: SOURCES.map((s) => ({ ...s, stale: true })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---------------------------------------------------------------------

describe('NewsPage — Slice B source behavior', () => {
  it('1. shows the publisher/source name for each article', async () => {
    vi.mocked(listArticles).mockResolvedValue(liveResponse());
    vi.mocked(getArticle).mockResolvedValue(UK_ARTICLE);
    render(<NewsPage />);

    expect(await screen.findByText('Обладнання для армії')).toBeInTheDocument();
    // ArticleCard + detail badges: both publishers render at least once.
    expect(screen.getAllByText('Українська правда').length).toBeGreaterThan(0);
    expect(screen.getAllByText('The Kyiv Independent').length).toBeGreaterThan(0);
    // ArticleDetail (no selection) never fetched.
    expect(getArticle).not.toHaveBeenCalled();
  });

  it('2. the source filter shows only the selected source', async () => {
    const user = userEvent.setup();
    vi.mocked(listArticles).mockResolvedValue(liveResponse());
    vi.mocked(getArticle).mockResolvedValue(UK_ARTICLE);
    render(<NewsPage />);
    await screen.findByText('Обладнання для армії');

    const select = screen.getByLabelText('Filter by source');
    // Per-source counts are visible in the option labels.
    await waitFor(() => {
      const option = select.querySelector('option[value="pravda"]');
      expect(option).not.toBeNull();
      expect(option?.textContent).toContain('Українська правда (1)');
    });
    await user.selectOptions(select, 'kyivindependent');

    expect(screen.getByText('Festival decision reported')).toBeInTheDocument();
    expect(screen.queryByText('Обладнання для армії')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 shown')).toBeInTheDocument();
  });

  it('3. the publication-date filter shows only articles of that date', async () => {
    vi.mocked(listArticles).mockResolvedValue(liveResponse());
    vi.mocked(getArticle).mockResolvedValue(UK_ARTICLE);
    render(<NewsPage />);
    await screen.findByText('Обладнання для армії');

    const dateInput = screen.getByLabelText('Filter by publication date');
    fireEvent.change(dateInput, { target: { value: '2026-11-05' } });

    expect(screen.getByText('Обладнання для армії')).toBeInTheDocument();
    expect(screen.queryByText('Festival decision reported')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 shown')).toBeInTheDocument();

    fireEvent.change(dateInput, { target: { value: '2026-11-06' } });
    expect(screen.getByText('Festival decision reported')).toBeInTheDocument();
    expect(screen.queryByText('Обладнання для армії')).not.toBeInTheDocument();
  });

  it('4. an excluded article offers NO active analysis action', async () => {
    vi.mocked(listArticles).mockResolvedValue(liveResponse());
    vi.mocked(getArticle).mockResolvedValue(KI_ARTICLE);
    render(<NewsPage />);
    await screen.findByText('Обладнання для армії');

    const user = userEvent.setup();
    await user.click(screen.getByText('Festival decision reported'));

    // Detail view is open.
    expect(await screen.findByRole('button', { name: 'Back to articles' })).toBeInTheDocument();
    // No active NLP analysis action exists for a metadata-only record.
    expect(screen.queryByRole('button', { name: 'Analyze article' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry analysis' })).not.toBeInTheDocument();
    // The LLM panel renders no active request action either.
    expect(
      screen.queryByRole('button', { name: 'Run LLM analysis' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LLM generation disabled' })).toBeDisabled();
    // analyzeArticle was never wired to anything (mock resolved value unused).
    expect(analyzeArticle).not.toHaveBeenCalled();
    // The combined text+image run is disabled since text analysis is excluded.
    const combined = screen.getByRole('button', { name: 'Analyze article + image' });
    expect(combined).toBeDisabled();
  });

  it('5. the exclusion reason is visible in the detail view', async () => {
    vi.mocked(listArticles).mockResolvedValue(liveResponse());
    vi.mocked(getArticle).mockResolvedValue(KI_ARTICLE);
    render(<NewsPage />);
    await screen.findByText('Обладнання для армії');

    const user = userEvent.setup();
    await user.click(screen.getByText('Festival decision reported'));

    await screen.findByText('Analysis unavailable for this article');
    // The status + reason appear in BOTH the NLP callout and the LLM panel callout.
    expect(screen.getAllByText('metadata_only').length).toBeGreaterThan(0);
    expect(screen.getAllByText('source_metadata_only').length).toBeGreaterThan(0);
    // Source name + language are shown in the detail header.
    expect(screen.getByText('The Kyiv Independent')).toBeInTheDocument();
    expect(screen.getByText('en')).toBeInTheDocument();
  });

  it('6. a FAILED source is distinguishable from a successful zero-article source', async () => {
    vi.mocked(listArticles).mockResolvedValue(liveResponse());
    vi.mocked(getArticle).mockResolvedValue(UK_ARTICLE);
    render(<NewsPage />);
    await screen.findByText('Обладнання для армії');

    const strip = await screen.findByTestId('source-status-strip');
    // Failed source: explicitly failed, with its reason.
    const unian = strip.querySelector('[data-source-status="unian"]');
    expect(unian).not.toBeNull();
    expect(unian?.textContent).toContain('feed unavailable');
    expect(unian?.textContent).toContain('connection timeout after 10s');
    // Successful-but-empty source: NOT failed wording.
    const empty = strip.querySelector('[data-source-status="slovidilo"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('0 articles');
    expect(empty?.textContent).toContain('feed reachable, no articles returned');
    expect(empty?.textContent).not.toContain('feed unavailable');
    // Successful source with articles.
    const ok = strip.querySelector('[data-source-status="pravda"]');
    expect(ok?.textContent).toContain('1 article');
    expect(ok?.textContent).not.toContain('feed unavailable');
  });

  it('7. Live/Demo behavior remains intact (demo switch, DEMO badges, no source strip)', async () => {
    const user = userEvent.setup();
    // First fetch = live, post-switch fetch = demo (backend-confirmed).
    vi.mocked(listArticles).mockResolvedValueOnce(liveResponse()).mockResolvedValueOnce(demoResponse());
    vi.mocked(getArticle).mockResolvedValue(UK_ARTICLE);
    vi.mocked(setAppMode).mockResolvedValueOnce({ mode: 'demo' });

    render(<NewsPage />);
    expect(await screen.findByText('Обладнання для армії')).toBeInTheDocument();
    expect(screen.getByText('Live RSS')).toBeInTheDocument();
    // Live mode shows the per-source strip.
    expect(screen.getByTestId('source-status-strip')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Demo' }));

    // The mode switch went through the existing backend endpoint ...
    expect(setAppMode).toHaveBeenCalledWith('demo', expect.anything());
    // ... and the list was re-fetched in the confirmed mode.
    await waitFor(() => {
      expect(listArticles).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('Demo Mode')).toBeInTheDocument();
    expect(screen.getByText('DEMO')).toBeInTheDocument();
    // Demo fixtures carry no source registry -> strip absent, no failed/false claims.
    expect(screen.queryByTestId('source-status-strip')).not.toBeInTheDocument();
    expect(screen.getByText('Демо новина')).toBeInTheDocument();
  });

  it('7b. stale mode keeps the cached-pass warning and labels sources as cached', async () => {
    vi.mocked(listArticles).mockResolvedValue(liveStaleResponse());
    vi.mocked(getArticle).mockResolvedValue(UK_ARTICLE);
    render(<NewsPage />);

    expect(await screen.findByText('Live news could not be loaded right now')).toBeInTheDocument();
    expect(screen.getByText('Cached (stale)')).toBeInTheDocument();
    expect(await screen.findByText('Обладнання для армії')).toBeInTheDocument();
    expect(screen.getByText('Cached (stale)')).toBeInTheDocument();
    // Per-source entries are labeled as describing the CACHED pass.
    const strip = screen.getByTestId('source-status-strip');
    expect(strip.textContent).toContain('cached');
    expect(strip.textContent).toContain('from cached pass');
  });
});
