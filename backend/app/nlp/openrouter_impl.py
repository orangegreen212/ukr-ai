"""OpenRouter-backed sentiment + NER adapters (online edition).

One chat-completion call per task. The model is asked for strict JSON; the
reply is parsed defensively and entity offsets are recomputed locally from the
article text so `start`/`end` are always real positions (never model-invented).
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

import httpx

from app.config import AppConfig, load_config
from app.nlp.schemas import (
    REASON_MISSING_INPUT,
    REASON_MODEL_ERROR,
    STATUS_INFERENCE_ERROR,
    STATUS_MISSING_INPUT,
    STATUS_OK,
    Entity,
    NerPrediction,
    SentimentPrediction,
)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_CHARS = 6000
SENTIMENT_LABELS = ("positive", "neutral", "negative")
ENTITY_TYPES = ("PER", "ORG", "LOC", "MISC")


class OpenRouterError(RuntimeError):
    pass


def _timeout_seconds(cfg: AppConfig) -> float:
    t = cfg.openrouter_timeout
    return t / 1000.0 if t > 1000 else float(t)  # config default is in ms


def _chat(cfg: AppConfig, system: str, user: str) -> str:
    headers = {
        "Authorization": f"Bearer {cfg.openrouter_api_key.strip()}",
        "Content-Type": "application/json",
    }
    body = {
        "model": cfg.openrouter_model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    last: Exception | None = None
    for _ in range(max(1, cfg.openrouter_max_retries + 1)):
        try:
            r = httpx.post(
                OPENROUTER_URL, headers=headers, json=body,
                timeout=_timeout_seconds(cfg),
            )
            if r.status_code >= 400:
                raise OpenRouterError(f"HTTP {r.status_code}")
            content = r.json()["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise OpenRouterError("empty completion")
            return content
        except (httpx.HTTPError, KeyError, IndexError, ValueError, OpenRouterError) as exc:
            last = exc
    raise OpenRouterError(f"{type(last).__name__}: {last}")


def _extract_json(raw: str) -> Any:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.M).strip()
    try:
        return json.loads(raw)
    except ValueError:
        m = re.search(r"\{.*\}", raw, flags=re.S)
        if not m:
            raise OpenRouterError("no JSON in completion")
        return json.loads(m.group(0))


_SENT_SYS = (
    "You classify the overall sentiment of a Ukrainian news article. "
    'Reply with ONLY JSON: {"label": "positive"|"neutral"|"negative", '
    '"confidence": number between 0 and 1}.'
)
_NER_SYS = (
    "You extract named entities from a Ukrainian news article. Types: "
    "PER (person), ORG (organization), LOC (location), MISC (other). "
    'Reply with ONLY JSON: {"entities": [{"text": "<exact substring as it '
    'appears in the article>", "type": "PER|ORG|LOC|MISC"}]}. No duplicates.'
)


class OpenRouterAnalyzer:
    def __init__(self, cfg: AppConfig | None = None) -> None:
        self.cfg = cfg or load_config()
        if not self.cfg.openrouter_usable():
            raise RuntimeError("OPENROUTER_API_KEY is not configured")
        self.model_id = self.cfg.openrouter_model

    def predict_sentiment(
        self, article_id: str, content_hash: str | None, text: str,
        *, predicted_at: datetime,
    ) -> SentimentPrediction:
        base = dict(article_id=article_id, content_hash=content_hash,
                    model_id=self.model_id, predicted_at=predicted_at)
        if not text or not text.strip():
            return SentimentPrediction(
                **base, status=STATUS_MISSING_INPUT, error_reason=REASON_MISSING_INPUT)
        try:
            data = _extract_json(_chat(self.cfg, _SENT_SYS, text[:MAX_CHARS]))
            label = str(data.get("label", "")).strip().lower()
            if label not in SENTIMENT_LABELS:
                raise OpenRouterError("invalid label")
            conf = data.get("confidence")
            conf = min(1.0, max(0.0, float(conf))) if isinstance(conf, (int, float)) else None
        except Exception:  # noqa: BLE001
            return SentimentPrediction(
                **base, status=STATUS_INFERENCE_ERROR, error_reason=REASON_MODEL_ERROR)
        return SentimentPrediction(**base, status=STATUS_OK, label=label, confidence=conf)

    def detect_entities(
        self, article_id: str, content_hash: str | None, text: str,
        *, predicted_at: datetime,
    ) -> NerPrediction:
        base = dict(article_id=article_id, content_hash=content_hash,
                    model_id=self.model_id, predicted_at=predicted_at)
        if not text or not text.strip():
            return NerPrediction(
                **base, status=STATUS_MISSING_INPUT, error_reason=REASON_MISSING_INPUT)
        try:
            analyzed = text[:MAX_CHARS]
            data = _extract_json(_chat(self.cfg, _NER_SYS, analyzed))
            items = data.get("entities", [])
            if not isinstance(items, list):
                raise OpenRouterError("entities not a list")
            entities: list[Entity] = []
            seen: set[tuple[str, int]] = set()
            for it in items:
                if not isinstance(it, dict):
                    continue
                surface = str(it.get("text", "")).strip()
                etype = str(it.get("type", "MISC")).strip().upper()
                if etype not in ENTITY_TYPES:
                    etype = "MISC"
                if not surface:
                    continue
                pos = analyzed.find(surface)
                if pos < 0:  # model hallucinated / altered the surface form
                    continue
                key = (surface, pos)
                if key in seen:
                    continue
                seen.add(key)
                entities.append(Entity(etype, surface, pos, pos + len(surface), None))
            entities.sort(key=lambda e: e.start)
        except Exception:  # noqa: BLE001
            return NerPrediction(
                **base, status=STATUS_INFERENCE_ERROR, error_reason=REASON_MODEL_ERROR)
        return NerPrediction(**base, status=STATUS_OK, entities=entities)
