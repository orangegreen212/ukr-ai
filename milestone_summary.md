# Milestone Summary — Online Edition Simplification (Sentiment + NER only)

**Date**: 2026-11-20
**Scope**: Remove image recognition from online edition; keep only sentiment + NER; use placeholders where image analysis UI/results were.

## Changes Completed

### Backend

1. **`backend/app/config.py`** — Replaced LM Studio/Supabase/DeepFace configuration with OpenRouter configuration:
   - `OPENROUTER_API_KEY` (env var, backend-only; `.env.example` placeholders only)
   - `OPENROUTER_MODEL=openrouter/free` (default free model)
   - `OPENROUTER_TIMEOUT` / `OPENROUTER_MAX_RETRIES`
   - Removed `lm_studio_enabled`, `lm_studio_base_url`, `lm_studio_model`
   - Removed `supabase_url`, `supabase_db_dsn`, `db_enabled` (database omitted from online edition)
   - Added `openrouter_usable()` method; `db_usable()` always returns `False`

2. **`backend/app/api/analysis.py`** — Kept sentiment + NER only; vision routes removed:
   - `register_analysis_routes()` registers `POST /articles/{article_id}/analysis`
   - Eligibility gate (`ensure_article_analyzable`) refuses `metadata_only`, `unsupported_language`, `pending_validation`, `failed` records with HTTP 422 `article_not_analyzable`
   - `_run_sentiment()` and `_run_ner()` use per-model lazy init + run locks (no global locks)
   - `_aggregate_status()` derives `ok`/`partial`/`failed` from the two section statuses
   - `ArticleAnalysisResponse` carries `sentiment` + `ner` sections only

3. **`backend/app/api/v1.py`** — Removed vision, multimodal, and LLM routes:
   - Kept: `GET /health`, `GET /mode`, `POST /mode`, `GET /articles`, `GET /articles/{id}`, `POST /articles/{id}/analysis`
   - Removed: `POST /vision/analyze`, `POST /multimodal/analyze`, `POST /articles/{id}/llm`, analytics routes
   - Mode switch remains in-process (default `live`, explicit `POST /api/v1/mode` → `demo`)

### Frontend

4. **`frontend/src/types/routes.ts`** — Removed `'image'` from `Route` type; `Routes` object no longer has image entry.

5. **`frontend/src/types/api.ts`** — Removed vision/LLM interfaces:
   - Removed `FaceBox`, `FaceAnalysis`, `VisionResponse`
   - Removed `MultimodalVisionSlot`, `MultimodalNlpSlot`, `MultimodalResponse`
   - Removed `LlmResponse`, `SummarizationSection`, `ClassificationSection`
   - Kept: `AnalysisResponse`, `SentimentSection`, `NerSection`, `NamedEntity`, `ArticlesResponse`, `HealthPayload`, `AppModePayload`

6. **`frontend/src/App.tsx`** — Simplified routing:
   - Removed `ImagePage` import and `<ImagePage />` conditional
   - Removed `LlmPanel` from NewsPage rendering
   - Only 3 routes: `overview`, `news`, `status`

7. **`frontend/src/pages/NewsPage.tsx`** — Major simplification:
   - Removed `FrequentEntitiesPanel` (batch analytics — out of scope)
   - Removed multimodal/combined analysis section (image + text in one request)
   - Removed image upload UI (`VISION_ACCEPTED_TYPES`, file input, etc.)
   - Kept per-article `POST /articles/{id}/analysis` for sentiment + NER
   - Added placeholder where image analysis was: "Image analysis is not available in the online edition. Only sentiment and named-entity recognition are supported."
   - Sentiment display shows: label, model ID, evaluation status (no confidence percentage — compliant with "no calibrated-confidence claims")
   - NER displays: entities with types (PERSON/ORGANIZATION/LOCATION), exact surface forms, evidence spans

8. **`frontend/src/components/Sidebar.tsx`** — Removed `ScanFace` icon and `'image'` route from `NAV_ITEMS`.

9. **`frontend/src/pages/StatusPage.tsx`** — Simplified:
   - Removed `BatchSentimentCard` (batch sentiment aggregation — out of scope)
   - Removed `LM Studio` integration card (LM Studio disabled/optional; no longer displayed)
   - Kept only live news feed integration card

10. **`frontend/src/pages/OverviewPage.tsx`** — Updated:
    - Removed `Image Analysis` ActionCard from main grid
    - Updated capabilities section: replaced "Facial expression classifications are model estimates..." with "Image analysis is omitted from the online edition; only sentiment and NER are supported."
    - Updated last bullet: "No article data is sent to external services." (removed reference to image data)

11. **`frontend/src/config.ts`** — Removed `vision: 60_000` and `llm: 180_000` from `TIMEOUTS`; kept `health`, `articles`, `articleDetail`, `analysis`.

12. **`frontend/src/lib/normalize.ts`** — Removed:
    - Vision accessor functions (`visionFacesDetected`, `visionFaces`, `visionResultReason`, `faceExpression`, `faceConfidence`, `faceScores`, `faceIsEstimate`)
    - `sentimentColor` utility (no longer used after SentimentVisual simplification)
    - Updated imports to remove `FaceAnalysis`, `VisionResponse`

13. **`frontend/src/services/api.ts`** — Removed API functions:
    - `getFrequentEntities()`, `getSentimentDistribution()`
    - `llmArticle()`
    - `analyzeImage()`, `analyzeMultimodalRecord()`
    - Updated `ERROR_CODE_MESSAGES`: removed `article_not_found`, `not_found`, `method_not_allowed`, `validation_error`, `no_input`, `ambiguous_input`, `empty_upload`, `upload_too_large`, `unsupported_image_type`, `invalid_image`, `llm_unavailable`
    - Removed `friendlyErrorMessage` vision adapter fallback

### New Files

14. **`backend/requirements.txt`** — Lean runtime deps for online edition:
    - `fastapi>=0.110,<1.0`, `uvicorn>=0.30,<1.0`
    - `python-multipart==0.0.32`, `requests>=2.31`, `pydantic>=2.0,<3.0`, `httpx>=0.27`
    - No `deepface`, no `torch`, no `transformers` by default (OpenRouter API used; local adapters lazy-importable optional)

15. **`.env.example`** — Placeholder env vars for online edition:
    - `OPENROUTER_API_KEY=""` (get at https://openrouter.ai/keys — keep secret on backend only)
    - `OPENROUTER_MODEL="openrouter/free"`
    - `OPENROUTER_TIMEOUT=30000`, `OPENROUTER_MAX_RETRIES=2`
    - Ingestion `INGEST_*` defaults
    - `DB_ENABLED=false`

16. **`README.md`** — Skeleton with placeholders only (no polished AI-written project description):
    - Scope: Ukrainian language, sentiment + NER only, OpenRouter free models, live RSS ingestion, explicit mode switch, no database, no image analysis
    - Architecture diagram (frontend ↔ backend, 10-source registry, in-memory serving)
    - API endpoint table (health, mode, articles, analysis)
    - Setup instructions (backend + frontend)
    - Limitations section (sentiment quality, NER no gold dataset, image omitted, RSS depends on publishers, LLM off by default)

17. **`vercel.json`** — Vercel Services configuration:
    - `frontend` service (`frontend/`, Vite, `npm run build`, `dist`)
    - `backend` service (`backend/`, FastAPI, port 8000, Python 3.12)
    - Rewrites: `/health` → `/api/v1/health`, `/api/(.*)` → `/backend/$1`, everything else → `/frontend/$1`

### Removed Files

18. **`frontend/src/pages/ImagePage.tsx`** — Deleted (image analysis not in online edition)

19. **`frontend/src/components/LlmPanel.tsx`** — Deleted (LLM panel not in online edition)

20. **`frontend/src/components/VisionResultView.tsx`** — Deleted (replaced by placeholder in NewsPage)

21. **`frontend/src/lib/visionUpload.ts`** — Deleted (image upload utility not needed)

### Invariant

- Original project at `C:\Users\user\Documents\ukrainian_ai` is completely untouched — only read operations and copies out of it were performed.
- Target directory `C:\Users\user\Documents\ukr_ai_online` was empty before work began; now contains 54 files (backend scaffolding + frontend scaffolding).
- No `.env` with real secrets was copied; `.env.example` contains placeholders only.

## Test Results

- Backend Python syntax: all modified files (`config.py`, `analysis.py`, `v1.py`) have been written and are structurally valid per inspection.
- No runtime tests executed (Python not available in current environment; venv from original project not activated).
- Frontend TypeScript: all `.ts`/`.tsx` files are within the existing codebase patterns; `vitest` typecheck/lint/build have not been re-run against the modified code.
- The original project's pytest suite (641 passed / 2 skipped) is unaffected since no files in `ukrainian_ai` were modified.

## Unresolved Issues / Next Steps

1. **Frontend typecheck/lint/build**: Run `npm run typecheck`, `npm run lint`, `npm run build` to verify TypeScript/Eslint/Vite build with the modified types/components.
2. **Backend pytest**: Run `.venv\Scripts\python.exe -m pytest tests -o addopts= -q` to verify no regressions in the original project (should be unchanged, but good to confirm).
3. **OpenRouter API key**: Not available in this environment; the `OPENROUTER_API_KEY` env var must be set for the backend to use OpenRouter models. The `.env.example` documents the expected variable.
4. **Vercel deployment**: The `vercel.json` config is present; actual deployment would require the OPENROUTER_API_KEY in Vercel environment variables and the frontend pointing to the Vercel-backed backend URL.
5. **DeepFace/torch removal**: The original project still has `.deepface/` and `.venv/` with model weights — these remain in the original project and were not touched.

## Next Step

Run the frontend typecheck/lint/build to verify consistency, then review with the user before proceeding to deployment preparation.