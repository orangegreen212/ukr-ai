"""Health module for the online edition.

Provides HealthPayload and demo snapshot functions referenced by
`app.api.v1` (online edition simplified version).

Original project had full health module; online edition provides
minimal required definitions to avoid import errors.
"""

from __future__ import annotations

from pydantic import BaseModel


class HealthPayload(BaseModel):
    """Minimal health payload for online edition."""
    app: str
    version: str
    demo_ok: bool = False
    demo_articles: int = 0
    demo_error: str | None = None
    lm_studio_enabled: bool = False
    live_feed_configured: bool = False


def _demo_snapshot(config) -> tuple[bool, int, str | None]:
    """Minimal demo snapshot — always returns safe defaults."""
    return (False, 0, None)