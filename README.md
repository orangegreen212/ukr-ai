# Ukrainian AI Intelligence Platform

Local web application for Ukrainian news intelligence. It collects news from public RSS
feeds, runs sentiment analysis and named-entity recognition on article text, detects faces
and estimates visible facial expressions in images, and shows text and image analysis
together for the same record. Backend: FastAPI; dashboard: React + Vite; CPU-only, no paid
APIs.

## 1. Features

| Feature | State |
|---|---|
| Live RSS ingestion | 9 enabled sources: 8 Ukrainian full-content (Українська правда, УНІАН, ОБОЗ.ua, Главком, Слово і діло, TSN, LIGA.net, НВ) + The Kyiv Independent (metadata-only) |
| Per-source isolation | Each source is fetched independently; status, article count and error are returned per source |
| Article storage | Title, summary fragment, `canonical_url`, publisher, timestamps |
| Analysis eligibility | Only `analysis_status=eligible` (Ukrainian full-content) records enter NLP; metadata-only records return HTTP 422 `article_not_analyzable` |
| Sentiment analysis | `ssb000ss/regional-sentiment-ru` @ `e973405f…`, local CPU inference |
| Named entity recognition | `ukr-models/uk-ner` @ `5dbb7e2d…`, character offsets, PER / ORG / LOC |
| Frequent entities | Entity counts across the first N articles of the current list |
| Image analysis | DeepFace 0.0.103 + ONNX Runtime: face detection and per-face expression estimate; images are not stored |
| Multimodal analysis | One `multipart/form-data` request returns NLP and vision results for the same record |
| Dashboard | Overview, News Intelligence (feed, filters, article detail with NLP panel), Image Analysis, System Status |
| Live ⇄ Demo | Live by default; demo fixtures are an explicit opt-in (`is_demo_data=true`) |

### Verified live run (2026-11-15)

| Check | Result |
|---|---|
| `/articles?limit=20` | 20 articles, 8 publishers |
| Article analysis | `oboz-21c943b24a5b` → neutral 60.8%, NER ok (0 entities); `slovo_i_dilo-d93a40242e53` → neutral 63.2%, NER ok (LOC «Китай», LOC «США») |
| Frequent entities (10) | 10 analyzed / 0 failed |
| Sentiment distribution (50) | 50 analyzed / 0 failed — positive 32 / neutral 13 / negative 5 |
| `POST /vision/analyze` | HTTP 200 (~2.4 s): 1 face, `happy`, detection confidence 0.88 |
| Dashboard image test | 1 face, `happy` 100%, detection confidence 91.0% |

## 2. Architecture

```
┌──────────────────────────────┐       ┌─────────────────────────────────────┐
│ Frontend (React + Vite :5173)│──HTTP─▶│ Backend (FastAPI + Uvicorn :8000)   │
│  Overview / News / Image /   │       │  /api/v1: health, mode, articles,   │
│  System Status               │       │  analysis, vision, multimodal,      │
└──────────────────────────────┘       │  analytics                          │
                                       └───────┬───────────────┬─────────────┘
                                               │               │
                                 ┌─────────────▼─────┐   ┌─────▼─────────────────┐
                                 │ RSS ingestion      │   │ Local model inference │
                                 │ 9 enabled sources, │   │  sentiment + NER      │
                                 │ per-source status  │   │  DeepFace + ONNX      │
                                 └────────────────────┘   └───────────────────────┘
```

- One API process; CORS enabled only when `FRONTEND_ALLOWED_ORIGINS` is set.
- Inference is CPU-only; model loading is lazy, thread-safe and attempted once per process.
- Live ingestion performs one bounded fetch per enabled source per request.

## 3. Technologies used

| Layer | Technology |
|---|---|
| Backend | Python 3.14, FastAPI, Uvicorn, pydantic |
| Ingestion | `requests`-based RSS/Atom adapters, source registry |
| NLP | `transformers` 5.20.2, `torch` 2.14.1 (CPU); `ssb000ss/regional-sentiment-ru`, `ukr-models/uk-ner` |
| Computer Vision | DeepFace 0.0.103, ONNX Runtime, local SHA-256-verified weights |
| Frontend | React 18, Vite 7, TypeScript 5.5, Tailwind CSS 3.4, lucide-react |
| Testing | pytest, vitest + Testing Library |
| Tooling | PowerShell scripts for collection, annotation transcription, dataset promotion, end-to-end demo |

## 4. Project structure

```
ukrainian_ai/
├── app/                     # FastAPI backend
│   ├── api/                 # v1 routes, multimodal endpoint, analytics, eligibility gate
│   ├── ingestion/           # source registry, RSS adapters, fetch service
│   ├── nlp/                 # sentiment + NER adapters, schemas, interfaces
│   └── vision/              # DeepFace adapter, weight verification, schemas
├── frontend/                # React + Vite dashboard
│   └── src/{components,pages,services,hooks,lib,types,test}
├── data/
│   ├── samples/             # demo fixtures + vision smoke-test image
│   └── eval/                # sentiment reference datasets, worksheets, manifests
├── evaluation/              # dataset merge/promotion tooling
├── scripts/                 # collection, transcription, promotion, E2E demo
├── tests/                   # offline pytest suite
├── docs/                    # milestone reports, runbooks, presentation pack, proposal
├── .deepface/weights/       # ONNX facial-expression weights
├── SPEC.md                  # milestone definitions
├── RESOURCES.md             # resource register and decision log
├── COURSE_REQUIREMENTS.md   # course requirements vs project decisions
├── requirements.txt
├── pyproject.toml
└── .env.example             # configuration template
```

## 5. Installation

Verified on Windows with Python 3.14.3, Node 24.16.0, npm 11.15.0.

```powershell
# Backend dependencies
python -m venv .venv
.venv\Scripts\Activate.ps1
.venv\Scripts\python.exe -m pip install -r requirements.txt

# Frontend dependencies
cd frontend
npm install
cd ..
```

Local model artifacts must be present before the first analysis (the app never downloads
them at runtime):

- sentiment snapshot `ssb000ss/regional-sentiment-ru` @ `e973405f…` (`SENTIMENT_SNAPSHOT_DIR`
  or the local Hugging Face cache);
- NER snapshot `ukr-models/uk-ner` @ `5dbb7e2d…` (`NER_SNAPSHOT_DIR` or the same cache);
- DeepFace expression ONNX weights in `.deepface\weights\`.

Copy `.env.example` to `.env` and adjust values if needed. Ports **8000** (backend) and
**5173** (frontend) must be free.

## 6. Usage

Backend (terminal A, project root):

```powershell
$env:PYTHONIOENCODING="utf-8"
$env:FRONTEND_ALLOWED_ORIGINS='http://localhost:5173'
.venv\Scripts\python.exe -X utf8 -m uvicorn app.api.main:app --host 127.0.0.1 --port 8000
```

Frontend (terminal B):

```powershell
cd frontend
npm run dev
```

Open **http://localhost:5173**. Health: `http://127.0.0.1:8000/api/v1/health`; API docs:
`http://127.0.0.1:8000/docs`.

| Page | Purpose |
|---|---|
| Overview | Backend status, feed mode, article count, module links |
| News Intelligence | Live/demo switch, filters, source status, article list and NLP detail |
| Image Analysis | Image upload, face detection, expression estimates |
| System Status | Health snapshot, batch sentiment, integration state |

Live and demo:

- Live is the default after startup (`GET /api/v1/mode` → `{"mode":"live"}`).
- Demo is enabled from the UI switch or `POST /api/v1/mode` with `{"mode":"demo"}`.
- Switch back with the UI or `POST /api/v1/mode` with `{"mode":"live"}`.

API endpoints (`/api/v1`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness and integration status |
| GET / POST | `/mode` | Read or switch serving mode |
| GET | `/articles?limit=N` | Article list with per-source statuses |
| GET | `/articles/{id}` | One article |
| POST | `/articles/{id}/analysis` | Sentiment + NER for that article |
| GET | `/analytics/frequent-entities?articles=N&top=N` | Aggregated entities |
| POST | `/vision/analyze` | Image upload → face detection + expression estimate |
| POST | `/multimodal/analyze` | Same-record NLP + vision (JSON or multipart) |

Example — multimodal analysis with an image:

```powershell
curl.exe -X POST http://127.0.0.1:8000/api/v1/multimodal/analyze `
  -F "text=Українська мова" `
  -F "file=@data/samples/vision_smoke_test.jpg"
```

## 7. Testing

```powershell
# Backend, from the project root
.venv\Scripts\python.exe -m pytest tests -o addopts= -q

# Frontend, from frontend\
npm run typecheck
npm run lint
npm run test
npm run build
```

Last full backend run (2026-11-24): **656 passed / 2 skipped** in 65 s. Frontend vitest:
**8 passed**.

End-to-end demo (live → demo → restore):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\demo_e2e.ps1
```

## 8. Future improvements

1. Expand the labeled sentiment dataset and fine-tune the classifier.
2. Build a gold Ukrainian NER set for precision / recall / F1 evaluation.
3. Evaluate expression estimates on a labeled face benchmark.
4. Add a TTL cache and per-source caps to live ingestion.
5. Serve a production frontend build instead of the Vite dev server.
6. Deploy the frontend to a static host and keep the backend reachable via a tunnel or a
   small VM.
