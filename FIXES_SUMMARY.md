# Ukrainian AI Intelligence Platform — All Fixes Summary

## Code Changes Applied

### 1. `frontend/src/pages/NewsPage.tsx:1` — Added `useMemo` to React import
- **Before:** `import { useCallback, useEffect, useRef, useState } from 'react';`
- **After:** `import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`
- **Fixes:** `ReferenceError: useMemo is not defined` crashing the entire frontend

### 2. `frontend/src/pages/NewsPage.tsx` — Added `sourceArticleCounts` import
- **Added:** `sourceArticleCounts` to the import from `@/lib/normalize`
- **Before:** Import listed 13 functions from normalize, missing `sourceArticleCounts`
- **After:** All 14 functions properly imported
- **Fixes:** `ReferenceError: sourceArticleCounts is not defined` — this was the new error observed in the Vercel logs (the "any button = black screen" issue)

### 3. `backend/app/api/v1.py:154` — Fixed `threading.Lock()` instance
- **Before:** `_mode_lock = threading.Lock` (class, not instance)
- **After:** `_mode_lock = threading.Lock()` (instant with parentheses)
- **Fixes:** `TypeError: 'builtin_function_or_method' object does not support the context manager protocol` in `with _mode_lock:` blocks (articles API, health API)

### 4. `backend/app/config.py:load_config()` — Removed Supabase fields
- **Removed:** `supabase_url`, `supabase_db_dsn`, `db_enabled` from `AppConfig()` constructor
- **Fixes:** `TypeError: AppConfig.__init__() got an unexpected keyword argument 'supabase_url'` affecting all API endpoints

## Prior Fixes (confirmed still in place, from previous 8+ Vercel builds)
- `vercel.json` → `routes` replaced with `rewrites` (404 fix)
- `backend/app/main.py` → removed double `/api/v1` prefix
- `frontend/src/config.ts` → PROD uses relative API paths (`''`)
- `backend/app/api/v1.py` → `lm_studio_enabled` removed from health payload
- `backend/app/nlp/schemas.py` → NLP constants package created
- `backend/app/api/health/__init__.py` → minimal health module
- **Backend ingestion operational:** 179 articles from 9 RSS sources

## New Observed Error (Before Fix #2)
From Vercel logs:
```
ReferenceError: sourceArticleCounts is not defined
    Ze https://ukr-ai.vercel.app/assets/index-*.js:8
    useMemo https://ukr-ai.vercel.app/assets/index-*.js:6
    ...
Uncaught ReferenceError: sourceArticleCounts is not defined
```
This occurred because `sourceArticleCounts()` was called in `NewsPage.tsx` line 202-205 but was never imported from `@/lib/normalize`.

## After Vercel Redeploy — Verify

| Check | Expected |
|---|---|
| `curl https://ukr-ai.vercel.app/api/v1/health` | `200 OK` with valid JSON |
| `curl https://ukr-ai.vercel.app/api/v1/articles` | `200 OK`, 179 articles from 9 sources |
| News page loads (F12 Console) | No `ReferenceError: useMemo is not defined` |
| News page loads | No `ReferenceError: sourceArticleCounts is not defined` |
| Article clicking (news card → detail) | Navigates to article detail page |
| Sentiment + NER analysis on article | Works (local models, experimental) |

## Redeploy Instruction
Trigger a new Vercel redeploy from the dashboard:
https://vercel.com/code-trainer-projects/ukr-ai/deploys

Build time ~3 minutes. After deploy completes, run the verification checks above.