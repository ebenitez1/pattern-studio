# Pattern Studio

Last Updated: 2026-07-05
Repository: https://github.com/ebenitez1/pattern-studio (public)
Web app (GitHub Pages): https://ebenitez1.github.io/pattern-studio/ — fully self-contained, no backend required. All image processing runs in the browser via WebAssembly (opencv.js); projects live in the browser's IndexedDB.

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

## Web: in-browser processing (no backend)

The **web app processes patterns entirely client-side** so it runs as a pure
static site on GitHub Pages with nothing to host. The pipeline mirrors the
backend's stages, in the browser:

- `web/src/processing/loadImage.ts` — File/PDF → ImageData (pdf.js for PDFs)
- `web/src/processing/grid.ts` — opencv.js (`@techstark/opencv-js`) adaptive
  threshold + morphological line masks + projection peaks, with an
  autocorrelation pitch fallback for patterns without drawn grid lines
- `web/src/processing/symbols.ts` — per-cell perceptual hash + color, clustered
  into symbols via shared-core `clusterCells`
- `web/src/processing/ocr.ts` — optional tesseract.js (off by default; pulls
  ~15MB the first time)
- `web/src/processing/localExport.ts` — PNG (canvas), CSV, PDF (jsPDF), no server

Symbol recognition is **shape + color aware** (`shared-core/src/logic/phash.ts`):
cells are the same symbol only when both their perceptual hash and dominant
color agree, so color-coded patterns (same cell shape, different color) and
glyph-coded patterns (same background, different symbol) both resolve correctly.

The opencv.js WASM (~14MB, ~3.9MB gzipped) is a lazy chunk — it only downloads
when the user actually processes an image.

**The FastAPI backend still exists** and is used by the mobile app; the web app
no longer needs it. Porting the same in-browser pipeline to mobile (or a native
module) is a future task.

## Future-ready hooks (designed in, not yet implemented)

- **Color matching**: `PatternSymbol.color_name` / `color_code` are already in the model (null today); a backend stage can fill them from a Perler/DMC table and search already matches on them.
- **AI uncertainty flagging**: every cell carries `confidence` (0–1) from the recognizer; a UI pass can auto-mark low-confidence cells `needs_review`.
- **Smart progress / section mode / heat map**: renderers already resolve a per-cell `CellRenderState` through one pure function (`cellRenderStateFast`) — new modes are additional branches there, no renderer rewrite.
- **Color replacement**: counts are always derived (`computeStats`), never stored, so remapping `symbol_id → color` recalculates for free.
- **Cloud sync**: all persistence goes through the single `ProjectStorage` interface; a sync-capable implementation can be swapped in per platform.

## Changelog

- 2026-07-05 — Initial build: monorepo scaffolded; shared-core written and typechecked; backend, web, and mobile implemented.
- 2026-07-05 — Pushed to GitHub as private repo `ebenitez1/pattern-studio`.
- 2026-07-05 — Made repo public; added GitHub Pages deploy workflow for the web app (relative Vite base).
- 2026-07-05 — Fixed "Illegal invocation" bug: shared-core API client now binds global `fetch` to `globalThis` (calling it as `this.fetchFn(...)` rebound `this` and browsers rejected it; Node/undici didn't catch it). Also affected mobile.
- 2026-07-05 — Verified full pipeline against the live local backend (upload → poll → result → PNG/CSV/PDF export all 200).
- 2026-07-05 — **Grid detection round 2 (second real chart).** Fixed the autocorrelation pitch to return the *fundamental* period (first strong peak) instead of the global max — a harmonic was winning and giving 1/3 the columns. Replaced edge-support extent trimming with a 2D **bead-extent** trim: the grid is the largest contiguous block of rows/cols containing a "bead cell" (inset mostly coloured-or-dark, ≥50% fill), which excludes axis-number labels and the legend where light checkerboard vs. label background are pixel-identical. Background classification now covers grey/white checkerboard empties (light + desaturated + no ink), not just white. Verified against a second real 34×34 chart: 6 colours, 767 tracked beads with counts exactly matching the legend (191,179,159,129,83,26); the first chart still detects 22×21 / 12 colours / 265 exactly (no regression). Note: the grid is trimmed to the bead bounding box, so fully-empty outer border rows/cols are excluded (dims reflect the bead extent, not the chart's printed row/col count).
- 2026-07-05 — **Reworked grid detection for real numbered charts.** The old "find long dark lines" approach broke on real cross-stitch charts (rows of dark filled cells look like grid lines). Replaced with periodicity detection: directional edge projections → autocorrelation for the uniform cell pitch → phase-aligned comb → trim to the contiguous supported run (excludes outside axis-number labels, white margins, and the colour legend). Also: near-white empty cells (no printed ink) are now treated as untracked **background** (`BACKGROUND_SYMBOL_ID`) rather than a phantom "white" symbol, and clustering is **colour-dominant** (identical colours merge despite print/JPEG shape-hash noise; shape still separates glyphs on similar backgrounds). Verified against a real 22×21 DMC chart: detected 22×21, 265 tracked cells, 12 symbols with counts exactly matching the legend (73,48,37,34,23,18,17,5,4,3,2,1) — including DMC B5200 snow-white beads (distinguished from empty cells by their printed code). Simple synthetic patterns still pass (no regression).
- 2026-07-05 — Three UX changes (verified in-browser): (1) grid detection now crops to the outlined border — the bounding box of non-white content — so surrounding white margin is excluded from tracking/stats; (2) "Clear completed" button in the Stats panel resets all completed cells to Not Started (shared-core `clearStatus` + store `clearCompleted`); (3) highlight color is now a single Yellow-or-Purple choice (replaced the yellow/cyan colorblind toggle), applied consistently in the viewer and PNG export.
- 2026-07-05 — **Web app moved to fully in-browser processing (WASM)** so the Pages site needs no backend at all. Added shared-core color-aware perceptual-hash clustering; web `processing/` modules (opencv.js grid detection, pdf.js, optional tesseract.js OCR, canvas/jsPDF export). Verified in a real browser: synthetic 8×10 / 3-color pattern → detected 8×10, 3 symbols, correct colors; PNG + CSV exports correct. Two bugs found and fixed during verification: (1) morphological line kernel too short → filled symbols mistaken for grid lines (3× over-segmentation), fixed by requiring near-full-span lines; (2) phash ignored color → color-coded patterns collapsed to one symbol, fixed by making clustering shape+color aware.
