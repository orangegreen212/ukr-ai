# Ukrainian AI Intelligence Platform — Online Edition

Skeleton MVP (2026-11-20) — live RSS ingestion + sentiment + NER only.
Image analysis is omitted; placeholders replace photo analysis UI.

## Scope

- **Language**: Ukrainian only (in-scope per AGENTS.md).
- **NLP**: Sentiment analysis + Named Entity Recognition (PERSON/ORGANIZATION/LOCATION).
- **Data ingestion**: Live RSS feeds from 10 registered sources (8 Ukrainian full-content + 1 metadata-only + 1 disabled reserve), per-source failure isolation, honest `live_error`/`live_stale` paths — never synthetic data substitution.
- **Data mode**: Explicit `?mode=live|demo` query param; backend confirms switch; no silent demo fallback.
- **AI platform**: OpenRouter free models (`openrouter/free`) via `OPENROUTER_API_KEY` env var; optional/local LM Studio disabled.
- **Image analysis**: Omitted from online edition. UI shows placeholder text: "Image analysis not available in online edition — only sentiment and NER are supported."
- **No database**: In-memory + RSS serving; Postgres/Supabase optional and off by default.
- **Secrets**: `OPENROUTER_API_KEY` backend-only; `.env.example` placeholders only; never committed.

## Architecture

```
┌─────────────────────────┐        ┌───────────────────────────────┐
│ Frontend (React+Vite)   │─HTTP──▶│ Backend FastAPI (uvicorn:8000) │
│  News / Status pages    │        │  /api/v1/* (health, mode,      │
└─────────────────────────┘        │  articles, analysis)           │
                                      └──────┬──────────────┬─────────┘
                                            │              │
                                      ┌─────────▼──────┐  ┌────▼────────────────┐
                                      │ RSS ingestion   │  │ On-DB / in-memory   │
                                      │ (10-source      │  │ model inference:     │
                                      │ registry)       │  │  sentiment + NER     │
                                      └────────────────┘  │  (eligible records) │
                                                      └───────────────────┘
```

- One API process; CORS enabled only when `FRONTEND_ALLOWED_ORIGINS` is set.
- Inference is CPU-only (no CUDA assumed).
- Live ingestion performs ONE bounded fetch per enabled source per request (no retries).
- A per-source failure is isolated and reported; it never blocks other sources.
- If NO source succeeds the service reports `live_stale` (cached real records) or `live_error` (empty list), never synthetic data.

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + integration status |
| GET | `/mode` | Current serving mode (`live`/`demo`) |
| POST | `/mode` | Switch mode |
| GET | `/articles` | Article list in the current mode |
| GET | `/articles/{article_id}` | One article |
| POST | `/articles/{article_id}/analysis` | Run sentiment + NER on that article |

## Setup

1. Backend: `cd backend && python -m uvicorn main:app`
2. Frontend: `cd frontend && npm install && npm run dev`
3. Set `OPENROUTER_API_KEY` in the backend environment (`.env.example` provided).

## Deployment

Vercel-ready: `vercel` deploys the frontend + backend services (see `vercel.json`).
No paid APIs required; free OpenRouter models are used by default.

## Limitations

- Sentiment model quality on Ukrainian news is limited (runtime model is Russian-language); outputs are estimates, not verified facts.
- NER has no gold dataset; entity predictions carry `evaluation_status=unreviewed`.
- Image analysis is omitted from the online edition.
- RSS depends on external publishers; live mode fails honestly when feeds are unavailable.