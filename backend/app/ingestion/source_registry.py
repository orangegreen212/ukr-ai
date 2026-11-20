"""Source registry for multi-source ingestion (2026-11-08 expansion).

Per the approved source-configuration policy (task section 6.1):
- the existing Ukrainska Pravda adapter keeps its own feeds and behavior
  untouched (see app.ingestion.pravda_adapter);
- seven Ukrainian sources are enabled by default (full_content ingestion);
- RBC-Ukraine is REGISTERED but DISABLED by default (owner decision
  2026-11-12: its only published feed is ~8.0 MB, 2.7x the ingest cap; never
  activated automatically — re-enable only via INGEST_ENABLED_SOURCES);
- The Kyiv Independent is metadata-only: headlines and references only, and
  its content is never routed to Ukrainian NLP/sentiment/NER processing;
- UNN is a verified reserve candidate: registered, but DISABLED by default and
  never activated automatically when another source fails.

Each entry records the registry fields equivalent to the task's schema:
source_id, display_name, publisher_domain, feed_urls, language, enabled,
ingestion_mode, analysis_eligibility, robots_checked_at, access_status, notes.
The access fields record the M0 verification STATE on 2026-11-08 (robots.txt
checked + HTTP 200 + excerpt metadata observed); they are an evidence bracket,
not a live guarantee - current reachability must be re-tested at runtime.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

from app.models import (
    INGESTION_FULL_CONTENT,
    INGESTION_METADATA_ONLY,
)

#: When robots.txt and reachability were actually verified for these entries.
ROBOTS_CHECKED_AT = "2026-11-08"

ACCESS_STATUS_VERIFIED = "verified_reachable"
ACCESS_STATUS_RESERVE = "verified_reserve"

# Analysis-eligibility declarations (source-level policy, per task 6.2).
ELIGIBILITY_ELIGIBLE = "eligible"
ELIGIBILITY_METADATA_ONLY = "metadata_only"

_KI_NOTE = (
    "Metadata-only per approved source configuration: headline + reference + "
    "timestamps + identified language are retained; NO excerpt/body is fetched "
    "or persisted, and content is never routed to Ukrainian NLP, sentiment, "
    "NER, summarization or News Intelligence processing."
)

_UNN_NOTE = (
    "Verified reserve candidate: registered with the same evidence bracket as "
    "the enabled sources but DISABLED by default; never activated "
    "automatically on another source's failure."
)


@dataclass(frozen=True)
class SourceSpec:
    """One registered news source (configuration, not runtime state)."""

    source_id: str
    display_name: str
    publisher_domain: str
    feed_urls: tuple[str, ...]
    language: str  # publisher's declared feed language, e.g. "uk"/"en"
    enabled: bool
    ingestion_mode: str  # INGESTION_FULL_CONTENT or INGESTION_METADATA_ONLY
    analysis_eligibility: str
    robots_checked_at: str
    access_status: str
    notes: str = ""

    def __post_init__(self) -> None:
        if not self.source_id.strip():
            raise ValueError("source_id_missing")
        if not self.display_name.strip():
            raise ValueError("display_name_missing")
        if not self.publisher_domain.strip():
            raise ValueError("publisher_domain_missing")
        if not self.feed_urls:
            raise ValueError("feed_urls_missing")
        if self.ingestion_mode not in (INGESTION_FULL_CONTENT, INGESTION_METADATA_ONLY):
            raise ValueError("unknown_ingestion_mode")
        if (
            self.ingestion_mode == INGESTION_METADATA_ONLY
            and self.analysis_eligibility != ELIGIBILITY_METADATA_ONLY
        ):
            raise ValueError("metadata_only_source_requires_metadata_only_eligibility")


def _uk_source(
    source_id: str,
    display_name: str,
    publisher_domain: str,
    feed_url: str,
    *,
    notes: str = "",
) -> SourceSpec:
    """Default-enabled Ukrainian full-content source (verified 2026-11-08)."""
    return SourceSpec(
        source_id=source_id,
        display_name=display_name,
        publisher_domain=publisher_domain,
        feed_urls=(feed_url,),
        language="uk",
        enabled=True,
        ingestion_mode=INGESTION_FULL_CONTENT,
        analysis_eligibility=ELIGIBILITY_ELIGIBLE,
        robots_checked_at=ROBOTS_CHECKED_AT,
        access_status=ACCESS_STATUS_VERIFIED,
        notes=notes,
    )


#: Registry order: pravda first (existing adapter), then the eight approved
#: Ukrainian sources, then the metadata-only source, then the disabled reserve.
_SOURCES: tuple[SourceSpec, ...] = (
    SourceSpec(
        source_id="pravda",
        display_name="Українська правда",
        publisher_domain="pravda.com.ua",
        # URLs are defaults mirrored from the AppConfig feed settings; the
        # pravda adapter itself keeps using the AppConfig values unchanged.
        feed_urls=("https://www.pravda.com.ua/rss/", "https://www.pravda.com.ua/rss/view_news/"),
        language="uk",
        enabled=True,
        ingestion_mode=INGESTION_FULL_CONTENT,
        analysis_eligibility=ELIGIBILITY_ELIGIBLE,
        robots_checked_at="2026-10-23",
        access_status=ACCESS_STATUS_VERIFIED,
        notes="Existing M2 integration; behavior unchanged by the 2026-11-08 expansion.",
    ),
    _uk_source(
        "unian",
        "УНІАН",
        "unian.net",
        "https://rss.unian.net/site/news_ukr.rss",
        notes="Publisher-documented RSS host (rss.unian.net); verified reachability 2026-11-08.",
    ),
    _uk_source(
        "oboz",
        "OBOZ.ua",
        "obozrevatel.com",
        "https://www.obozrevatel.com/ukr/out/rss/lastnews.xml",
    ),
    _uk_source(
        "glavcom",
        "Главком",
        "glavcom.ua",
        "https://glavcom.ua/xml/rss.xml",
    ),
    _uk_source(
        "slovo_i_dilo",
        "Слово і діло",
        "slovoidilo.ua",
        "https://www.slovoidilo.ua/rss.xml",
    ),
    _uk_source(
        "tsn",
        "ТСН",
        "tsn.ua",
        "https://tsn.ua/rss/full.rss",
    ),
    _uk_source(
        "liga_net",
        "LIGA.net",
        "liga.net",
        "https://www.liga.net/news/all/rss.xml",
    ),
    _uk_source(
        "nv",
        "НВ",
        "nv.ua",
        "https://nv.ua/ukr/rss/all.xml",
    ),
    SourceSpec(
        source_id="kyivindependent",
        display_name="The Kyiv Independent",
        publisher_domain="kyivindependent.com",
        feed_urls=("https://kyivindependent.com/feed/rss/",),
        language="en",
        enabled=True,
        ingestion_mode=INGESTION_METADATA_ONLY,
        analysis_eligibility=ELIGIBILITY_METADATA_ONLY,
        robots_checked_at=ROBOTS_CHECKED_AT,
        access_status=ACCESS_STATUS_VERIFIED,
        notes=_KI_NOTE,
    ),
    SourceSpec(
        source_id="rbc_ukraine",
        display_name="RBC-Україна",
        publisher_domain="rbc.ua",
        feed_urls=("https://www.rbc.ua/static/rss/all.ukr.rss.xml",),
        language="uk",
        # Owner decision 2026-11-12: removed from the DEFAULT ingestion set.
        # Evidence (measured 2026-11-12): the ONLY published feed
        # (all.ukr.rss.xml) is ~8.0 MB — 2.7x the 3 MiB ingest cap; no
        # smaller/section feed exists (probed alternates return 404;
        # robots.txt allows /static/rss/*). Ingest runs on EVERY /articles
        # pass (no TTL throttle), so raising the cap would fetch 8 MB per
        # request. Registered reserve: never auto-activated; re-enable ONLY
        # via INGEST_ENABLED_SOURCES=rbc_ukraine, and only after the
        # publisher offers a smaller feed or a per-source cap + throttle is
        # designed with explicit owner approval.
        enabled=False,
        ingestion_mode=INGESTION_FULL_CONTENT,
        analysis_eligibility=ELIGIBILITY_ELIGIBLE,
        robots_checked_at=ROBOTS_CHECKED_AT,
        access_status=ACCESS_STATUS_RESERVE,
        notes="Disabled 2026-11-12 by owner decision (feed size vs ingest cap; see comment above).",
    ),
    SourceSpec(
        source_id="unn",
        display_name="УНН",
        publisher_domain="unn.com.ua",
        feed_urls=("https://www.unn.com.ua/rss/news_uk.xml",),
        language="uk",
        enabled=False,
        ingestion_mode=INGESTION_FULL_CONTENT,
        analysis_eligibility=ELIGIBILITY_ELIGIBLE,
        robots_checked_at=ROBOTS_CHECKED_AT,
        access_status=ACCESS_STATUS_RESERVE,
        notes=_UNN_NOTE,
    ),
)


def _parse_id_list(raw: str | None) -> tuple[str, ...]:
    if raw is None:
        return ()
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def load_source_registry(env: Mapping[str, str] | None = None) -> tuple[SourceSpec, ...]:
    """Return the source registry with env overrides applied.

    Overrides (comma-separated source IDs, unknown IDs are ignored with a
    logged note):
    - `INGEST_ENABLED_SOURCES`: force BOTH extra sources and the reserve on
      (e.g. INGEST_ENABLED_SOURCES=unn enables the disabled reserve);
    - `INGEST_DISABLED_SOURCES`: force sources off (e.g. disable pravda).

    The overrides are an operator/debug affordance ON TOP of the approved
    defaults; the shipped registry defaults always remain the approved set.
    Unknown source IDs never raise, never activate anything.
    """
    e: Mapping[str, str] = os.environ if env is None else env
    force_enabled = _parse_id_list(e.get("INGEST_ENABLED_SOURCES"))
    force_disabled = _parse_id_list(e.get("INGEST_DISABLED_SOURCES"))
    known_ids = {spec.source_id for spec in _SOURCES}
    result: list[SourceSpec] = []
    for spec in _SOURCES:
        enabled = spec.enabled
        if spec.source_id in force_disabled:
            enabled = False
        if spec.source_id in force_enabled:
            enabled = True
        if enabled != spec.enabled:
            result.append(_override_enabled(spec, enabled))
        else:
            result.append(spec)
    import logging

    logger = logging.getLogger(__name__)
    for source_id in (*force_enabled, *force_disabled):
        if source_id not in known_ids:
            logger.warning("registry override names unknown source %r (ignored)", source_id)
    return tuple(result)


def _override_enabled(spec: SourceSpec, enabled: bool) -> SourceSpec:
    """Rebuild a frozen spec with a new enabled flag (identical otherwise)."""
    override = {
        "source_id": spec.source_id,
        "display_name": spec.display_name,
        "publisher_domain": spec.publisher_domain,
        "feed_urls": spec.feed_urls,
        "language": spec.language,
        "enabled": enabled,
        "ingestion_mode": spec.ingestion_mode,
        "analysis_eligibility": spec.analysis_eligibility,
        "robots_checked_at": spec.robots_checked_at,
        "access_status": spec.access_status,
        "notes": spec.notes,
    }
    return SourceSpec(**override)


def enabled_sources(env: Mapping[str, str] | None = None) -> tuple[SourceSpec, ...]:
    """Convenience: the enabled slice of the registry (env-aware)."""
    return tuple(spec for spec in load_source_registry(env=env) if spec.enabled)
