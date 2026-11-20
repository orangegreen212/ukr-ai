"""RSS 2.0 parser using only the standard library (M2).

Namespace-agnostic local-name matching supports the field set observed on the
M0-verified Pravda feeds (2026-10-23): title, link, guid, pubDate (RFC 822),
description, content:encoded, dc:creator, category, plus enclosure / media
image URL metadata. Malformed single items degrade to None fields; document
level failures raise FeedParseError. Atom feeds are out of scope (documented).
"""
from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime

from app.ingestion.rss_fetch import FeedParseError

logger = logging.getLogger(__name__)

_MEDIA_NS_HINT = "search.yahoo.com/mrss/"


def _localname(tag: str) -> str:
    """Namespace-agnostic tag name: strips any '{namespace}' prefix."""
    return tag.rsplit("}", 1)[-1]


@dataclass(frozen=True)
class RssItem:
    """Raw field values from one <item>; None when absent/unusable."""

    title: str | None = None
    link: str | None = None
    guid: str | None = None
    pub_date_raw: str | None = None
    description: str | None = None
    content_encoded: str | None = None
    creator: str | None = None
    category: str | None = None
    image_url: str | None = None


@dataclass(frozen=True)
class ParsedFeed:
    """Channel-level title plus the list of raw items (feed order preserved).

    `channel_language` is an additive field (2026-11-08): the RFC-822 style
    `<channel><language>` tag (e.g. "en-US"), or None when absent. It feeds
    the metadata-only identified-language path only; full-content Ukrainian
    ingestion keeps its existing Cyrillic-gate language decision.
    """

    channel_title: str | None
    items: list[RssItem]
    channel_language: str | None = None


def parse_pub_date(raw: str | None) -> datetime | None:
    """RFC 822 pubDate -> aware datetime, or None when unparsable (logged)."""
    if raw is None or not raw.strip():
        return None
    try:
        parsed = parsedate_to_datetime(raw.strip())
    except (TypeError, ValueError):
        logger.warning("unparsable pubDate %r", raw[:60])
        return None
    return parsed


def _first_text(element: ET.Element, name: str) -> str | None:
    """First non-empty direct child text whose local tag name matches."""
    for child in element:
        if _localname(child.tag) == name and child.text and child.text.strip():
            return child.text.strip()
    return None


def _image_url(item: ET.Element) -> str | None:
    """Extract image URL as metadata only (RSS enclosure or media:content/thumbnail).

    No bytes are downloaded here or anywhere in M2 (docs/ingestion.md).
    """
    for child in item:
        tag = _localname(child.tag)
        if tag == "enclosure":
            url = child.attrib.get("url", "")
            if url.strip():
                return url.strip()
        elif tag in ("content", "thumbnail") and _MEDIA_NS_HINT in child.tag:
            url = child.attrib.get("url", "")
            if url.strip():
                return url.strip()
    return None


def parse_rss(xml_bytes: bytes) -> ParsedFeed:
    """Parse RSS 2.0 bytes into a ParsedFeed.

    - raises FeedParseError for malformed XML or a non-rss root element;
    - channel-level fields other than the title are ignored on purpose.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise FeedParseError(f"XML parse failed: {exc}") from exc
    root_name = _localname(root.tag)
    if root_name != "rss":
        raise FeedParseError(
            f"unsupported feed root '<{root_name}>' (RSS 2.0 expected)"
        )

    channel: ET.Element | None = None
    for child in root:
        if _localname(child.tag) == "channel":
            channel = child
            break

    items: list[RssItem] = []
    for element in root.iter():
        if _localname(element.tag) != "item":
            continue
        items.append(
            RssItem(
                title=_first_text(element, "title"),
                link=_first_text(element, "link"),
                guid=_first_text(element, "guid"),
                pub_date_raw=_first_text(element, "pubDate"),
                description=_first_text(element, "description"),
                # content:encoded -> local name 'encoded'; dc:creator -> 'creator'.
                content_encoded=_first_text(element, "encoded"),
                creator=_first_text(element, "creator"),
                category=_first_text(element, "category"),
                image_url=_image_url(element),
            )
        )
    channel_title = _first_text(channel, "title") if channel is not None else None
    channel_language = _first_text(channel, "language") if channel is not None else None
    logger.info(
        "parsed %d RSS items (channel title %r, language %r)",
        len(items), channel_title, channel_language,
    )
    return ParsedFeed(
        channel_title=channel_title,
        items=items,
        channel_language=channel_language,
    )
