# Ukrainian AI Intelligence Platform

Local, course-project MVP (MVP scope defined in `SPEC.md`, milestone plan in
`AGENTS.md`) that ingests **Ukrainian-language news RSS**, runs **NLP analysis**
(sentiment + named entity recognition) and **image analysis** (face detection
and a visible facial-expression *estimate*), and combines both modalities into
a **same-record multimodal view** for an article — all on a CPU-only Windows
machine with no paid APIs.

The problem it addresses: a news reader has no single view that ties the
*language* of an article (tone, entities) to the *image* attached to it.
This platform serves both, per record, in one local web app.

> **Honest-data policy.** All model outputs (sentiment, NER, vision) are
> *estimates*, promoted only when the pipeline succeeds. `evaluation_status`
> is `unreviewed` on all records: technical inference success is **not**
> quality validation. Facial-expression output is a visible-expression
> estimate and is not a claim about a person's actual emotion or intent.

---

## 1. Features (verified in implementation)

| Feature | Status | Where |
|---|---|---|
| Live Ukrainian multi-source RSS ingestion — **10 registered sources** (`app/ingestion/source_registry.py`): the legacy Pravda integration (behavior unchanged + fallback feed) + eight Ukrainian full-content sources + The Kyiv Independent (metadata-only); excerpt-only storage, custom User-Agent, bounded parallel fetch with per-source failure isolation | implemented; depends on external source availability | `app/ingestion/rss_fetch.py`, `source_adapter.py`, `service.py` |
| Analysis-eligibility gate: only `analysis_status=eligible` records (Ukrainian full-content) enter NLP analysis; metadata-only records are refused with HTTP 422 `article_not_analyzable` — Kyiv Independent headlines are never routed to Ukrainian NLP | implemented | `app/api/eligibility.py` |
| Explicit Demo mode with synthetic fixtures (`data/samples/demo_articles.json`, `is_demo_data=true`) | implemented; **explicit opt-in**, never a silent fallback | `app/api/v1.py`, mode routes |
| Sentiment analysis (Ukrainian news titles) | implemented; runtime model `ssb000ss` (`e973405f`) | `app/nlp` pipeline |
| Named Entity Recognition (Ukrainian) | implemented; **no precision/recall/F1 measured** (no gold NER dataset) | same pipeline |
| Frequent Entities aggregation across the current article list | implemented (M6 Slice A) | `app/api/analytics.py`, frontend panel |
| Per-source ingestion statuses in the API response (`ArticlesResponse.sources`) + frontend **Per-source ingestion status** strip, source/language/date filters and a **Metadata only** badge on records excluded from Ukrainian NLP | implemented (multi-source expansion Slices A–B) | `app/api/v1.py`, `frontend/src/components/ArticleCard.tsx`, `frontend/src/pages/NewsPage.tsx` |
| Image analysis: DeepFace face detection + visible facial-expression estimate | implemented; `.deepface/weights/facial_expression_model_weights.onnx` present locally (no download needed) | `app/vision`, `POST /api/v1/vision/analyze` |
| Same-record multimodal analysis (article text + image upload in one request) | implemented (`multipart/form-data`, single-request guarantee) | `app/api/multimodal.py` |
| Frontend: Overview / News Intelligence / Image Analysis / System Status pages, Live⇄Demo switch, entity panel, article detail with combined NLP+vision | implemented (React + Vite + TypeScript) | `frontend/src` |

Distinctness of data shown in the UI:

- **Live data** — real RSS records fetched per request (`mode=live`); every
  record carries `source_id` / `source_language` / `analysis_status`; per-source
  outcomes (including honest per-source errors) are in `sources`.
- **Metadata-only records** (The Kyiv Independent) hold only headline + URL +
  language; a "Metadata only" badge is shown and NLP analysis on them is
  refused with `article_not_analyzable` — by policy, never a failure.
- **Live stale** — live fetch failed but cached real articles exist
  (`mode=live_stale`, error is surfaced; UI shows a banner + retry).
- **Live error** — live fetch failed, nothing cached → empty list
  (`mode=live_error`), never silently replaced by synthetic data.
- **Demo fixtures** — synthetic records, always flagged
  `is_demo_data=true` with an explicit Ukrainian `usage_note`.
- **Model-generated analysis** — every sentiment/NER/vision section carries
  `model_id`, `model_revision`, `predicted_at`, `evaluation_status`
  (currently `unreviewed`).

## 2. Architecture

```
┌─────────────────────────┐        ┌───────────────────────────────┐
│ Frontend (React+Vite:5173) │─HTTP──▶│ Backend FastAPI (uvicorn:8000) │
│  News / Image / Status  │        │  /api/v1/* (health, mode,      │
└─────────────────────────┘        │  articles, analysis, vision,   │
                                     │  multimodal, analytics, llm)   │
                                     └──────┬──────────────┬─────────┘
                                            │              │
                                  ┌─────────▼──────┐  ┌────▼────────────────┐
                                  │ RSS ingestion   │  │ On-DB / in-process   │
                                  │ (10-source      │  │ model inference:     │
                                  │ registry,       │  │  sentiment + NER     │
                                  │ excerpt-only)   │  │  (eligible records   │
                                  └────────────────┘  │  only) + DeepFace    │
                                                      │  vision; LM Studio   │
                                                      │  optional — off      │
                                                      └───────────────────────┘
```

- One API process; CORS enabled only when `FRONTEND_ALLOWED_ORIGINS` is set.
- Inference is CPU-only (no CUDA assumed; documented in `AGENTS.md`).
- Live ingestion performs ONE bounded fetch per enabled source per-request
  (no retries); a per-source failure is isolated and reported, it never
  blocks the other sources; if NO source succeeds the service reports
  `live_stale` (cached real records) or `live_error` (empty list), never
  synthetic data. The multi-source connection details (robots policy,
  `INGEST_*` limits, per-source records) are documented in
  `docs/ingestion.md` §8–§10.
- LM Studio-based LLM summary endpoint is **optional and disabled by
  default** (`LM_STUDIO_ENABLED=false`).
- Postgres/Supabase feed is optional and off by default (`DB_ENABLED=false`);
  demo/live in-memory serving works without any DB.

## 3. Prerequisites

Verified on the development environment (2026-11-02):

- **Windows**, project root `C:\Users\user\Documents\ukrainian_ai`.
- **Python 3.14.3** in the project's `.venv` (created locally; see
  `requirements.txt` for the exact package set: fastapi, uvicorn, pydantic,
  requests, transformers ==5.20.2, torch ==2.14.1, deepface ==0.0.103,
  onnxruntime, opencv-contrib-python-headless, pillow, psycopg, httpx,
  pytest, streamlit — the last one as a fallback dashboard, unused by the
  web app).
- **Node 24.16.0 / npm 11.15.0** (frontend).
- **Model artifacts already local** (never downloaded by app code at demo
  time): sentiment and NER model snapshots; DeepFace emotion ONNX weights in
  `.deepface\weights\`.
- Free TCP ports **8000** (backend) and **5173** (frontend dev server).
- Hardware expectation: CPU inference is **slow on cold start** (documented
  in runbook; no minimum hardware is claimed).
- Environment variables per `.env.example`; no real secrets are stored.
  Key defaults: `LM_STUDIO_ENABLED=false`, `DB_ENABLED=false`,
  `FRONTEND_ALLOWED_ORIGINS` (optional; frontend CORS for dev),
  `INGEST_*` (timeouts, byte cap, per-source item cap, excerpt truncation,
  User-Agent, optional source enable/disable overrides).
- **Port notes (verified 2026-11-09):** the backend defaults to port **8000**
  and the frontend addresses `http://127.0.0.1:8000` unless
  `VITE_API_BASE_URL` is set (see `frontend/src/config.ts`) BEFORE
  `npm run dev`. If port 8000 is already taken by another local service,
  start the backend on a free port and set both:
  `$env:FRONTEND_ALLOWED_ORIGINS` to the frontend origin, and
  `$env:VITE_API_BASE_URL='http://127.0.0.1:<port>'` for the frontend shell.
  The scripted E2E demo is port-independent via its `-BaseUrl` parameter.

## 4. Install, start, and open

Two terminals are required (backend + frontend), from the project root:

```powershell
# Backend (terminal A)
.venv\Scripts\python.exe -m uvicorn app.api.main:app --host 127.0.0.1 --port 8000
```

```powershell
# Frontend (terminal B)
cd frontend
npm install          # already installed in the dev environment; keep for fresh clones
npm run dev
```

- Backend: `http://127.0.0.1:8000` (OpenAPI at `/docs`).
- Frontend: `http://localhost:5173`.
- For the frontend to reach the backend in dev mode, set
  `FRONTEND_ALLOWED_ORIGINS=http://localhost:5173` in the backend's
  environment before starting it (CORS is opt-in).

Live is the **default** serving mode after a fresh backend start.

## 5. Live and Demo modes

- **Live is default.** On startup `GET /api/v1/mode` reports
  `{"mode":"live"}`; articles endpoints perform a real RSS fetch.
- **Demo is explicitly enabled** — either via News Intelligence page's
  segmented Live/Demo switch in the browser, or via
  `POST /api/v1/mode` with body `{"mode":"demo"}`. It is never a silent
  fallback: when the live feed fails, the UI shows a banner and the exact
  mode/category (`live_stale` cached real records, or `live_error` with an
  empty list) — not demo records.
- **Return to Live** the same way: switch back in the UI or
  `POST /api/v1/mode` with `{"mode":"live"}`.
- Demo records are always identifiable inside the payload:
  `is_demo_data=true`, Ukrainian `usage_note`, `demo-` id prefix.
- The current mode is shown in the frontend (mode indicator is driven by
  `GET /api/v1/mode`).

## 6. API overview (`/api/v1`)

All request/response shapes below are the actual pydantic schemas
(`app/api/*`). Errors return a stable envelope
(`app/api/errors.py`) with `code` + human `message`; use `/docs` for the
full OpenAPI schema.

| Method | Path | Purpose | Request | Response (shape) |
|---|---|---|---|---|
| GET | `/health` (root, from `app.api.main`; mirrored on the v1 router as `/api/v1/health`) | Liveness + integration status | — | `HealthPayload` (connection, app/lm_studio flag, demo fixture check; see `/docs` for full schema) |
| GET | `/mode` | Current serving mode | — | `{"mode": "live" \| "demo"}` |
| POST | `/mode` | Switch mode | `{"mode": "demo"}` or `{"mode": "live"}` | same `AppModePayload` as GET |
| GET | `/articles` | Article list in the current mode | optional `?limit={1..MAX}` (default `DEFAULT_ARTICLES_LIMIT`) | `ArticlesResponse { mode: live\|demo\|live_stale\|live_error, feed_used, count, articles: [Article], sources: [SourceStatus], error }` — `sources` mirrors per-source ingestion outcomes (status, count, feed URL, ≤300-char one-line error) |
| GET | `/articles/{article_id}` | One article | — | `ArticleOut` (404 `article_not_found` on unknown id); carries the provenance fields `source_id`, `source_language`, `analysis_status`, `analysis_exclusion_reason` |
| POST | `/articles/{article_id}/analysis` | Run full NLP (sentiment + NER) on that article | — | `ArticleAnalysisResponse` with per-task sections (each carries `status`, `model_id`, `evaluation_status`); **422 `article_not_analyzable`** for records excluded from Ukrainian NLP (e.g. `metadata_only`) — the shared eligibility gate |
| GET | `/analytics/frequent-entities?articles={1..50}&top={1..50}` | Entity counts across the first `articles` of the current list (defaults: `articles=10`, `top=15`) | — | `FrequentEntitiesResponse { status, ingestion_mode, articles_*, entities: [{entity_type, text, count}], ... }`; `status=failed` when nothing analyzable exists |
| POST | `/vision/analyze` | Face detection + visible expression estimate on an image | `multipart/form-data`: field `file` (JPEG/PNG/GIF/BMP, ≤ 5 MiB) | vision payload with faces/boxes and per-face expression estimate; 422 malformed, 415 unsupported type, 413 oversized |
| POST | `/multimodal/analyze` | Same-record combined NLP + vision | (a) `application/json` `{"text" \| "article_id", "include_vision": bool}` — mutually exclusive, or (b) `multipart/form-data` `text` \| `article_id` + optional `file` (field name `file`) | `MultimodalResponse { nlp, vision, ... }` — `nlp.executed/result` per Phase-2 semantics; `vision.outcome ∈ {ok, failed, unavailable, not_requested}`; 422 `ambiguous_input` if both inputs are set; the `article_id` branch is subject to the same eligibility gate (422 for `metadata_only`/excluded records) |
| POST | `/articles/{article_id}/llm` | Optional local-LLM summary via LM Studio | — | `LlmAnalysisResponse`; when `LM_STUDIO_ENABLED=false` this returns the documented honest failure, **no** silent error swallow |

Example — switch to demo mode:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/v1/mode -Body '{"mode":"demo"}' -ContentType 'application/json'
```

Example — multimodal with an image (multipart; `curl.exe` is present on
every supported Windows build — `Invoke-RestMethod -Form` requires
PowerShell 6+, and Windows PowerShell 5.1 in this environment does NOT
provide it):

```powershell
curl.exe -X POST http://127.0.0.1:8000/api/v1/multimodal/analyze -F "text=Укрмова тест" -F "file=@data/samples/vision_smoke_test.jpg"
```

## 7. Testing

Verified commands (run them from the project root / `frontend`, respectively):

```powershell
# Backend tests (pytest; offline/unit suite must not require live sites,
# model downloads or a running LLM). `-o addopts=` clears project-level
# pytest addopts so offline runs never load plugin extras.
.venv\Scripts\python.exe -m pytest tests -o addopts= -q
```

```powershell
# Frontend, from `frontend\`
npm run typecheck     # tsc --noEmit -p tsconfig.app.json
npm run lint          # eslint .
npm run build         # vite build (production bundle)
```

Historical results (do not treat as re-run; latest recorded runs are from
2026-11-09, see `docs/m6_live_checkpoint_2026-11-09.md`, plus the
2026-11-14 regression run after the load-race fix, `RESOURCES.md` §38):

- Backend pytest suite (offline): **656 passed / 2 skipped** with
  `.venv\Scripts\python.exe -m pytest tests -o addopts= -q` (run
  2026-11-14; both skips are the env-gated network smoke tests, disabled
  unless `RUN_LIVE_TESTS=1`).
- Frontend: typecheck / lint / build clean; vitest **8 passed**
  (`src/test/NewsPageSliceB.test.tsx`).
- Scripted end-to-end demo: **PASS 11 / FAIL 0, exit code 0** on 2026-11-09
  (recorded per-step in the checkpoint doc §2; backend run on the free port
  8001 because port 8000 was held by an unrelated local service that day).

## 8. Limitations (disclosed, not hidden)

- **Sentiment quality.** The n=79 human-labeled benchmark
  (`data/eval/model_comparison/benchmark_report_n79_2026-11-07.md`) scores
  the runtime model `ssb000ss` at accuracy **0.418 / macro-F1 0.411**, with a
  repeated error direction of **13 negative→positive inversions (11 of them in
  the civilian-harm stratum)**. The runtime model is a **Russian-language**
  model (`ssb000ss/regional-sentiment-ru`, as disclosed in the UI); its
  quality on Ukrainian news is inherently limited. A 2026-11-09 stratified
  live-checkpoint run (24 records via the frozen production path) also showed
  a positive-heavy label distribution consistent with this known failure
  mode — recorded as model-behavior evidence only, no quality claim
  (`docs/m6_live_checkpoint_2026-11-09.md` §3).
- **CardiffNLP candidate vs runtime.** On the same 79 records the best
  candidate (`cardiffnlp/twitter-xlm-roberta-base-sentiment-multilingual`,
  revision `82107f4c…`) scored accuracy **0.671 / macro-F1 0.563** with
  **0 negative→positive errors**, ~89 ms avg on CPU (protocol with warm-up;
  snapshot-reproducibility control passed) — better than the runtime model,
  but the predefined **macro-F1 ≥ 0.60 threshold was NOT met** and its license
  (and the fine-tuning dataset license) remain **UNVERIFIED** (re-checked via
  the HF Hub API on 2026-11-07, `data/eval/model_comparison/license_audit_2026-11-07.md`).
- **Runtime retention decision (owner UA-01, latest 2026-11-08).** Runtime
  stays `ssb000ss` (+ NER `ukr-models/uk-ner @ 5dbb7e2d`); CardiffNLP is
  **SELECTED-CANDIDATE only** and the benchmark corridor is STOPPED until a
  justified new candidate appears or the license is cleared. Fine-tuning is
  defined as a *future experiment* with recorded entry gates, not started.
  All decisions recorded verbatim in
  `data/eval/model_comparison/model_selection_decision.md`.
- **No statistical significance claims** are made from this dataset.
- **NER has no precision/recall/F1.** No gold NER dataset exists for this
  project; entity predictions are shown with `evaluation_status=unreviewed`.
  No claim is made about NER accuracy.
- **`evaluation_status=unreviewed` everywhere.** Human review of predictions
  has not happened for the served articles; the flag is honest by design
  (no auto-promotion of technical success into "validated").
- **Vision scope.** Face detection and a *visible facial-expression
  estimate* only. This is not a claim about actual emotional state, intent
  or personality. Small/occluded/absent faces, non-face objects etc. produce
  honest `unavailable`/`failed` paths.
- **CPU is slow.** First NLP/vision request can be slow (cold model load).
  The demo script uses generous timeouts and prints an explicit
  "inference in progress" note per step.
- **RSS depends on the external publisher.** Live mode fails honestly
  (banner + `live_stale`/`live_error`) when the feed is unavailable;
  no synthetic records are substituted.
- **LLM endpoint is OFF by default.** `/articles/{id}/llm` returns an
  honest failure unless LM Studio is explicitly enabled and running.
- **No DB by default.** Postgres/Supabase integration is compiled in but
  off (`DB_ENABLED=false`); in-memory + RSS serving is the demo path.

## 9. Project status (M1–M6)

| Milestone | Status (with evidence) |
|---|---|
| M0 — Inspect & plan | done (env recorded; feeds smoke-tested 2026-10-23, documented) |
| M1 — Skeleton & demo data | done; demo fixtures verified (`data/samples/demo_articles.json` loads; `/health` reports `demo_ok`) |
| M2 — Live ingestion | done; **multi-source**: 10 registered sources (9 enabled with full-content or metadata-only modes, 1 disabled reserve), per-source failure isolation, honest `live_error`/`live_stale` paths; live record in `docs/ingestion.md` §10 |
| M3 — Ukrainian NLP | implemented (sentiment + NER); **quality limited**: runtime macro-F1 0.411 on n=79 real headlines (2026-11-07, honest), `evaluation_status=unreviewed`; NER has no gold metrics |
| M4 — Image processing & DeepFace | implemented; expression outputs labeled as estimates; emotion-ONNX weights local (no download) |
| M5 — API/LLM & multimodal dashboard | implemented; LLM optional/off; same-record multimodal verified (E2E demo step 2026-11-09); additive multi-source API fields + eligibility gate (2026-11-09) |
| M6 — Evaluation, hardening, presentation | **CLOSED (owner verdict 2026-11-09)**. Slices A (frequent entities + filters), B (annotation — **83 labeled / 5 ambiguous** in `sentiment_ref_ext_v5.json`), C (license/model decision), D (README + E2E script + runbook) closed; multi-source RSS expansion + eligibility gate + live smoke (2026-11-08/09, `RESOURCES.md` §25); **scripted E2E demo recorded (2026-11-09): PASS 11 / FAIL 0**; live NLP-value checkpoint (quality NOT MEASURED — honest boundary); multi-source documentation slice + free-port frontend launch verified; closeout register: `docs/m6_closeout.md`. **Standing limitations (do not represent as solved):** sentiment 83/200 annotated, CardiffNLP license UNVERIFIED → runtime switch blocked; NER has no gold dataset (no P/R/F1); vision quality evaluation limited; YOLO NOT STARTED (never presented as implemented); 7 moderate npm advisories remain |

Model-quality limitations are tracked under `#8 Limitations`; they do **not**
affect the completion status of implemented functionality, only of model
selection.

**Post-M6 dataset status (owner-directed sessions, current as of 2026-11-24):**
the sentiment reference dataset has grown from the M6-closeout 83 labeled /
5 ambiguous (`sentiment_ref_ext_v5.json`) to **192 labeled / 12 ambiguous**
(`data/eval/sentiment_ref_ext_v10.json`, neutral 89 / negative 74 / positive 29,
sha256 `0e6d45f1…58e76`). Fine-tuning remains gated: positive support 29 < 30.
History of promotions and defect fixes is recorded in `RESOURCES.md` §34–§39.

## 10. Reproducible demo

One command runs a full scripted live→demo→restore cycle, with honest
PASS/FAIL/SKIPPED reporting and safe mode restoration in `try/finally`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\demo_e2e.ps1
# If port 8000 is taken by another local service, point at a free port
# (verified 2026-11-09: PASS 11 / FAIL 0 with the backend on 8001):
powershell -ExecutionPolicy Bypass -File scripts\demo_e2e.ps1 -BaseUrl 'http://127.0.0.1:8001'
```

The script starts the backend itself if it is not already running; see
`docs\demo_runbook.md` for the full manual browser walkthrough, expected
timings, and troubleshooting.

## 11. Technologies used

| Layer | Technology | Notes |
|---|---|---|
| Backend | Python 3.14, FastAPI, Uvicorn, pydantic | one API process, OpenAPI at `/docs` |
| Ingestion | `requests`-based RSS/Atom adapters | 10 registered sources, excerpt-only storage, per-source failure isolation |
| NLP | `transformers` 5.20.2, `torch` 2.14.1 (CPU) | sentiment `ssb000ss/regional-sentiment-ru` `e973405f` (CC BY-NC-4.0); NER `ukr-models/uk-ner` `5dbb7e2d` (MIT); lazy, thread-safe single-attempt loading |
| Computer Vision | DeepFace 0.0.103 + ONNX Runtime | local SHA-256-verified weights; face detection + visible-expression estimates |
| Frontend | React 18, Vite 7, TypeScript 5.5, Tailwind CSS 3.4 | pages: Overview, News Intelligence, Image Analysis, System Status |
| Testing | pytest (offline suite), vitest + Testing Library | no live sites, weight downloads or LLM required for unit tests |
| Optional | LM Studio (OpenAI-compatible local endpoint) | disabled by default; Qwen failed Ukrainian-summary validation |
| Optional | PostgreSQL / Supabase | off by default (`DB_ENABLED=false`); in-memory serving works without it |

## 12. Project structure

```
ukrainian_ai/
├── app/                      # FastAPI backend
│   ├── api/                  # v1 routes, multipart multimodal, analytics, eligibility gate
│   ├── ingestion/            # RSS source registry, adapters, fetch service
│   ├── nlp/                  # sentiment + NER adapters, schemas, interfaces
│   ├── vision/               # DeepFace adapter, weight verification, schemas
│   ├── database/             # optional Postgres persistence
│   ├── llm/                  # optional LM Studio client
│   └── ui/                   # legacy Streamlit fallback dashboard
├── frontend/                 # React + Vite dashboard
│   └── src/{components,pages,services,hooks,lib,types,test}
├── data/
│   ├── samples/              # demo fixtures + vision smoke-test image
│   └── eval/                 # sentiment reference datasets (ext_v6…ext_v10), worksheets, manifests
├── evaluation/               # dataset merge/promotion tooling
├── scripts/                  # collection, annotation transcription, promotion, E2E demo
├── tests/                    # offline pytest suite (656 passed / 2 skipped)
├── docs/                     # milestone reports, runbooks, presentation pack, proposal
├── .deepface/weights/        # local ONNX facial-expression weights (verified)
├── SPEC.md                   # milestone definitions (single source of truth)
├── RESOURCES.md              # resource register + numbered decision/defect log (§1–§39)
├── COURSE_REQUIREMENTS.md    # separation of course-brief requirements vs project decisions
└── .env.example              # configuration template (no secrets in source control)
```

## 13. Future improvements

1. **Sentiment fine-tuning** — blocked by the per-class support gate (positive 29/30,
   needs ≥ 30 labeled positives; batch sr-0205…sr-0208 awaiting owner labels). The
   Ukrainian reference dataset currently holds 192 labeled records (neutral 89 /
   negative 74 / positive 29) plus 12 ambiguous.
2. **NER quality evaluation** — no gold Ukrainian NER dataset yet, so precision/recall/F1
   remain unmeasured; a small annotated entity set would close this gap.
3. **Vision quality evaluation** — expression estimates are unvalidated; a labeled
   face-expression benchmark and verification of FER2013-lineage licensing are pending.
4. **Ukrainian LLM summaries** — LM Studio path is implemented but disabled because the
   tested Qwen model failed Ukrainian-summary validation; evaluate other local models
   behind the same honest-failure contract.
5. **Ingestion hardening for public use** — add a TTL cache and per-source item caps so
   `/articles` does not fetch all sources on every request, plus authentication and
   rate-limiting before any public exposure.
6. **Deployment** — Vercel can host only the frontend; the full stack needs either a
   Cloudflare Tunnel to the local backend (PC must be on) or a free-tier ARM VM for 24/7
   hosting.
7. **Production dashboard build** — the demo runs the Vite dev server; a built static
   bundle served alongside FastAPI would simplify demo distribution.
8. **Optional YOLO stretch scope** — never started and never presented as implemented;
   out of the course requirement set.
