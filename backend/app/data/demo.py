"""Demo fixture loader (M1) - self-authored synthetic Ukrainian articles.

Kept strictly separate from live ingestion (future app/ingestion, M2): a broken
or missing fixture file must never affect live code, and live-fetch failures
must never remove demo mode (AGENTS.md rule 16 / PD-1).

Every fixture record is flagged is_demo_data=True and carries a usage_note so
synthetic data can never be presented as real observations.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import AppConfig, load_config
from app.models import Article

logger = logging.getLogger(__name__)

_DEMO_SOURCE_NAME = "Демо-набір (синтетичний)"


class DemoDataError(RuntimeError):
    """Raised when the demo fixture file is missing, malformed or mislabelled."""


def load_demo_articles(
    config: AppConfig | None = None,
    *,
    path: Path | None = None,
    retrieved_at: datetime | None = None,
) -> list[Article]:
    """Load and normalize demo articles.

    - `retrieved_at` defaults to load time (metadata only; content stays deterministic).
    - Raises DemoDataError with a clear message when anything is unusable.
    """
    cfg = config or load_config()
    fixture_path = path or cfg.demo_data_path_resolved()
    _retrieved = retrieved_at or datetime.now(timezone.utc)

    if not fixture_path.exists():
        raise DemoDataError(f"demo fixture file not found: {fixture_path}")

    try:
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise DemoDataError(f"cannot read demo fixtures ({fixture_path}): {type(exc).__name__}") from exc

    raw_articles: Any
    if isinstance(payload, dict):
        raw_articles = payload.get("articles")
    else:
        raw_articles = payload
    if not isinstance(raw_articles, list) or not raw_articles:
        raise DemoDataError(f"no articles in demo fixtures: {fixture_path}")

    articles: list[Article] = []
    for index, raw in enumerate(raw_articles):
        if not isinstance(raw, dict):
            raise DemoDataError(f"demo fixture #{index} is not an object")
        raw_item = {**raw}
        # Loader-owned metadata: fixtures stay deterministic without per-file timestamps.
        if raw_item.get("retrieved_at") in (None, ""):
            raw_item["retrieved_at"] = _retrieved.isoformat()
        # Loader-owned source label for synthetic records (schema field stays honest).
        if not raw_item.get("source_name"):
            raw_item["source_name"] = _DEMO_SOURCE_NAME
        try:
            article = Article.from_dict(raw_item)
        except ValueError as exc:
            raise DemoDataError(f"demo fixture #{index} invalid: {exc}") from exc
        if not article.is_demo_data:
            raise DemoDataError(
                f"demo fixture '{article.id}' must be flagged is_demo_data=true"
            )
        if not article.usage_note:
            raise DemoDataError(
                f"demo fixture '{article.id}' must include a usage_note "
                "(synthetic data must never look like real observations)"
            )
        articles.append(article)

    logger.info("loaded %d demo articles from %s", len(articles), fixture_path)
    return articles


def unique_ids(articles: list[Article]) -> bool:
    """Helper for tests/health: True when ids are non-empty and unique."""
    ids = [a.id for a in articles]
    return all(ids) and len(ids) == len(set(ids))
