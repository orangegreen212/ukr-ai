# M0 Report — Inspect and plan (online edition)

**Date**: 2026-11-20

## Original inspection
- Original project root: `C:\Users\user\Documents\ukrainian_ai`
- Target directory: `C:\Users\user\Documents\ukr_ai_online` (was empty, now populated)
- Python: not available in current environment; original .venv uses Python 3.14
- Node: v24.16.0, npm 11.15.0
- Architecture: FastAPI + React + Vite + TypeScript

## Plan adopted
Per the user's request: strongly consider omitting image recognition from the online version; keep only sentiment + NER; use placeholders instead of photo analysis.

## What was done (M0 + initial implementation)
1. Inspected original project structure, backend, ingestion, NLP contracts, LLM client, frontend pages/components, config, requirements, demo fixtures, tests.
2. Confirmed target dir existed and was empty (0 entries).
3. Created target skeleton and copied reusable files (54 files currently): ingestion modules, `models.py`, `data/demo.py`, `demo_articles.json`, `api/errors.py`, `api/eligibility.py`, full `frontend/src`, `public`, frontend config files.
4. **Backend config** (`backend/app/config.py`): Replaced LM Studio/Supabase/DeepFace config with OpenRouter (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL=openrouter/free`, timeouts, rate limits). Removed `db_enabled` (omitted from online edition).
5. **Backend analysis routes** (`backend/app/api/analysis.py`): Kept sentiment + NER only; vision removed; eligibility gate preserved.
6. **Backend v1 routes** (`backend/app/api/v1.py`): Removed vision, multimodal, LLM routes; kept analysis route.
7. **Frontend types**: Removed `'image'` from Route; removed Vision/Face/LLM interfaces from api.ts.
8. **Frontend App.tsx**: Removed ImagePage routing, removed LLM panel.
9. **Frontend NewsPage.tsx**: Removed FrequentEntitiesPanel, multimodal analysis, image upload UI; kept per-article sentiment + NER; added placeholder where image analysis was.
10. **Frontend Sidebar.tsx**: Removed Image navigation.
11. **Frontend StatusPage.tsx**: Removed BatchSentimentCard, LM Studio card.
12. **Frontend OverviewPage.tsx**: Removed Image Analysis ActionCard; updated capabilities section.
13. **Frontend config.ts**: Removed vision/llm timeouts.
14. **Frontend normalize.ts**: Removed vision accessors, removed sentimentColor.
15. **Frontend services/api.ts**: Removed vision, multimodal, LLM, frequent-entities, batch-sentiment API functions; updated error codes.
16. **New files**: `backend/requirements.txt`, `.env.example`, `README.md` (skeleton), `vercel.json`, `milestone_summary.md`.
17. **Removed files**: `ImagePage.tsx`, `LlmPanel.tsx`, `VisionResultView.tsx`, `visionUpload.ts` from frontend.

## Original project invariant
- `C:\Users\user\Documents\ukrainian_ai` completely untouched — only read operations and copies out of it were performed.
- No `.env` with real secrets was copied; `.env.example` contains placeholders only.

## Next step
Run frontend `npm run typecheck && npm run lint && npm run build` to verify consistency. Then user review before proceeding.