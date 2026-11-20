"""Article-analysis eligibility gate (Slice B, 2026-11-09).

Single shared check for EVERY route that analyzes one stored article by ID:
`POST /articles/{id}/analysis`, `POST /articles/{id}/llm`, the
`article_id` branch of `POST /multimodal/analyze`, and the frequent-entities
aggregation loop. Only analysis_status="eligible" records proceed to text
extraction or model invocation; `metadata_only`, `unsupported_language`,
`pending_validation` and `failed` records get an explicit structured refusal.

Refusal shape: HTTP 422 with the fixed error envelope, code
`article_not_analyzable`, and `details` carrying the article ID, the
analysis_status and the analysis_exclusion_reason (spec section 2). The
frontend already renders envelope `details[].field/message` (services/api.ts).

Forward compatibility: records WITHOUT an `analysis_status` attribute are
treated as eligible (legacy duck-typed direct-text bindings such as
`multimodal._EphemeralText` predate the field and keep their exact behavior).
Missing-attribute handling is a contract note, not an eligibility relaxation:
every real `Article` from the ingestion service carries the field.
"""
from __future__ import annotations

from typing import Any

from app.api.errors import ApiError, ValidationFieldError
from app.models import ANALYSIS_ELIGIBLE

ANALYSIS_EXCLUDED_STATUSES = (
    "metadata_only",
    "unsupported_language",
    "pending_validation",
    "failed",
)

CODE_ARTICLE_NOT_ANALYZABLE = "article_not_analyzable"
_STATIC_REFUSAL_MESSAGE = (
    "This article is not eligible for analysis because of its source-language policy."
)


def article_analysis_status(article: Any) -> str | None:
    """The record's explicit analysis status, or None when the attribute does
    not exist (legacy duck-typed bindings keep the legacy behavior)."""
    status = getattr(article, "analysis_status", None)
    if isinstance(status, str) and status.strip():
        return status.strip().lower()
    return None


def article_analysis_exclusion_reason(article: Any) -> str | None:
    reason = getattr(article, "analysis_exclusion_reason", None)
    if isinstance(reason, str) and reason.strip():
        return reason
    return None


def artifact_is_analyzable(article: Any) -> bool:
    """True only when the stored record may enter Ukrainian NLP/LLM processing."""
    status = article_analysis_status(article)
    if status is None:  # legacy duck-typed record: unchanged direct-text path
        return True
    return status == ANALYSIS_ELIGIBLE


def ensure_article_analyzable(article: Any) -> None:
    """Structured 422 refusal for a stored article that is not eligible.

    Raises BEFORE any text extraction or model work happens; the exception is
    the fixed `ApiError` envelope, so no route-specific error schema appears.
    """
    if artifact_is_analyzable(article):
        return
    status = article_analysis_status(article) or "unknown"
    reason = article_analysis_exclusion_reason(article)
    raise ApiError(
        status_code=422,
        code=CODE_ARTICLE_NOT_ANALYZABLE,
        message=_STATIC_REFUSAL_MESSAGE,
        details=[
            ValidationFieldError(
                field="article_id", message=str(getattr(article, "id", ""))
            ),
            ValidationFieldError(field="analysis_status", message=status),
            ValidationFieldError(
                field="analysis_exclusion_reason", message=reason or "not provided"
            ),
        ],
    )


def eligible_articles(articles: Any) -> list[Any]:
    """Filter helper for aggregate runs (frequent-entities): only eligible
    records are passed to model code; excluded ones are skipped, never
    counted as model failures."""
    return [article for article in articles if artifact_is_analyzable(article)]
