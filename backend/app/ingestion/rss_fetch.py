"""Bounded HTTP fetcher for RSS feeds (M2).

Policy (AGENTS.md rule 15, docs/ingestion.md):
- on-demand single fetch per feed; no retries, no polling loops;
- explicit connect/read timeouts and a hard response-size cap;
- publisher-documented feeds only; no robots/auth/CAPTCHA/paywall bypass.
"""
from __future__ import annotations

import logging
from typing import Callable

import requests

logger = logging.getLogger(__name__)


class FeedError(RuntimeError):
    """Base class for ingestion failures (the service layer translates these)."""


class FeedFetchError(FeedError):
    """Network, HTTP status, content-type or response-size failure."""


class FeedParseError(FeedError):
    """Feed bytes are unparseable or are not RSS 2.0."""


class FeedUnavailableError(FeedError):
    """All configured feeds failed; the service layer falls back to demo data."""


# Informal protocol: (url, *, user_agent, timeout=(connect, read), max_bytes) -> bytes.
# Tests may inject any callable with this shape; no network calls happen then.
Fetcher = Callable[..., bytes]

_CHUNK_SIZE = 65536


def fetch_feed_bytes(
    url: str,
    *,
    user_agent: str,
    timeout: tuple[float, float],
    max_bytes: int,
) -> bytes:
    """Fetch one feed as bytes with strict bounds.

    - `timeout` is `(connect_seconds, read_seconds)` as understood by requests.
    - Raises FeedFetchError with a short reason on any problem; never returns
      partial content. Redirects are followed (same publisher paths only).
    """
    headers = {
        "User-Agent": user_agent,
        "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    }
    try:
        with requests.get(url, headers=headers, timeout=timeout, stream=True, allow_redirects=True) as resp:
            if resp.status_code != 200:
                raise FeedFetchError(f"HTTP {resp.status_code} from {url}")
            content_type = (resp.headers.get("Content-Type") or "").lower()
            if "xml" not in content_type and "text" not in content_type:
                raise FeedFetchError(f"unexpected content type '{content_type}' from {url}")
            chunks: list[bytes] = []
            total = 0
            for chunk in resp.iter_content(chunk_size=_CHUNK_SIZE):
                if not chunk:
                    continue
                chunks.append(chunk)
                total += len(chunk)
                if total > max_bytes:
                    raise FeedFetchError(f"response from {url} exceeds max_bytes={max_bytes}")
    except requests.Timeout as exc:
        raise FeedFetchError(f"timeout connecting/reading {url}") from exc
    except FeedFetchError:
        raise
    except requests.RequestException as exc:
        raise FeedFetchError(f"request to {url} failed: {type(exc).__name__}") from exc
    logger.info("fetched %d bytes from %s", total, url)
    return b"".join(chunks)
