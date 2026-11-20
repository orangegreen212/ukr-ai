"""Project configuration from environment variables with safe defaults.

Design rules (SPEC.md section 6):
- OpenRouter is the default AI platform; LM Studio is optional and DISABLED by default;
  the app never assumes the local server is running.
- No secrets in source; `.env.example` documents every variable. Never print
  real tokens; none are used in M1.
- Image analysis is omitted from the online edition; only sentiment + NER are supported.
"""
from __future__ import annotations

import os
import dataclasses
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

REPO_ROOT = Path(__file__).resolve().parents[1]

_TRUTHY = {"1", "true", "yes", "on"}

_DEFAULT_APP_NAME = "Ukrainian AI Intelligence Platform (Online Edition)"
_DEFAULT_APP_VERSION = "0.2.0"
_DEFAULT_BASE_URL = "http://localhost:8000"
_DEFAULT_FEED_PRIMARY = "https://www.pravda.com.ua/rss/"
_DEFAULT_FEED_SECONDARY = "https://www.pravda.com.ua/rss/view_news/"
_DEFAULT_DEMO_PATH = "data/samples/demo_articles.json"

# OpenRouter configuration
_DEFAULT_OPENROUTER_API_KEY = ""
_DEFAULT_OPENROUTER_MODEL = "openrouter/free"
_DEFAULT_OPENROUTER_TIMEOUT = 30_000
_DEFAULT_OPENROUTER_MAX_RETRIES = 2

# Ingestion defaults (M2). The UA identifies the course project honestly and
# documents the excerpt-only, no-caching policy to the publisher.
_DEFAULT_INGEST_CONNECT_TIMEOUT = 5.0
_DEFAULT_INGEST_READ_TIMEOUT = 10.0
_DEFAULT_INGEST_MAX_BYTES = 3_000_000
_DEFAULT_INGEST_MAX_EXCERPT_CHARS = 600
_DEFAULT_INGEST_USER_AGENT = (
    "UkrainianAIPlatformCourseMVP/0.2 (+M2 ingestion; course project; "
    "excerpt-only; no caching)"
)
# Multi-source expansion (2026-11-08): per-source item cap keeps a high-volume
# publisher from dominating the combined feed (recent items win, feed order),
# and the fetch pool bounds parallelism across independent sources.
_DEFAULT_INGEST_SOURCE_MAX_ITEMS = 20
_DEFAULT_INGEST_MAX_FETCH_WORKERS = 4


def _as_bool(raw: str | None, default: bool) -> bool:
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in _TRUTHY


def _as_float(raw: str | None, default: float) -> float:
    """Parse a float env value; fall back to the default on garbage."""
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw.strip())
    except ValueError:
        return default


def _as_int(raw: str | None, default: int) -> int:
    """Parse an int env value; fall back to the default on garbage."""
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


@dataclasses.dataclass(frozen=True)
class AppConfig:
    """Snapshot of configuration values used by the app (tests can inject `env`)."""

    app_name: str
    app_version: str
    openrouter_api_key: str
    openrouter_model: str
    openrouter_timeout: int
    openrouter_max_retries: int
    feed_url_primary: str
    feed_url_secondary: str
    demo_data_path: str
    ingest_timeout_connect: float
    ingest_timeout_read: float
    ingest_max_bytes: int
    ingest_max_excerpt_chars: int
    ingest_user_agent: str
    # --- multi-source ingestion (2026-11-08) ---
    ingest_source_max_items: int
    ingest_max_fetch_workers: int

    def db_usable(self) -> bool:
        """Always False: database/DB persistence is omitted from the online edition."""
        return False

    def openrouter_usable(self) -> bool:
        """True only when both the toggle and a concrete model are set."""
        return (
            bool(self.openrouter_api_key.strip())
            and bool(self.openrouter_model.strip())
        )

    def demo_data_path_resolved(self) -> Path:
        """Resolve the demo fixture path relative to the repository root so the
        app behaves identically regardless of the working directory."""
        path = Path(self.demo_data_path)
        return path if path.is_absolute() else REPO_ROOT / path


def load_config(env: Mapping[str, str] | None = None) -> AppConfig:
    """Build an AppConfig. `env=None` reads the process environment (tests pass a dict)."""
    e: Mapping[str, str] = os.environ if env is None else env
    return AppConfig(
        app_name=e.get("APP_NAME", _DEFAULT_APP_NAME),
        app_version=e.get("APP_VERSION", _DEFAULT_APP_VERSION),
        openrouter_api_key=e.get("OPENROUTER_API_KEY", _DEFAULT_OPENROUTER_API_KEY),
        openrouter_model=e.get("OPENROUTER_MODEL", _DEFAULT_OPENROUTER_MODEL),
        openrouter_timeout=_as_int(
            e.get("OPENROUTER_TIMEOUT"), _DEFAULT_OPENROUTER_TIMEOUT
        ),
        openrouter_max_retries=_as_int(
            e.get("OPENROUTER_MAX_RETRIES"), _DEFAULT_OPENROUTER_MAX_RETRIES
        ),
        feed_url_primary=e.get("FEED_URL_PRIMARY", _DEFAULT_FEED_PRIMARY),
        feed_url_secondary=e.get("FEED_URL_SECONDARY", _DEFAULT_FEED_SECONDARY),
        demo_data_path=e.get("DEMO_DATA_PATH", _DEFAULT_DEMO_PATH),
        ingest_timeout_connect=_as_float(
            e.get("INGEST_TIMEOUT_CONNECT"), _DEFAULT_INGEST_CONNECT_TIMEOUT
        ),
        ingest_timeout_read=_as_float(
            e.get("INGEST_TIMEOUT_READ"), _DEFAULT_INGEST_READ_TIMEOUT
        ),
        ingest_max_bytes=_as_int(
            e.get("INGEST_MAX_BYTES"), _DEFAULT_INGEST_MAX_BYTES
        ),
        ingest_max_excerpt_chars=_as_int(
            e.get("INGEST_MAX_EXCERPT_CHARS"), _DEFAULT_INGEST_MAX_EXCERPT_CHARS
        ),
        ingest_user_agent=e.get("INGEST_USER_AGENT", _DEFAULT_INGEST_USER_AGENT),
        ingest_source_max_items=max(
            1, _as_int(e.get("INGEST_SOURCE_MAX_ITEMS"), _DEFAULT_INGEST_SOURCE_MAX_ITEMS)
        ),
        ingest_max_fetch_workers=max(
            1, _as_int(e.get("INGEST_MAX_FETCH_WORKERS"), _DEFAULT_INGEST_MAX_FETCH_WORKERS)
        ),
        supabase_url="",
        supabase_db_dsn="",
        db_enabled=False,
    )