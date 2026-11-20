"""Cross-source dedup helpers (2026-11-08 multi-source expansion).

Two independent mechanisms, per the approved task section 3:

1. Exact canonical-URL dedup: URLs are normalized (lowercase scheme/host,
   default ports dropped, tracking parameters removed, trailing slash
   stripped) and later occurrences of an already-seen canonical URL are
   dropped. First occurrence wins (registry order), matching the existing
   within-feed adapter convention.

2. Near-duplicate headline detection: a deterministic token fingerprint of
   the headline. These are NEVER deleted (same-event coverage from different
   publishers is legitimate distinct journalism); matching fingerprints are
   recorded as events to prepare the data model for future event grouping.

The URL rules are mechanical and lossless for http(s) URLs; the headline
fingerprint is a documented heuristic (first N significant words after
lowercasing/punctuation stripping), not a semantic dedup.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, quote, urlsplit, urlunsplit

DUP_KIND_URL = "duplicate_canonical_url"
DUP_KIND_HEADLINE = "near_duplicate_headline"

#: Headline fingerprint words before the fingerprint becomes too fuzzy.
_HEADLINE_TOKEN_LIMIT = 8

_TRACKING_PARAM_RE = re.compile(
    r"^(?:utm_\w+|fbclid|gclid|yclid|dclid|msclkid|mc_[a-z]+|ref|ref_src|ref_url)$"
)

_PUNCT_RE = re.compile(r"[^\w\s-]", re.UNICODE)

# Non-index tokens are removed by _PUNCT_RE; short pronouns/conjunctions are
# kept on purpose: the fingerprint is deliberately conservative, false
# negatives are acceptable while false positives are not.


@dataclass(frozen=True)
class DedupEvent:
    """One recorded dedup observation (never a deletion, except kind=DUP_KIND_URL)."""

    kind: str  # DUP_KIND_URL or DUP_KIND_HEADLINE
    key: str  # normalized URL or headline fingerprint
    dropped_article_id: str | None  # set only for exact-URL drops
    kept_article_id: str | None  # the retained occurrence
    note: str


def normalize_canonical_url(url: str | None) -> str:
    """Canonical, comparison-stable form of an http(s) URL ("" when unusable).

    - scheme and host are lowercased; a default port (80/443) is dropped;
    - `www.` prefix is preserved (merging it could merge distinct publishers);
    - tracking parameters (utm_*, fbclid, gclid, ...) are removed; the rest
      keep their order;
    - a trailing slash on the path is stripped;
    - percent-encoding is left to `quote`/`unquote` round-trip on the query
      only; the path is compared verbatim (paths are case/encoding-sensitive).
    """
    if not url or not url.strip():
        return ""
    candidate = url.strip()
    try:
        split = urlsplit(candidate)
    except ValueError:
        return ""
    if split.scheme.lower() not in ("http", "https") or not split.netloc:
        return ""
    scheme = split.scheme.lower()
    try:
        host = (split.hostname or "").lower()
    except ValueError:
        return ""
    if not host:
        return ""
    port = split.port
    if port and port not in (80, 443):
        netloc = f"{host}:{port}"
    else:
        netloc = host
    if split.username or split.password:
        return ""  # credentials in URLs are never normalized/compared
    path = split.path.rstrip("/")
    kept_query = [
        (name, value)
        for name, value in parse_qsl(split.query, keep_blank_values=True)
        if not _TRACKING_PARAM_RE.match(name.lower())
    ]
    query = urlencode_pairs(kept_query)
    return urlunsplit(
        (scheme, netloc, path or "/", query, "")  # fragments never identify an article
    )


def urlencode_pairs(pairs: list[tuple[str, str]]) -> str:
    """Re-encode query pairs preserving the original order (round-trip safe)."""
    if not pairs:
        return ""
    return "&".join(
        f"{quote(name, safe='')}={quote(value, safe='')}" for name, value in pairs
    )


def headline_fingerprint(title: str | None) -> str:
    """Deterministic headline fingerprint (first 8 significant words, joined).

    Heuristic and language-agnostic: lowercased, punctuation stripped,
    whitespace split, first `_HEADLINE_TOKEN_LIMIT` tokens joined by "-".
    Near-dup matches are RECORD-ONLY (see module docstring).
    """
    if not title:
        return ""
    lowered = title.strip().lower()
    cleaned = _PUNCT_RE.sub(" ", lowered)
    tokens = [token for token in cleaned.split() if token]
    if not tokens:
        return ""
    return "-".join(tokens[:_HEADLINE_TOKEN_LIMIT])
