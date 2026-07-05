# Pattern Studio

Last Updated: 2026-07-05

Cross-platform app for analyzing and interactively following Perler bead and cross-stitch patterns. Upload a pattern image or PDF; the backend detects the grid and recognizes symbols; then follow along cell-by-cell on web or mobile with progress tracking, filtering, stats, and exports.

## Architecture

```
shared-core/   TypeScript business logic shared by web + mobile
               (types, API client, Zustand store, progress/filter/search/export logic, design tokens)
web/           React (Vite) web app — Canvas renderer, Dexie/IndexedDB persistence
mobile/        React Native (Expo) app — Skia renderer, expo-sqlite persistence
backend/       FastAPI image-processing server — OpenCV grid detection, perceptual-hash
               symbol grouping, Tesseract OCR, PNG/CSV/PDF export
```

Platform-specific code (file picking, rendering, storage) lives in `web/` and `mobile/`; everything else is in `shared-core/`, consumed by both apps as a local package (`"@pattern-studio/core": "file:../shared-core"`).

## Data flow

1. Client uploads image/PDF → `POST /upload` → `job_id`
2. Client polls `GET /job/{id}` (state, stage, progress 0–1)
3. `GET /job/{id}/result` → `GridData` (rows, cols, cells with `symbol_id` + confidence, symbol table with thumbnail / OCR text / dominant color / count)
4. Client creates a local Project (grid + sparse progress map + viewport + notes/tags), persisted locally (Dexie on web, SQLite on mobile). Progress auto-saves (debounced) including zoom/pan position.
5. Exports go back through `POST /job/{id}/export` with the current filter + progress so the output matches what the user sees.

## Key contracts (shared-core/src/types.ts)

- `CellStatus`: `not_started → completed → skipped → needs_review` (tap cycles in this order)
- `Project.progress` is a **sparse** map `"row:col" → {status, updated_at}` — untouched cells are implicitly `not_started`
- Filter modes: `show_only` (others dimmed/transparent), `highlight` (selected bright yellow — or cyan in colorblind mode — others gray), plus independent `hideCompleted`; multi-symbol selection supported
- All API JSON is snake_case; the TS types mirror the wire format exactly (no mapping layer)

## Running it

Backend (needs Python 3.10+; Tesseract and Poppler optional but recommended — see `backend/README.md`):

```
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Web:

```
cd shared-core && npm install && npm run build
cd ../web && npm install && npm run dev     # http://localhost:5173, set VITE_API_URL if backend isn't on :8000
```

Mobile (Expo):

```
cd mobile && npm install && npx expo start
```

On a physical device set the backend URL in the app's settings (Projects tab) to your PC's LAN IP, e.g. `http://192.168.1.x:8000`.

If you change `shared-core`, run `npm run build` there again (or `npm run build:core` from the repo root) so web/mobile pick up the new `dist/`.

## Future-ready hooks (designed in, not yet implemented)

- **Color matching**: `PatternSymbol.color_name` / `color_code` are already in the model (null today); a backend stage can fill them from a Perler/DMC table and search already matches on them.
- **AI uncertainty flagging**: every cell carries `confidence` (0–1) from the recognizer; a UI pass can auto-mark low-confidence cells `needs_review`.
- **Smart progress / section mode / heat map**: renderers already resolve a per-cell `CellRenderState` through one pure function (`cellRenderStateFast`) — new modes are additional branches there, no renderer rewrite.
- **Color replacement**: counts are always derived (`computeStats`), never stored, so remapping `symbol_id → color` recalculates for free.
- **Cloud sync**: all persistence goes through the single `ProjectStorage` interface; a sync-capable implementation can be swapped in per platform.

## Changelog

- 2026-07-05 — Initial build: monorepo scaffolded; shared-core written and typechecked; backend, web, and mobile implemented.
