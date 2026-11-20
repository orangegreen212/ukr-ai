"""NLP analysis endpoint (M5 Phase 2): `POST /api/v1/articles/{article_id}/analysis`.

Phase-2 scope — TEXT ONLY (sentiment + NER) over the frozen M3 contracts:
- The article is looked up through the same Phase-1 ingestion provider seam
  (`app.api.v1.get_ingest_result`, resolved lazily to avoid import cycles).
- Both task sections are always present and carry the verbatim field content
  of the frozen `SentimentPrediction.to_dict()` / `NerPrediction.to_dict()`.
  The top-level `status` is DERIVED truthfully from the two section statuses:
  `ok` (both ok) · `partial` (exactly one ok) · `failed` (none ok). Nothing
  is fabricated: failed sections keep the frozen status/reason semantics and
  never carry labels, confidence, or entities.
- Total analysis failure still responds 200 with failure sections (frozen
  status vocabulary passes through per the agreed API policy); only the
  unknown-article case uses the 404 envelope, unchanged from Phase 1.

Resource rules: heavy ML libraries load lazily INSIDE the adapter objects on
first inference — importing this module (or `app.api.main`) imports neither
`app.nlp.sent_impl` / `app.nlp.ner_impl` nor torch/transformers. There is one
INITIALIZATION lock and one INFERENCE/run lock PER MODEL (never a global
lock): the adapters' lazy `_ensure_loaded()` is not itself thread-safe, so the
per-model run lock serializes LOAD + inference on that model. Trade-off: no
concurrent inference on the same model (CPU-only MVP, correctness over
throughput); different adapters (e.g. NER on one thread, sentiment on the
other) may run in parallel.

Singleton note: `_REGISTRY` is module-level mutable state and must be
resettable — tests use `reset_nlp_registry()`, which replaces the object
wholesale (never mutating shared adapters).
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any, Callable, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.eligibility import ensure_article_analyzable
from app.api.errors import ApiError
from app.nlp.schemas import (
    REASON_MODEL_ERROR,
    REASON_WEIGHTS_UNAVAILABLE,
    STATUS_INFERENCE_ERROR,
    STATUS_OK,
    STATUS_WEIGHTS_UNAVAILABLE,
    NerPrediction,
    SentimentPrediction,
)

logger = logging.getLogger(__name__)

TASK_SENTIMENT = "sentiment"
TASK_NER = "ner"

#: top-level `status` is derived ONLY from the two section statuses
DERIVED_OK = "ok"
DERIVED_PARTIAL = "partial"
DERIVED_FAILED = "failed"


def build_sentiment_classifier() -> Any:
    """Real adapter factory (lazy import: module import stays torch-free)."""
    from app.nlp.sent_impl import LocalSentimentClassifier

    return LocalSentimentClassifier()  # default local snapshot dir; no network


def build_ner_detector() -> Any:
    from app.nlp.ner_impl import LocalNERDetector

    return LocalNERDetector()  # default local snapshot dir; no network


class _ModelState:
    """Per-model init/run locks + cached adapter (one of these PER MODEL)."""

    __slots__ = ("init_lock", "run_lock", "adapter", "init_failed")

    def __init__(self) -> None:
        self.init_lock = threading.Lock()
        self.run_lock = threading.Lock()
        self.adapter: Any = None
        self.init_failed = False


class _ModelRegistry:
    """Lazy per-model holder, double-checked init, per-model run locks."""

    def __init__(self, builders: dict[str, Callable[[], Any]] | None = None) -> None:
        self._builders = (
            {
                TASK_SENTIMENT: build_sentiment_classifier,
                TASK_NER: build_ner_detector,
            }
            if builders is None
            else dict(builders)
        )
        if set(self._builders) != {TASK_SENTIMENT, TASK_NER}:
            raise ValueError("registry must supply exactly sentiment+ner builders")
        self._states = {TASK_SENTIMENT: _ModelState(), TASK_NER: _ModelState()}

    def adapter_for(self, task: str) -> Any | None:
        """Return the model adapter, initializing it once per model.

        Double-checked locking with THIS model's init lock only; a failed
        factory is cached (no silent retries), so callers get `None` and build
        an honest failure status."""
        state = self._states[task]
        if state.adapter is not None or state.init_failed:
            return state.adapter
        with state.init_lock:
            if state.adapter is None and not state.init_failed:
                try:
                    state.adapter = self._builders[task]()
                except Exception as exc:  # noqa: BLE001 - cached init failure
                    state.init_failed = True
                    logger.error(
                        "NLP adapter init failed for %s: %s: %s",
                        task, type(exc).__name__, exc,
                    )
        return state.adapter

    def run_lock(self, task: str) -> threading.Lock:
        """Inference lock for one model (load+predict serialized per model)."""
        return self._states[task].run_lock


_REGISTRY: _ModelRegistry = _ModelRegistry()


def reset_nlp_registry(builders: dict[str, Callable[[], Any]] | None = None) -> None:
    """Replace the singleton registry (tests / operational reset)."""
    global _REGISTRY
    _REGISTRY = _ModelRegistry(builders=builders)


def _current_registry() -> _ModelRegistry:
    return _REGISTRY


def _get_ingest_result() -> Any:
    """Lazy provider resolution: `app.api.v1` is imported only at request
    time (keeps `app.api.main -> app.api.v1 -> app.api.analysis` acyclic)."""
    import app.api.v1 as v1

    return v1.get_ingest_result()


def _analysis_text(article: Any) -> str:
    """Body to analyze: article text preferred, else summary (same precedence
    as the frozen content-hash computation). Blank/None falls through to the
    adapters' documented `missing_input` semantics."""
    return article.text if article.text else (article.summary or "")


# --- frozen-contract failure predictions (statuses/reasons only) --------------


def _sentiment_failure(
    article_id: str,
    content_hash: str,
    *,
    status: str,
    reason: str,
    predicted_at: datetime,
) -> SentimentPrediction:
    from app.nlp.sent_impl import SENTIMENT_MODEL_ID

    return SentimentPrediction(
        article_id=article_id,
        content_hash=content_hash,
        model_id=SENTIMENT_MODEL_ID,
        predicted_at=predicted_at,
        status=status,
        error_reason=reason,
    )


def _ner_failure(
    article_id: str,
    content_hash: str,
    *,
    status: str,
    reason: str,
    predicted_at: datetime,
) -> NerPrediction:
    from app.nlp.ner_impl import NER_MODEL_ID

    return NerPrediction(
        article_id=article_id,
        content_hash=content_hash,
        model_id=NER_MODEL_ID,
        predicted_at=predicted_at,
        status=status,
        error_reason=reason,
    )


# --- per-task execution (each guarded by ITS OWN per-model run lock) ----------


def _run_sentiment(
    registry: _ModelRegistry,
    article: Any,
    text: str,
    predicted_at: datetime,
) -> SentimentPrediction:
    adapter = registry.adapter_for(TASK_SENTIMENT)
    if adapter is None:
        return _sentiment_failure(
            article.id,
            article.content_hash,
            status=STATUS_WEIGHTS_UNAVAILABLE,
            reason=REASON_WEIGHTS_UNAVAILABLE,
            predicted_at=predicted_at,
        )
    try:
        with registry.run_lock(TASK_SENTIMENT):
            result = adapter.predict_sentiment(
                article.id, article.content_hash, text, predicted_at=predicted_at
            )
    except Exception as exc:  # noqa: BLE001 - contract: failures become statuses
        logger.error("sentiment analysis failed: %s: %s", type(exc).__name__, exc)
        return _sentiment_failure(
            article.id,
            article.content_hash,
            status=STATUS_INFERENCE_ERROR,
            reason=REASON_MODEL_ERROR,
            predicted_at=predicted_at,
        )
    assert isinstance(result, SentimentPrediction)
    return result


def _run_ner(
    registry: _ModelRegistry,
    article: Any,
    text: str,
    predicted_at: datetime,
) -> NerPrediction:
    adapter = registry.adapter_for(TASK_NER)
    if adapter is None:
        return _ner_failure(
            article.id,
            article.content_hash,
            status=STATUS_WEIGHTS_UNAVAILABLE,
            reason=REASON_WEIGHTS_UNAVAILABLE,
            predicted_at=predicted_at,
        )
    try:
        with registry.run_lock(TASK_NER):
            result = adapter.detect_entities(
                article.id, article.content_hash, text, predicted_at=predicted_at
            )
    except Exception as exc:  # noqa: BLE001 - contract: failures become statuses
        logger.error("ner analysis failed: %s: %s", type(exc).__name__, exc)
        return _ner_failure(
            article.id,
            article.content_hash,
            status=STATUS_INFERENCE_ERROR,
            reason=REASON_MODEL_ERROR,
            predicted_at=predicted_at,
        )
    assert isinstance(result, NerPrediction)
    return result


def _aggregate_status(sentiment: SentimentPrediction, ner: NerPrediction) -> str:
    ok = (sentiment.status == STATUS_OK) + (ner.status == STATUS_OK)
    if ok == 2:
        return DERIVED_OK
    return DERIVED_PARTIAL if ok == 1 else DERIVED_FAILED


# --- response model (strict mirrors of the frozen to_dict() keys) -------------
# NOTE: the visible-expression caveat is deliberately NOT present here —
# vision is out of scope in Phase 2.


class _SentimentSection(BaseModel):
    """One sentiment outcome. Values come from `SentimentPrediction.to_dict()`.

    Context note (not a data field): technical inference success is NOT
    predictive-quality validation; `evaluation_status` stays `unreviewed` and
    `caveat` (present on ok rows) communicates the honest limitation."""

    article_id: str
    content_hash: str
    task: Literal["sentiment"]
    status: str
    label: str | None
    confidence: float | None
    model_id: str
    model_revision: str
    predicted_at: str
    error_reason: str | None
    caveat: str | None
    evaluation_status: str


class _EntityItem(BaseModel):
    entity_type: str
    text: str
    start: int
    end: int
    confidence: float | None


class _NerSection(BaseModel):
    article_id: str
    content_hash: str
    task: Literal["ner"]
    status: str
    entities: list[_EntityItem]
    model_id: str
    model_revision: str
    predicted_at: str
    error_reason: str | None
    caveat: str | None
    evaluation_status: str


class ArticleAnalysisResponse(BaseModel):
    """Combined text-analysis response for ONE article.

    `status` is derived from the two frozen section statuses; partial
    failure is visible through per-section status/error_reason without any
    failed section carrying fabricated output."""

    article_id: str
    content_hash: str
    status: str
    sentiment: _SentimentSection
    ner: _NerSection


def analyze_article_content(article: Any) -> ArticleAnalysisResponse:
    """Run the full text analysis for ONE resolved article object.

    Public reuse seam (M5 Phase 4): the Phase-2 route resolves the article
    through the provider seam and delegates here; the multimodal orchestrator
    reuses this same function unchanged. Registry init/inference still go
    through the per-model locks defined above — no new locking, no duplicated
    model logic."""
    registry = _current_registry()
    text = _analysis_text(article)
    predicted_at = datetime.now(timezone.utc)
    sentiment = _run_sentiment(registry, article, text, predicted_at)
    ner = _run_ner(registry, article, text, predicted_at)
    return ArticleAnalysisResponse(
        article_id=article.id,
        content_hash=article.content_hash,
        status=_aggregate_status(sentiment, ner),
        sentiment=_SentimentSection.model_validate(sentiment.to_dict()),
        ner=_NerSection.model_validate(ner.to_dict()),
    )


def register_analysis_routes(router: APIRouter) -> None:
    @router.post(
        "/articles/{article_id}/analysis",
        response_model=ArticleAnalysisResponse,
        tags=["analysis"],
    )
    def analyze_article(article_id: str) -> ArticleAnalysisResponse:
        for article in _get_ingest_result().articles:
            if article.id == article_id:
                break
        else:
            raise ApiError(
                status_code=404, code="article_not_found", message="Unknown article id."
            )
        # Slice B gate: ineligible records (metadata_only / unsupported
        # language / pending validation / failed) are refused BEFORE any text
        # extraction or model work happens.
        ensure_article_analyzable(article)
        return analyze_article_content(article)