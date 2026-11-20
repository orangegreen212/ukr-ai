"""Pravda RSS adapter (M2): fetch -> parse -> normalize -> dedup -> language gate.

Compliance posture (checked in M0 on 2026-10-23, see docs/ingestion.md):
- only the two publisher-documented feed paths under pravda.com.ua; their
  robots.txt contains no /rss disallow. Suspilne is excluded (robots.txt has
  `Disallow: /rss*` for `User-agent: *`); no other feeds, no access-control
  bypass, no retry storms.

Content policy:
- excerpt-only storage: `content:encoded` bodies are never persisted; the
  excerpt is tag-stripped, entity-decoded, whitespace-collapsed and hard-
  truncated at `config.ingest_max_excerpt_chars` (default 600);
- image URLs are stored as metadata only, never downloaded in M2;
- IDs are deterministic (`pravda-<sha256(canonical)[:12]>`); dedup keys are
  the canonical URL and the content hash, first occurrence wins.

Language gate (approved lenient rule): an item is retained when its title or
excerpt contains at least one Cyrillic character. This is an initial scope
filter ONLY - it cannot reliably distinguish Ukrainian from Russian.
"""
from __future__ import annotations

import hashlib
import html
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping

from app.config import AppConfig, load_config
from app.ingestion.rss_fetch import (
    FeedError,
    FeedUnavailableError,
    Fetcher,
    fetch_feed_bytes,
)
from app.ingestion.rss_parser import RssItem, parse_pub_date, parse_rss
from app.models import Article

logger = logging.getLogger(__name__)

SOURCE_NAME = "Українська правда"
USAGE_NOTE = (
    "Фрагмент (обрізаний) з RSS «Української правди»; повний текст — за "
    "canonical_url; лише метадані, не для поширення."
)

_TAG_RE = re.compile(r"<[^>]+>")
_CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]")


def clean_excerpt(raw: str | None, max_chars: int) -> str:
    """Strip tags, decode entities, collapse whitespace, hard-truncate to max_chars.

    Note: decoding happens after tag stripping, so a decoded `<` (from `&lt;`)
    may remain as a literal character; it is inert text, not markup.
    """
    if not raw:
        return ""
    text = html.unescape(_TAG_RE.sub(" ", raw))
    text = " ".join(text.split())
    if len(text) > max_chars:
        text = text[:max_chars].rstrip()
    return text


def _pick_canonical(guid: str | None, link: str | None) -> str | None:
    """Canonical URL: first of guid/link that looks like an http(s) URL."""
    for candidate in (guid, link):
        if candidate and candidate.strip().lower().startswith(("http://", "https://")):
            return candidate.strip()
    return None


def _looks_cyrillic(text: str) -> bool:
    """True when at least one Cyrillic character is present (lenient gate)."""
    return bool(_CYRILLIC_RE.search(text))


@dataclass
class IngestStats:
    """Per-feed normalization counters (used by tests and the live smoke report)."""

    items_seen: int = 0
    published: int = 0
    rejected_missing_title: int = 0
    rejected_missing_body: int = 0
    rejected_missing_canonical: int = 0
    rejected_not_cyrillic: int = 0
    rejected_duplicate: int = 0

    def as_dict(self) -> dict[str, int]:
        return dict(self.__dict__)


@dataclass(frozen=True)
class PravdaFetch:
    """Successful adapter result: normalized articles plus provenance."""

    articles: tuple[Article, ...]
    feed_url: str
    stats: Mapping[str, int]


def _normalize_items(
    items: list[RssItem],
    *,
    config: AppConfig,
    source_url: str,
    retrieved_at: datetime,
) -> tuple[tuple[Article, ...], IngestStats]:
    """Normalize raw items to the M1 Article schema; malformed items are skipped."""
    stats = IngestStats(items_seen=len(items))
    articles: list[Article] = []
    seen_urls: set[str] = set()
    seen_hashes: set[str] = set()
    for index, item in enumerate(items):
        title = (item.title or "").strip()
        if not title:
            stats.rejected_missing_title += 1
            logger.debug("item #%d rejected: missing title", index)
            continue
        # content:encoded would be the full body - it is only used as the excerpt
        # source and never stored (600-char cap applies either way).
        excerpt = clean_excerpt(
            item.content_encoded or item.description,
            config.ingest_max_excerpt_chars,
        )
        if not excerpt:
            stats.rejected_missing_body += 1
            logger.debug("item #%d rejected: empty excerpt", index)
            continue
        canonical = _pick_canonical(item.guid, item.link)
        if not canonical:
            stats.rejected_missing_canonical += 1
            logger.debug("item #%d rejected: no http guid/link", index)
            continue
        if not _looks_cyrillic(f"{title}\n{excerpt}"):
            stats.rejected_not_cyrillic += 1
            logger.debug("item #%d rejected: no Cyrillic character (lenient gate)", index)
            continue
        if canonical in seen_urls:
            stats.rejected_duplicate += 1
            continue
        generated_id = "pravda-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]
        article = Article(
            id=generated_id,
            title=title,
            text=None,  # full bodies are never stored (M2 policy)
            summary=excerpt,
            source_name=SOURCE_NAME,
            source_url=source_url,
            canonical_url=canonical,
            published_at=parse_pub_date(item.pub_date_raw),
            retrieved_at=retrieved_at,
            language="uk",  # gate decision, recorded honestly in docs (not proof)
            image_url=item.image_url,  # metadata only, no download
            is_demo_data=False,
            usage_note=USAGE_NOTE,
        )
        if article.content_hash in seen_hashes:
            stats.rejected_duplicate += 1
            continue
        seen_urls.add(canonical)
        seen_hashes.add(article.content_hash)
        articles.append(article)
        stats.published += 1
        logger.debug("item #%d normalized -> %s", index, generated_id)
    return tuple(articles), stats


def fetch_pravda_articles(
    config: AppConfig | None = None,
    *,
    fetcher: Fetcher = fetch_feed_bytes,
    retrieved_at: datetime | None = None,
) -> PravdaFetch:
    """Fetch and normalize the primary feed; on failure try the secondary once.

    Exactly one attempt per configured feed (no retries). If both feeds fail -
    including "fetched but zero valid items" - raises `FeedUnavailableError`
    whose message aggregates both errors. Offline tests inject a fake fetcher;
    the real fetcher is only used at runtime / in the opt-in live smoke test.
    """
    cfg = config or load_config()
    stamp = retrieved_at or datetime.now(timezone.utc)
    failures: list[str] = []
    for feed_url in (cfg.feed_url_primary, cfg.feed_url_secondary):
        try:
            payload = fetcher(
                feed_url,
                user_agent=cfg.ingest_user_agent,
                timeout=(cfg.ingest_timeout_connect, cfg.ingest_timeout_read),
                max_bytes=cfg.ingest_max_bytes,
            )
        except FeedError as exc:
            failures.append(f"{feed_url}: {exc}")
            logger.warning("feed fetch failed: %s", exc)
            continue
        try:
            parsed = parse_rss(payload)
        except FeedError as exc:
            failures.append(f"{feed_url}: {exc}")
            logger.warning("feed parse failed for %s: %s", feed_url, exc)
            continue
        articles, stats = _normalize_items(
            parsed.items, config=cfg, source_url=feed_url, retrieved_at=stamp
        )
        if not articles:
            failures.append(f"{feed_url}: no valid items after normalization ({stats.as_dict()})")
            logger.warning("no valid items from %s", feed_url)
            continue
        return PravdaFetch(articles=articles, feed_url=feed_url, stats=stats.as_dict())
    raise FeedUnavailableError(
        "both configured feeds failed; " + "; ".join(failures)
    )
