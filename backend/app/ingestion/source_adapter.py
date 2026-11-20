"""Generic registry-driven RSS adapter (2026-11-08 multi-source expansion).

One code path for every registered source (no per-source behavior scattered
through the pipeline - task section 6.2). The frozen `SourceSpec` selects the
ingestion mode:

- `full_content` (the eight approved Ukrainian sources): same content policy
  as the existing Pravda adapter - excerpt-only storage, Cyrillic presence
  gate (an initial scope filter, not a Ukrainian verifier), deterministic
  SHA-based IDs, within-feed first-occurrence-wins dedup. Each item is
  stamped with `source_id`/`source_name` attribution and `source_language`
  from the feed's declared channel language (falling back to the registry
  entry), so article-level language provenance is preserved.

- `metadata_only` (The Kyiv Independent): ONLY headline + canonical URL +
  timestamps + identified language are retained. No excerpt and no body is
  fetched or persisted, and every item is created with
  `analysis_status="metadata_only"` (section 6.5) - it can exist in the
  Article model while structurally never entering the Ukrainian NLP path.

Failure behavior mirrors the existing adapter contract: exactly one attempt
per configured feed URL (no retries), then `FeedUnavailableError` - the
service layer isolates this per source (section 6.6) and never substitutes
another publisher or demo data.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping

from app.config import AppConfig, load_config
from app.ingestion.dedup import normalize_canonical_url
from app.ingestion.pravda_adapter import _looks_cyrillic, clean_excerpt
from app.ingestion.rss_fetch import (
    FeedError,
    FeedUnavailableError,
    Fetcher,
    fetch_feed_bytes,
)
from app.ingestion.rss_parser import RssItem, parse_pub_date, parse_rss
from app.models import (
    ANALYSIS_METADATA_ONLY,
    INGESTION_FULL_CONTENT,
    INGESTION_METADATA_ONLY,
    REASON_SOURCE_METADATA_ONLY,
    Article,
)
from app.ingestion.source_registry import SourceSpec

logger = logging.getLogger(__name__)

_USAGE_PATTERN = (
    "Фрагмент (обрізаний) з RSS «{name}»; повний текст — за canonical_url; "
    "лише метадані, не для поширення."
)
_METADATA_NOTE_PATTERN = (
    "Лише метадані (джерело metadata-only): заголовок і посилання з RSS "
    "«{name}». Текст і фрагмент не отримуються та не зберігаються; вміст не "
    "передається в українську NLP-обробку."
)


@dataclass
class SourceIngestStats:
    """Per-source normalization counters (same shape as the Pravda IngestStats)."""

    items_seen: int = 0
    published: int = 0
    rejected_missing_title: int = 0
    rejected_missing_body: int = 0
    rejected_missing_canonical: int = 0
    rejected_not_cyrillic: int = 0
    rejected_duplicate: int = 0
    truncated_by_item_cap: int = 0

    def as_dict(self) -> dict[str, int]:
        return dict(self.__dict__)


@dataclass(frozen=True)
class SourceFetch:
    """Successful per-source result: normalized articles plus provenance."""

    source_id: str
    display_name: str
    articles: tuple[Article, ...]
    feed_url: str
    stats: Mapping[str, int]
    ingestion_mode: str


def _base_language(tag: str | None) -> str:
    """Base subtag of a BCP-47/RFC- language tag: "en-US" -> "en"."""
    if not tag or not tag.strip():
        return ""
    return tag.strip().split("-", 1)[0].lower()


def _pick_canonical(guid: str | None, link: str | None) -> str | None:
    """Canonical URL: first of guid/link that looks like an http(s) URL."""
    for candidate in (guid, link):
        if candidate and candidate.strip().lower().startswith(("http://", "https://")):
            return candidate.strip()
    return None


def _clean_excerpt(raw: str | None, max_chars: int) -> str:
    """Delegate to the Pravda excerpt cleaner (single implementation, reused)."""
    return clean_excerpt(raw, max_chars)


def _looks_cyrillic_text(text: str) -> bool:
    """Delegated lenient Cyrillic gate (same rule as the Pravda adapter)."""
    return _looks_cyrillic(text)


def _normalize_full_content(
    items: list[RssItem],
    *,
    spec: SourceSpec,
    config: AppConfig,
    source_url: str,
    retrieved_at: datetime,
    source_language: str,
) -> tuple[tuple[Article, ...], SourceIngestStats]:
    """Same normalization rules as `_normalize_items` in the Pravda adapter.

    Differences: items are pre-sliced by the per-source item cap, IDs carry the
    registry source_id prefix, and attribution/processing fields are stamped
    (source_id, source_name, source_language, resolved analysis_status).
    """
    stats = SourceIngestStats(items_seen=len(items))
    articles: list[Article] = []
    seen_urls: set[str] = set()
    seen_hashes: set[str] = set()
    usage_note = _USAGE_PATTERN.format(name=spec.display_name)
    for index, item in enumerate(items):
        title = (item.title or "").strip()
        if not title:
            stats.rejected_missing_title += 1
            continue
        excerpt = _clean_excerpt(
            item.content_encoded or item.description,
            config.ingest_max_excerpt_chars,
        )
        if not excerpt:
            stats.rejected_missing_body += 1
            continue
        canonical = _pick_canonical(item.guid, item.link)
        if not canonical:
            stats.rejected_missing_canonical += 1
            continue
        if not _looks_cyrillic_text(f"{title}\n{excerpt}"):
            stats.rejected_not_cyrillic += 1
            continue
        normalized_url = normalize_canonical_url(canonical)
        if not normalized_url or normalized_url in seen_urls:
            stats.rejected_duplicate += 1
            continue
        article_id = f"{spec.source_id}-{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:12]}"
        article = Article(
            id=article_id,
            title=title,
            text=None,  # full bodies are never stored (M2 policy)
            summary=excerpt,
            source_name=spec.display_name,
            source_url=source_url,
            canonical_url=canonical,
            published_at=parse_pub_date(item.pub_date_raw),
            retrieved_at=retrieved_at,
            language="uk",  # Cyrillic-gate decision (documented, not proof)
            image_url=item.image_url,
            is_demo_data=False,
            usage_note=usage_note,
            source_id=spec.source_id,
            source_language=source_language,
            # auto -> resolved at construction; "uk" + full_content = eligible
        )
        if article.content_hash in seen_hashes:
            stats.rejected_duplicate += 1
            continue
        seen_urls.add(normalized_url)
        seen_hashes.add(article.content_hash)
        articles.append(article)
        stats.published += 1
        logger.debug(
            "source %s item #%d normalized -> %s", spec.source_id, index, article_id
        )
    return tuple(articles), stats


def _normalize_metadata_only(
    items: list[RssItem],
    *,
    spec: SourceSpec,
    source_url: str,
    retrieved_at: datetime,
    source_language: str,
) -> tuple[tuple[Article, ...], SourceIngestStats]:
    """Headline + reference records: NO excerpt/body, `metadata_only` status.

    The identified language comes from the feed channel (parsed independently
    of the publisher's default); unknown/missing stays `pending_validation`.
    """
    stats = SourceIngestStats(items_seen=len(items))
    articles: list[Article] = []
    seen_urls: set[str] = set()
    usage_note = _METADATA_NOTE_PATTERN.format(name=spec.display_name)
    for index, item in enumerate(items):
        title = (item.title or "").strip()
        if not title:
            stats.rejected_missing_title += 1
            continue
        canonical = _pick_canonical(item.guid, item.link)
        if not canonical:
            stats.rejected_missing_canonical += 1
            continue
        normalized_url = normalize_canonical_url(canonical)
        if not normalized_url or normalized_url in seen_urls:
            stats.rejected_duplicate += 1
            continue
        articles.append(
            Article(
                id=f"{spec.source_id}-{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:12]}",
                title=title,
                text=None,
                summary=None,  # metadata-only: NO excerpt, NO body (section 6.5)
                source_name=spec.display_name,
                source_url=source_url,
                canonical_url=canonical,
                published_at=parse_pub_date(item.pub_date_raw),
                retrieved_at=retrieved_at,
                language=source_language,  # identified from the feed channel
                image_url=item.image_url,
                is_demo_data=False,
                usage_note=usage_note,
                source_id=spec.source_id,
                source_language=source_language,
                analysis_status=ANALYSIS_METADATA_ONLY,  # explicit, never auto
                analysis_exclusion_reason=REASON_SOURCE_METADATA_ONLY,
            )
        )
        stats.published += 1
    return tuple(articles), stats


def fetch_source_articles(
    spec: SourceSpec,
    config: AppConfig | None = None,
    *,
    fetcher: Fetcher = fetch_feed_bytes,
    retrieved_at: datetime | None = None,
) -> SourceFetch:
    """Fetch + normalize ONE registered source (independent of all others).

    - exactly one attempt per configured feed URL, first success wins;
    - HTTP/parse failures OR "zero valid items" advance to the next configured
      URL; if every URL fails, `FeedUnavailableError` is raised (no retries,
      no fallback to another publisher, never demo data);
    - the per-source item cap (`config.ingest_source_max_items`) bounds a
      high-volume feed so no publisher dominates the combined result.
    """
    cfg = config or load_config()
    stamp = retrieved_at or datetime.now(timezone.utc)
    source_language = _base_language(spec.language)
    failures: list[str] = []
    for feed_url in spec.feed_urls:
        try:
            payload = fetcher(
                feed_url,
                user_agent=cfg.ingest_user_agent,
                timeout=(cfg.ingest_timeout_connect, cfg.ingest_timeout_read),
                max_bytes=cfg.ingest_max_bytes,
            )
        except FeedError as exc:
            failures.append(f"{feed_url}: {exc}")
            logger.warning("source %s fetch failed: %s", spec.source_id, exc)
            continue
        try:
            parsed = parse_rss(payload)
        except FeedError as exc:
            failures.append(f"{feed_url}: {exc}")
            logger.warning("source %s parse failed: %s", spec.source_id, exc)
            continue
        # Feed channel language is the IDENTIFIED language for metadata-only
        # items (never inferred from the publisher being Ukrainian).
        identified = _base_language(parsed.channel_language) or source_language
        capped = list(parsed.items)
        pre_cap = len(capped)
        cap = cfg.ingest_source_max_items
        if pre_cap > cap:
            capped = capped[:cap]
            logger.info(
                "source %s: %d feed items capped to %d", spec.source_id, pre_cap, cap
            )
        if spec.ingestion_mode == INGESTION_FULL_CONTENT:
            articles, stats = _normalize_full_content(
                capped,
                spec=spec,
                config=cfg,
                source_url=feed_url,
                retrieved_at=stamp,
                source_language=identified,
            )
        elif spec.ingestion_mode == INGESTION_METADATA_ONLY:
            articles, stats = _normalize_metadata_only(
                capped,
                spec=spec,
                source_url=feed_url,
                retrieved_at=stamp,
                source_language=identified,
            )
        else:  # unreachable: SourceSpec validates the mode
            raise ValueError("unknown_ingestion_mode")
        if pre_cap > len(capped):
            # the cap happened BEFORE normalization; fold it into the stats
            stats.truncated_by_item_cap = pre_cap - len(capped)
            stats.items_seen = pre_cap
        if not articles:
            failures.append(
                f"{feed_url}: no valid items after normalization ({stats.as_dict()})"
            )
            logger.warning("no valid items for source %s from %s", spec.source_id, feed_url)
            continue
        return SourceFetch(
            source_id=spec.source_id,
            display_name=spec.display_name,
            articles=articles,
            feed_url=feed_url,
            stats=stats.as_dict(),
            ingestion_mode=spec.ingestion_mode,
        )
    raise FeedUnavailableError(
        f"all feeds failed for source '{spec.source_id}'; " + "; ".join(failures)
    )
