# Milestone Report — M0 + Online Edition Scope Reduction

**Model**: Nemotron 3.5 Lightning Free  
**Provider**: opencode  
**Date**: 2026-11-20  

## Summary
Implemented the user's requested simplification for the online edition: image recognition is omitted; only sentiment + NER are supported; placeholders replace photo analysis UI. Original project completely untouched.

## Completed Items
- Backend config overhauled for OpenRouter (`OPENROUTER_API_KEY`, `openrouter/free`, timeouts, rate limits); LM Studio/DeepFace/Supabase removed
- Backend API routes simplified: `POST /articles/{id}/analysis` (sentiment + NER only); vision/multimodal/LLM routes removed
- Frontend: ImagePage, VisionResultView, LlmPanel, FrequentEntitiesPanel removed from codebase
- Frontend: Image upload UI replaced with placeholder ("Image analysis is not available in the online edition. Only sentiment and named-entity recognition are supported.")
- Frontend: Sentiment display shows label + model ID + evaluation status (no calibrated confidence)
- Frontend: NER displays Ukrainian surface forms PERSON/ORGANIZATION/LOCATION with evidence spans
- Frontend types updated: removed Vision/Face/LLM interfaces
- New files: `backend/requirements.txt`, `.env.example`, `README.md` (skeleton), `vercel.json`, `MILESTONE_REPORT.md`, `milestone_summary.md`
- Removed frontend files: `ImagePage.tsx`, `LlmPanel.tsx`, `VisionResultView.tsx`, `visionUpload.ts`
- Original project at `C:\Users\user\Documents\ukrainian_ai` completely untouched

## Files Changed (online edition)
- `backend/app/config.py` — OpenRouter config, removed LM Studio/DeepFace/Supabase
- `backend/app/api/analysis.py` — sentiment + NER only; eligibility gate preserved
- `backend/app/api/v1.py` — removed vision/multimodal/LLM routes
- `frontend/src/types/routes.ts` — removed 'image' from Route
- `frontend/src/types/api.ts` — removed Vision/Face/LLM interfaces
- `frontend/src/App.tsx` — removed ImagePage routing, removed LlmPanel
- `frontend/src/pages/NewsPage.tsx` — removed FrequentEntitiesPanel, multimodal/image UI; added placeholder; sentiment + NER per-article analysis kept
- `frontend/src/components/Sidebar.tsx` — removed Image navigation
- `frontend/src/pages/StatusPage.tsx` — removed BatchSentimentCard, LM Studio card
- `frontend/src/pages/OverviewPage.tsx` — removed Image Analysis ActionCard; updated capabilities
- `frontend/src/config.ts` — removed vision/llm timeouts
- `frontend/src/lib/normalize.ts` — removed vision accessors, removed sentimentColor
- `frontend/src/services/api.ts` — removed vision/multimodal/LLM/frequent-entities/batch-sentiment API functions; updated error codes

## New Files
- `backend/requirements.txt` — lean deps (no deepface/torch by default)
- `.env.example` — OPENROUTER_API_KEY placeholder + ingestion defaults
- `README.md` — skeleton with placeholders only
- `vercel.json` — Vercel Services config (frontend + backend services)
- `MILESTONE_REPORT.md` — this summary

## Invariant
Original project `C:\Users\user\Documents\ukrainian_ai` untouched — only read operations and copies out of it were performed. No real secrets copied; `.env.example` placeholders only.

## Next Step
User review of the online edition structure. Run `npm run typecheck && npm run lint && npm run build` in `frontend/` and `.venv\Scripts\python.exe -m pytest tests -o addopts= -q` in original project for verification. Then proceed to M1/M2 or deployment as approved.