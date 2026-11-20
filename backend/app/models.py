"""Normalized article schema (SPEC.md section 4, milestone M1; 2026-11-08:
multi-source ingestion fields - source_id, source_language, analysis_status).

Shared by the M1 demo loader and the M2 live-feed adapter. Predictions (NLP,
vision) are stored separately from records in later milestones; this module
holds no model outputs at all.

Analysis eligibility (source-language policy, 2026-11-08):
- `analysis_status` is an explicit processing state; the Ukrainian-only NLP
  scope never widens because non-uk languages can now be *represented* -
  `resolve_analysis_status` keeps them out of Ukrainian NLP processing.
- `metadata_only` records (e.g. English-language sources ingested for
  provenance only) may carry `text=None` AND `summary=None`; everything else
  still requires a body. The Kyiv Independent is the documented exception.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping

ERROR_MISSING_BODY = "article_requires_text_or_summary"
ERROR_MISSING_ID = "article_id_missing"
ERROR_MISSING_TITLE = "article_title_missing"
ERROR_LANGUAGE = "unsupported_language"
ERROR_ANALYSIS_STATUS = "unknown_analysis_status"

# --- in-scope language -------------------------------------------------------
_IN_SCOPE_LANGUAGE = "uk"  # Ukrainian only (AGENTS.md non-negotiable scope)

# --- explicit analysis/processing states (source-language policy 2026-11-08) --
ANALYSIS_ELIGIBLE = "eligible"
ANALYSIS_METADATA_ONLY = "metadata_only"
ANALYSIS_UNSUPPORTED_LANGUAGE = "unsupported_language"
ANALYSIS_PENDING_VALIDATION = "pending_validation"
ANALYSIS_FAILED = "failed"
#: sentinel used at construction time: resolve from the identified language.
ANALYSIS_AUTO = "auto"
ANALYSIS_STATUSES = (
    ANALYSIS_ELIGIBLE,
    ANALYSIS_METADATA_ONLY,
    ANALYSIS_UNSUPPORTED_LANGUAGE,
    ANALYSIS_PENDING_VALIDATION,
    ANALYSIS_FAILED,
)

# --- ingestion modes (source registry vocabulary) ----------------------------
INGESTION_FULL_CONTENT = "full_content"
INGESTION_METADATA_ONLY = "metadata_only"
INGESTION_MODES = (INGESTION_FULL_CONTENT, INGESTION_METADATA_ONLY)

REASON_SOURCE_METADATA_ONLY = "source_metadata_only"


def _normalized_language(value: Any) -> str:
    """Lowercase, stripped language tag; empty string for missing/blank."""
    if not isinstance(value, str):
        return ""
    return value.strip().lower()


def resolve_analysis_status(
    identified_language: str | None, *, ingestion_mode: str
) -> tuple[str, str | None]:
    """Resolve the explicit analysis state from an IDENTIFIED language.

    - `metadata_only` sources are excluded from NLP regardless of language
      (source-level policy, documented per source in the registry);
    - Ukrainian content from full-content sources stays `eligible`;
    - identified non-Ukrainian languages are representable but excluded as
      `unsupported_language` (no silent translation, no weakened NLP gate);
    - unknown/missing language is `pending_validation`, never inferred.
    """
    if ingestion_mode == INGESTION_METADATA_ONLY:
        return (ANALYSIS_METADATA_ONLY, REASON_SOURCE_METADATA_ONLY)
    if ingestion_mode != INGESTION_FULL_CONTENT:
        raise ValueError("unknown_ingestion_mode")
    language = _normalized_language(identified_language)
    if language == _IN_SCOPE_LANGUAGE:
        return (ANALYSIS_ELIGIBLE, None)
    if not language:
        return (ANALYSIS_PENDING_VALIDATION, "language_unknown_or_missing")
    return (ANALYSIS_UNSUPPORTED_LANGUAGE, f"language_{language}_unsupported")


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _parse_iso(value: Any, field_name: str) -> datetime | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, datetime):
        return value
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"bad_datetime_{field_name}") from exc
    return parsed


def compute_content_hash(article: Article) -> str:
    """Deterministic content hash over title + body (text preferred, else summary)."""
    payload = article.text if article.text else (article.summary or "")
    digest = hashlib.sha256(f"{article.title}\x1f{payload}".encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


@dataclass(frozen=True)
class Article:
    """Normalized news record. Demo fixtures carry is_demo_data=True."""

    id: str
    title: str
    text: str | None = None
    summary: str | None = None
    source_name: str | None = None
    source_url: str | None = None
    canonical_url: str | None = None
    published_at: datetime | None = None
    retrieved_at: datetime | None = None
    language: str = _IN_SCOPE_LANGUAGE
    image_url: str | None = None
    content_hash: str | None = None
    is_demo_data: bool = False
    usage_note: str | None = None
    # --- multi-source fields (2026-11-08; all optional, backward-compatible) ---
    source_id: str | None = None
    source_language: str = ""
    analysis_status: str = ANALYSIS_AUTO
    analysis_exclusion_reason: str | None = None

    def __post_init__(self) -> None:
        language_norm = _normalized_language(self.language)
        if language_norm != self.language:
            object.__setattr__(self, "language", language_norm)
        if not _clean(self.id):
            raise ValueError(ERROR_MISSING_ID)
        if not _clean(self.title):
            raise ValueError(ERROR_MISSING_TITLE)
        status = _normalized_language(self.analysis_status)
        if status == ANALYSIS_AUTO:
            status, reason = resolve_analysis_status(
                self.language, ingestion_mode=INGESTION_FULL_CONTENT
            )
            object.__setattr__(self, "analysis_status", status)
            if self.analysis_exclusion_reason is None and reason is not None:
                object.__setattr__(self, "analysis_exclusion_reason", reason)
        elif status not in ANALYSIS_STATUSES:
            raise ValueError(ERROR_ANALYSIS_STATUS)
        if self.text is None and self.summary is None:
            # Headline-only records exist for metadata-only sources; anything
            # else still requires a body (unchanged M1 rule).
            if status != ANALYSIS_METADATA_ONLY:
                raise ValueError(ERROR_MISSING_BODY)
        if self.language != _IN_SCOPE_LANGUAGE and status == ANALYSIS_ELIGIBLE:
            raise ValueError(ERROR_LANGUAGE)
        if self.content_hash is None:
            object.__setattr__(self, "content_hash", compute_content_hash(self))

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "text": self.text,
            "summary": self.summary,
            "source_name": self.source_name,
            "source_url": self.source_url,
            "canonical_url": self.canonical_url,
            "published_at": self.published_at.isoformat() if self.published_at else None,
            "retrieved_at": self.retrieved_at.isoformat() if self.retrieved_at else None,
            "language": self.language,
            "image_url": self.image_url,
            "content_hash": self.content_hash,
            "is_demo_data": self.is_demo_data,
            "usage_note": self.usage_note,
            "source_id": self.source_id,
            "source_language": self.source_language,
            "analysis_status": self.analysis_status,
            "analysis_exclusion_reason": self.analysis_exclusion_reason,
        }

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "Article":
        """Build from a normalized mapping. Unknown keys are ignored on purpose."""
        text = _clean(raw.get("text"))
        summary = _clean(raw.get("summary"))
        language = _normalized_language(raw.get("language"))
        status_raw = _normalized_language(raw.get("analysis_status"))
        if status_raw and status_raw != ANALYSIS_AUTO:
            # An explicit status taken from storage is preserved verbatim;
            # nothing is re-resolved when the caller already recorded the state.
            return cls(
                id=str(raw.get("id") or "").strip(),
                title=_clean(raw.get("title")) or "",
                text=text,
                summary=summary,
                source_name=_clean(raw.get("source_name")),
                source_url=_clean(raw.get("source_url")),
                canonical_url=_clean(raw.get("canonical_url")),
                published_at=_parse_iso(raw.get("published_at"), "published_at"),
                retrieved_at=_parse_iso(raw.get("retrieved_at"), "retrieved_at"),
                language=language or _IN_SCOPE_LANGUAGE,
                image_url=_clean(raw.get("image_url")),
                content_hash=_clean(raw.get("content_hash")),
                is_demo_data=bool(raw.get("is_demo_data", False)),
                usage_note=_clean(raw.get("usage_note")),
                source_id=_clean(raw.get("source_id")),
                source_language=_normalized_language(raw.get("source_language")),
                analysis_status=status_raw,
                analysis_exclusion_reason=_clean(
                    raw.get("analysis_exclusion_reason")
                ),
            )
        return cls(
            id=str(raw.get("id") or "").strip(),
            title=_clean(raw.get("title")) or "",  # __post_init__ raises if truly missing
            text=text,
            summary=summary,
            source_name=_clean(raw.get("source_name")),
            source_url=_clean(raw.get("source_url")),
            canonical_url=_clean(raw.get("canonical_url")),
            published_at=_parse_iso(raw.get("published_at"), "published_at"),
            retrieved_at=_parse_iso(raw.get("retrieved_at"), "retrieved_at"),
            language=language or _IN_SCOPE_LANGUAGE,
            image_url=_clean(raw.get("image_url")),
            content_hash=_clean(raw.get("content_hash")),
            is_demo_data=bool(raw.get("is_demo_data", False)),
            usage_note=_clean(raw.get("usage_note")),
            source_id=_clean(raw.get("source_id")),
            source_language=_normalized_language(raw.get("source_language")),
            analysis_status=status_raw or ANALYSIS_AUTO,
            analysis_exclusion_reason=_clean(raw.get("analysis_exclusion_reason")),
        )
