"""Prediction schemas + status constants for NLP analysis (online edition).

Sentiment + NER are produced by an OpenRouter-hosted LLM (see
`app.nlp.openrouter_impl`). These dataclasses keep the response contract the
frontend already consumes (`to_dict()` keys are the API field names).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

STATUS_OK = "ok"
STATUS_INFERENCE_ERROR = "inference_error"
STATUS_WEIGHTS_UNAVAILABLE = "weights_unavailable"  # kept for API compat: "model unavailable"
STATUS_MISSING_INPUT = "missing_input"

REASON_MODEL_ERROR = "model_error"
REASON_WEIGHTS_UNAVAILABLE = "model_not_configured"
REASON_MISSING_INPUT = "missing_input"

EVALUATION_UNREVIEWED = "unreviewed"

CAVEAT = (
    "Produced by a general-purpose LLM via OpenRouter; quality on Ukrainian "
    "news is not formally validated. Treat as an estimate."
)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


@dataclass
class SentimentPrediction:
    article_id: str
    content_hash: str | None
    model_id: str
    predicted_at: datetime
    status: str
    label: str | None = None
    confidence: float | None = None
    model_revision: str = "openrouter"
    error_reason: str | None = None
    evaluation_status: str = EVALUATION_UNREVIEWED

    def to_dict(self) -> dict[str, Any]:
        ok = self.status == STATUS_OK
        return {
            "article_id": self.article_id,
            "content_hash": self.content_hash or "",
            "task": "sentiment",
            "status": self.status,
            "label": self.label if ok else None,
            "confidence": self.confidence if ok else None,
            "model_id": self.model_id,
            "model_revision": self.model_revision,
            "predicted_at": _iso(self.predicted_at),
            "error_reason": self.error_reason,
            "caveat": CAVEAT if ok else None,
            "evaluation_status": self.evaluation_status,
        }


@dataclass
class Entity:
    entity_type: str
    text: str
    start: int
    end: int
    confidence: float | None = None


@dataclass
class NerPrediction:
    article_id: str
    content_hash: str | None
    model_id: str
    predicted_at: datetime
    status: str
    entities: list[Entity] = field(default_factory=list)
    model_revision: str = "openrouter"
    error_reason: str | None = None
    evaluation_status: str = EVALUATION_UNREVIEWED

    def to_dict(self) -> dict[str, Any]:
        ok = self.status == STATUS_OK
        return {
            "article_id": self.article_id,
            "content_hash": self.content_hash or "",
            "task": "ner",
            "status": self.status,
            "entities": (
                [
                    {
                        "entity_type": e.entity_type,
                        "text": e.text,
                        "start": e.start,
                        "end": e.end,
                        "confidence": e.confidence,
                    }
                    for e in self.entities
                ]
                if ok
                else []
            ),
            "model_id": self.model_id,
            "model_revision": self.model_revision,
            "predicted_at": _iso(self.predicted_at),
            "error_reason": self.error_reason,
            "caveat": CAVEAT if ok else None,
            "evaluation_status": self.evaluation_status,
        }
