"""Ingestion service (M2): live-default entry point (policy update 2026-11-01;
multi-source expansion 2026-11-08).

Modes (explicit in the result type, never inferred by callers):
- mode="live": fresh normalized live articles; `feed_used` names the feed URL
  of the FIRST successful source (registry order). Every enabled source is
  fetched independently; a failure in one source never prevents the others
  (task section 6.6) - per-source outcomes are recorded in `source_statuses`.
- mode="live_stale": the live fetch failed but the in-process cache still
  holds the previous SUCCESSFUL live result; those real articles are served
  unchanged (their own `retrieved_at` timestamps show when they were actually
  ingested) and `error` explains why this pass failed. Never demo data.
- mode="live_error": the live fetch failed and no cached live result exists;
  the article list is empty. Never demo data.
- mode="demo": EXPLICIT demo selection (POST /api/v1/mode). The M1 demo
  fixtures loaded unchanged via `app.data.demo.load_demo_articles`.
- "demo_fallback" is NO LONGER PRODUCED (the old silent substitution of failed
  live results with demo fixtures); the constant is kept only so older
  references do not break.

Multi-source rules (2026-11-08):
- sources come from `app.ingestion.source_registry` (approved configuration);
  UNN stays disabled and is never auto-activated on another source's failure;
- the existing Pravda adapter keeps its own feeds/behavior unchanged;
- cross-source dedup DROPS exact canonical-URL duplicates (first occurrence
  wins, registry order) and RECORDS near-duplicate headline fingerprints
  WITHOUT deleting them (event-grouping prep, `dedup_events`);
- a live failure must never surface demo fixtures as news (silent fallback
  removed per the 2026-11-01 live-default requirement; AGENTS.md rule 16
  demo-availability is preserved through the explicit demo mode instead);
- cached articles are ONLY previously successful LIVE results, never demo
  fixtures (the demo mode is a separate explicit branch that never caches);
- DemoDataError from the explicit demo branch still propagates (fixtures must
  exist for demo mode to run at all).
"""
from __future__ import annotations

import concurrent.futures
import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from app.config import AppConfig, load_config
from app.data.demo import load_demo_articles
from app.ingestion.dedup import (
    DUP_KIND_HEADLINE,
    DUP_KIND_URL,
    DedupEvent,
    headline_fingerprint,
    normalize_canonical_url,
)
from app.ingestion.pravda_adapter import fetch_pravda_articles
from app.ingestion.rss_fetch import FeedError, Fetcher, fetch_feed_bytes
from app.ingestion.source_adapter import SourceFetch, fetch_source_articles
from app.ingestion.source_registry import SourceSpec, load_source_registry
from app.models import Article

logger = logging.getLogger(__name__)

MODE_LIVE = "live"
MODE_LIVE_STALE = "live_stale"
MODE_LIVE_ERROR = "live_error"
MODE_DEMO = "demo"
# Deprecated vocabulary entry: produced in <2026-11-01 builds only, never by
# this implementation. Kept so existing imports keep working.
MODE_DEMO_FALLBACK = "demo_fallback"

STATUS_OK = "ok"
STATUS_ERROR = "error"


@dataclass(frozen=True)
class IngestResult:
    """Outcome of one ingestion pass (articles are immutable records)."""

    mode: str
    articles: tuple[Article, ...]
    feed_used: str | None
    error: str | None
    retrieved_at: datetime
    # --- additive multi-source fields (2026-11-08; defaulted for compat) ---
    source_statuses: tuple["SourceStatus", ...] = ()
    dedup_events: tuple[DedupEvent, ...] = ()


@dataclass(frozen=True)
class SourceStatus:
    """Independent per-source outcome for ONE ingestion pass (task 6.6).

    `retrieved_at` is the successful attempt's stamp (None on error); a source
    that errors in this pass has status="error" and its error text preserved
    verbatim - nothing about other sources' reachability is implied.
    """

    source_id: str
    display_name: str
    ingestion_mode: str
    status: str  # STATUS_OK or STATUS_ERROR
    article_count: int
    feed_url: str | None
    retrieved_at: datetime | None
    error: str | None


# --- In-process cache of the last successful live pass -----------------------
# Single-user local API; a plain Lock is enough. The cache holds ONLY whole
# successful live IngestResults (deep-frozen dataclass fields), so a stale
# serve can never mix demo fixtures with real articles.
_cache_lock = threading.Lock()
_last_live: IngestResult | None = None


def _store_live_result(result: IngestResult) -> None:
    global _last_live
    with _cache_lock:
        _last_live = result


def _cached_live_result() -> IngestResult | None:
    with _cache_lock:
        return _last_live


def clear_ingest_cache() -> None:
    """Drop the cached live result (used by tests and mode switches)."""
    global _last_live
    with _cache_lock:
        _last_live = None


def _fetch_one(
    spec: SourceSpec,
    config: AppConfig,
    *,
    fetcher: Fetcher,
    retrieved_at: datetime,
) -> SourceFetch:
    """Dispatch one source to its fetcher (pravda -> untouched legacy adapter)."""
    if spec.source_id == "pravda":
        legacy = fetch_pravda_articles(config, fetcher=fetcher, retrieved_at=retrieved_at)
        articles = tuple(
            article if article.source_id == spec.source_id
            else _stamp_source_id(article, spec)
            for article in legacy.articles
        )
        return SourceFetch(
            source_id=spec.source_id,
            display_name=spec.display_name,
            articles=articles,
            feed_url=legacy.feed_url,
            stats=legacy.stats,
            ingestion_mode="full_content",
        )
    return fetch_source_articles(
        spec, config, fetcher=fetcher, retrieved_at=retrieved_at
    )


def _stamp_source_id(article: Article, spec: SourceSpec) -> Article:
    """Additive attribution stamp for legacy-adapter articles.

    The legacy Pravda adapter predates the Slice A contract fields; the
    service-level stamp fills `source_id` and (since 2026-11-09, first
    observed by test_multisource_live_smoke) `source_language` from the
    registry spec so every served record carries the same attribution
    contract. The adapter's own behavior is unchanged.
    """
    import dataclasses

    updates: dict[str, str] = {"source_id": spec.source_id}
    if not (article.source_language or "").strip():
        updates["source_language"] = spec.language
    return dataclasses.replace(article, **updates)


def _cross_source_dedup(
    articles: tuple[Article, ...],
) -> tuple[tuple[Article, ...], tuple[DedupEvent, ...]]:
    """Exact canonical-URL drops + non-deleting headline fingerprints.

    - URL duplicates: the FIRST occurrence (registry order) is kept; later
      occurrences are dropped and recorded in `dedup_events` (kind=url).
    - headline fingerprints: recorded (kind=headline) whenever two records in
      the same pass share one; both records are RETAINED - same-event
      coverage from different publishers is preserved (event-grouping prep).
    """
    kept: list[Article] = []
    events: list[DedupEvent] = []
    seen_urls: dict[str, str] = {}
    seen_fingerprints: dict[str, str] = {}
    for article in articles:
        normalized = normalize_canonical_url(article.canonical_url)
        if normalized and normalized in seen_urls:
            events.append(
                DedupEvent(
                    kind=DUP_KIND_URL,
                    key=normalized,
                    dropped_article_id=article.id,
                    kept_article_id=seen_urls[normalized],
                    note="same canonical URL after normalization; later occurrence dropped",
                )
            )
            logger.debug("cross-source URL duplicate dropped: %s", article.id)
            continue
        fingerprint = headline_fingerprint(article.title)
        if fingerprint and fingerprint in seen_fingerprints:
            other_id = seen_fingerprints[fingerprint]
            if other_id != article.id:
                events.append(
                    DedupEvent(
                        kind=DUP_KIND_HEADLINE,
                        key=fingerprint,
                        dropped_article_id=None,  # non-deleting by design
                        kept_article_id=other_id,
                        note=(
                            "near-duplicate headline fingerprint; BOTH records "
                            "retained (event-grouping candidate)"
                        ),
                    )
                )
                logger.debug(
                    "near-dup headline recorded (both retained): %s ~ %s",
                    other_id, article.id,
                )
        if normalized:
            seen_urls[normalized] = article.id
        if fingerprint:
            seen_fingerprints.setdefault(fingerprint, article.id)
        kept.append(article)
    return tuple(kept), tuple(events)


def _fetch_all_sources(
    config: AppConfig,
    *,
    fetcher: Fetcher,
    retrieved_at: datetime,
) -> tuple[tuple[Article, ...], tuple[SourceStatus, ...]]:
    """Fetch every enabled source independently (bounded parallelism).

    Returns the merged article tuple (successful sources, registry order) and
    one SourceStatus per enabled source. All-failure shows up as simply having
    no articles - the caller turns that into the honest failure modes.
    """
    specs = [spec for spec in load_source_registry() if spec.enabled]

    def _attempt(spec: SourceSpec) -> tuple[SourceStatus, tuple[Article, ...]]:
        try:
            fetch = _fetch_one(spec, config, fetcher=fetcher, retrieved_at=retrieved_at)
        except FeedError as exc:
            logger.warning("source %s failed: %s", spec.source_id, exc)
            return SourceStatus(
                source_id=spec.source_id,
                display_name=spec.display_name,
                ingestion_mode=spec.ingestion_mode,
                status=STATUS_ERROR,
                article_count=0,
                feed_url=None,
                retrieved_at=None,
                error=str(exc),
            ), ()
        logger.info(
            "source %s ok: %d articles (%s)",
            spec.source_id, len(fetch.articles), fetch.feed_url,
        )
        return SourceStatus(
            source_id=spec.source_id,
            display_name=spec.display_name,
            ingestion_mode=fetch.ingestion_mode,
            status=STATUS_OK,
            article_count=len(fetch.articles),
            feed_url=fetch.feed_url,
            retrieved_at=retrieved_at,
            error=None,
        ), fetch.articles

    statuses: list[SourceStatus] = []
    merged: list[Article] = []
    if not specs:  # defensive: registry must never be empty
        raise FeedError("source registry resolved to zero enabled sources")
    max_workers = max(1, min(config.ingest_max_fetch_workers, len(specs)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(_attempt, spec) for spec in specs]
        for future in futures:
            status, articles = future.result()
            statuses.append(status)
            merged.extend(articles)
    return tuple(merged), tuple(statuses)


def get_articles(
    config: AppConfig | None = None,
    *,
    fetcher: Fetcher = fetch_feed_bytes,
    retrieved_at: datetime | None = None,
    use_cache: bool = True,
) -> IngestResult:
    """Fetch live articles from ALL enabled sources; honest failure modes.

    - `fetcher` is injectable so unit tests never touch the network;
    - `retrieved_at` is injectable for deterministic timestamps in tests;
    - `use_cache=False` skips both cache reads and writes (deterministic tests);
    - when no source yields articles, a cached previous success becomes
      mode="live_stale"; with no cache the mode is "live_error" and the
      article list is empty. Partial success (some sources failed) is still
      mode="live" with the failures recorded per source in `source_statuses`.
    """
    cfg = config or load_config()
    stamp = retrieved_at or datetime.now(timezone.utc)
    try:
        raw_articles, statuses = _fetch_all_sources(
            cfg, fetcher=fetcher, retrieved_at=stamp
        )
    except FeedError as exc:
        return _failure_result(
            error=str(exc), retrieved_at=stamp, use_cache=use_cache
        )
    return _finalize_live_result(
        cfg,
        raw_articles,
        statuses,
        retrieved_at=stamp,
        use_cache=use_cache,
    )


def _failure_result(
    *,
    error: str,
    retrieved_at: datetime,
    use_cache: bool,
) -> IngestResult:
    """Honest failure modes: cached live result -> live_stale, else live_error."""
    if use_cache:
        cached = _cached_live_result()
        if cached is not None and cached.mode == MODE_LIVE:
            logger.warning(
                "live ingestion failed (%s); serving %d cached live "
                "articles ingested at %s (mode=%s)",
                error,
                len(cached.articles),
                cached.retrieved_at.isoformat(),
                MODE_LIVE_STALE,
            )
            return IngestResult(
                mode=MODE_LIVE_STALE,
                articles=cached.articles,
                feed_used=cached.feed_used,
                error=error,
                retrieved_at=retrieved_at,
                source_statuses=cached.source_statuses,
                dedup_events=cached.dedup_events,
            )
    logger.warning("live ingestion unavailable (%s); no cached articles", error)
    return IngestResult(
        mode=MODE_LIVE_ERROR,
        articles=(),
        feed_used=None,
        error=error,
        retrieved_at=retrieved_at,
    )


def _finalize_live_result(
    config: AppConfig,
    raw_articles: tuple[Article, ...],
    statuses: tuple[SourceStatus, ...],
    *,
    retrieved_at: datetime,
    use_cache: bool,
) -> IngestResult:
    """Dedup, sort and package a (fully or partially) successful live pass."""
    if not raw_articles:
        failures = [
            f"{s.source_id}: {s.error}" for s in statuses if s.status == STATUS_ERROR
        ]
        return _failure_result(
            error="all enabled sources failed ("
            + ("; ".join(failures) or "none enabled") + ")",
            retrieved_at=retrieved_at,
            use_cache=use_cache,
        )
    deduped, dedup_events = _cross_source_dedup(raw_articles)
    # Sort by publication time, newest first (stable; aware datetimes are
    # mutually comparable). Records without published_at keep their feed
    # position at the end instead of crashing the comparison.
    _epoch_min = datetime.min.replace(tzinfo=timezone.utc)

    def _sort_key(article: Article) -> tuple[int, datetime]:
        if article.published_at is None:
            return (0, _epoch_min)
        return (1, article.published_at)

    articles = tuple(sorted(deduped, key=_sort_key, reverse=True))
    feed_used = next((s.feed_url for s in statuses if s.status == STATUS_OK and s.feed_url), None)
    result = IngestResult(
        mode=MODE_LIVE,
        articles=articles,
        feed_used=feed_used,
        error=None,
        retrieved_at=retrieved_at,
        source_statuses=statuses,
        dedup_events=dedup_events,
    )
    if use_cache:
        _store_live_result(result)
    logger.info(
        "live ingestion ok: %d articles (after dedup %d) from %d/%d sources%s%s",
        len(raw_articles),
        len(articles),
        sum(1 for s in statuses if s.status == STATUS_OK),
        len(statuses),
        "; failed: " + ", ".join(
            s.source_id for s in statuses if s.status == STATUS_ERROR
        ) if any(s.status == STATUS_ERROR for s in statuses) else "",
        f"; {len(dedup_events)} dedup events" if dedup_events else "",
    )
    return result


def get_demo_articles(
    config: AppConfig | None = None,
    *,
    retrieved_at: datetime | None = None,
) -> IngestResult:
    """Build the EXPLICIT demo-mode result from the M1 fixtures (never cached).

    DemoDataError propagates: demo fixtures must exist for demo mode at all.
    """
    cfg = config or load_config()
    stamp = retrieved_at or datetime.now(timezone.utc)
    demo = tuple(load_demo_articles(cfg, retrieved_at=stamp))
    logger.info("explicit demo mode: %d demo articles", len(demo))
    return IngestResult(
        mode=MODE_DEMO,
        articles=demo,
        feed_used=None,
        error=None,
        retrieved_at=stamp,
    )
