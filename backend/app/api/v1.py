"""Versioned API (M5): `/api/v1/*` router + response schemas.

Implemented scope:
- `GET /api/v1/health`, `GET /api/v1/articles`, `GET /api/v1/articles/{id}`:
  M5 Phase 1 (read-only article serving).
- `POST /api/v1/articles/{article_id}/analysis`: M5 Phase 2 text-only NLP
  (sentiment + NER) — registered from `app/api/analysis.py`, which owns all
  its lazy-init/locking logic; importing `app.api.v1` does NOT import any
  model adapter module.

Data-mode selection (2026-11-01): the app serves LIVE RSS by default.
`GET /api/v1/mode` reports the serving mode; `POST /api/v1/mode` with
`{"mode": "demo"}` switches to the explicit demo fixtures, `{"mode": "live"}`
switches back. The selection is in-process (single-user local app) and applies
to every endpoint that resolves articles through `get_ingest_result()`.
"""
from __future__ import annotations

import logging
import threading
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.analysis import register_analysis_routes
from app.api.errors import ApiError
from app.api.health import HealthPayload, _demo_snapshot
from app.config import AppConfig, load_config
from app.ingestion.service import (
    IngestResult,
    MODE_DEMO,
    MODE_LIVE,
    MODE_LIVE_ERROR,
    MODE_LIVE_STALE,
    MODE_DEMO_FALLBACK,
    get_articles,
    get_demo_articles,
)

DEFAULT_ARTICLES_LIMIT = 50
MAX_ARTICLES_LIMIT = 200

logger = logging.getLogger(__name__)


class ArticleOut(BaseModel):
    """One normalized article record — field names are exactly the frozen
    `Article.to_dict()` keys (`app/models.py`); no invented fields."""

    id: str
    title: str
    text: str | None
    summary: str | None
    source_name: str | None
    source_url: str | None
    canonical_url: str | None
    published_at: str | None
    retrieved_at: str | None
    language: str
    image_url: str | None
    content_hash: str | None
    is_demo_data: bool
    usage_note: str | None
    # --- multi-source additive fields (Slice B, 2026-11-09) ---
    source_id: str | None = None
    source_language: str = ""
    analysis_status: str | None = None
    analysis_exclusion_reason: str | None = None


class SourceStatusOut(BaseModel):
    """One enabled source's outcome for the current ingestion pass — mirrors
    `app.ingestion.service.SourceStatus` field-for-field (no parallel registry).
    `error` is the per-source one-line failure reason (no stack traces; the
    feed URL is operator-visible data, already exposed via `feed_used`).
    Disabled sources (e.g. the UNN reserve) are never listed here."""

    source_id: str
    display_name: str
    ingestion_mode: str
    status: str
    article_count: int
    feed_url: str | None = None
    retrieved_at: str | None = None
    error: str | None = None
    stale: bool = False


class ArticlesResponse(BaseModel):
    """Record list: `mode` is `live`, `demo`, `live_stale`, `live_error` (or
    the legacy `demo_fallback` in older records) exactly as produced by the
    ingestion service; `error` is a STATIC safe phrase in failed-live runs
    (`live_feed_unavailable`), never the raw feed error text.

    `sources` (Slice B, additive): per-source outcomes of the pass. `demo`
    mode carries an EMPTY list (fixtures have no source registry). In
    `live_stale` the statuses describe the CACHED pass that produced the
    served articles, each flagged `stale=True`."""

    mode: str
    feed_used: str | None
    count: int
    articles: list[ArticleOut]
    error: str | None = None
    sources: list[SourceStatusOut] = []


def _source_statuses_out(result: IngestResult, *, stale: bool | None = None) -> list[SourceStatusOut]:
    """Map the service's frozen SourceStatus records to the additive response
    model. `stale=None` derives the flag from the serving mode instead of
    forcing it."""
    if stale is None:
        stale = result.mode == MODE_LIVE_STALE
    return [
        SourceStatusOut(
            source_id=s.source_id,
            display_name=s.display_name,
            ingestion_mode=s.ingestion_mode,
            status=s.status,
            article_count=s.article_count,
            feed_url=s.feed_url,
            retrieved_at=s.retrieved_at.isoformat() if s.retrieved_at else None,
            error=_limit_source_error(s.error),
            stale=stale,
        )
        for s in result.source_statuses
    ]


_SOURCE_ERROR_MAX_CHARS = 300


def _limit_source_error(error: str | None) -> str | None:
    """One-line, size-capped per-source reason (never a stack trace)."""
    if not error:
        return None
    flat = " ".join(str(error).split())
    if len(flat) > _SOURCE_ERROR_MAX_CHARS:
        return flat[:_SOURCE_ERROR_MAX_CHARS].rstrip() + "…"
    return flat


# --- Data mode (live default / explicit demo) --------------------------------


class AppModePayload(BaseModel):
    """Serving mode selection. `live` = real RSS (default), `demo` = the
    synthetic M1 fixtures, selected explicitly."""

    mode: Literal["live", "demo"]


_mode_lock = threading.Lock_
_selected_mode: Literal["live", "demo"] = MODE_LIVE  # app default: live RSS


def current_serving_mode() -> Literal["live", "demo"]:
    """Configured data-mode selection (in-process state, default `live`)."""
    with _mode_lock:
        return _selected_mode


def build_health_payload(config: AppConfig) -> HealthPayload:
    """Single source for BOTH `/health` and `/api/v1/health` — mirrors the M1
    handler in `app/api/health.py` field-for-field, no behavior change."""
    demo_ok, demo_count, demo_error = _demo_snapshot(config)
    return HealthPayload(
        app=config.app_name,
        version=config.app_version,
        demo_ok=demo_ok,
        demo_articles=demo_count,
        demo_error=demo_error,
        lm_studio_enabled=config.lm_studio_usable(),
        live_feed_configured=config.feed_url_primary.startswith("http"),
    )


def get_ingest_result() -> IngestResult:
    """Ingestion provider seam: resolves config per request (env-backed) and
    performs one pass for the SELECTED data mode — live by default, demo
    fixtures only after an explicit POST /api/v1/mode switch. Tests
    monkeypatch this module attribute — the offline tests never touch the
    network."""
    if current_serving_mode() == MODE_DEMO:
        return get_demo_articles()
    return get_articles()


def _project_article(article: object) -> ArticleOut:
    """Frozen contract -> response model via the already-normalized dict."""
    return ArticleOut.model_validate(article.to_dict())  # type: ignore[attr-defined]


def _sanitize_live_error(result: IngestResult) -> str | None:
    """Raw feed errors are logged by the service; clients get one static phrase.

    Applies to every honestly-failed live vocabulary entry (`live_error`,
    `live_stale`, and the legacy `demo_fallback` shape faked by older tests).
    """
    if result.mode not in (MODE_LIVE_ERROR, MODE_LIVE_STALE, MODE_DEMO_FALLBACK):
        return None
    if result.error is None:
        return None
    return "live_feed_unavailable"


def build_v1_router() -> APIRouter:
    """Versioned router (read-only resources + the explicit data-mode toggle)."""
    router = APIRouter(prefix="/api/v1")
    @router.get("/health", response_model=HealthPayload, tags=["system"])
    def v1_health() -> HealthPayload:
        return build_health_payload(load_config())

    @router.get("/mode", response_model=AppModePayload, tags=["system"])
    def get_app_mode() -> AppModePayload:
        return AppModePayload(mode=current_serving_mode())

    @router.post("/mode", response_model=AppModePayload, tags=["system"])
    def set_app_mode(payload: AppModePayload) -> AppModePayload:
        global _selected_mode
        with _mode_lock:
            if _selected_mode != payload.mode:
                _selected_mode = payload.mode
                # A mode switch invalidates the cached live result only in the
                # sense of the demo branch; the live cache stays valid and is
                # still used for live_stale serving after feed outages.
                logger.info("data mode switched to %s by request", payload.mode)
        return AppModePayload(mode=payload.mode)

    @router.get("/articles", response_model=ArticlesResponse, tags=["articles"])
    def list_articles(
        limit: int = Query(
            default=DEFAULT_ARTICLES_LIMIT, ge=1, le=MAX_ARTICLES_LIMIT
        ),
    ) -> ArticlesResponse:
        # FastAPI validates `limit` before the endpoint body runs, so the
        # ingestion provider is never invoked for an invalid request.
        result = get_ingest_result()
        page = result.articles[:limit]
        return ArticlesResponse(
            mode=result.mode,
            feed_used=result.feed_used,
            count=len(page),
            articles=[_project_article(article) for article in page],
            error=_sanitize_live_error(result),
            sources=_source_statuses_out(result),
        )

    @router.get("/articles/{article_id}", response_model=ArticleOut, tags=["articles"])
    def get_article(article_id: str) -> ArticleOut:
        result = get_ingest_result()
        for article in result.articles:
            if article.id == article_id:
                return _project_article(article)
        raise ApiError(
            status_code=404, code="article_not_found", message="Unknown article id."
        )

    register_analysis_routes(router)  # M5 Phase 2: POST /articles/{id}/analysis
    return router