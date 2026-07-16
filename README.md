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

- 2026-07-15 — **Sideband pitch/phase traps fixed (charts with printed codes + big titles).** A 34×34 chart detected as 36×104: printed bead codes put strong edges a fixed ~13px offset from every grid line (sidebands), and the bold header/legend rows tower over the lines. Three-part fix in `grid.ts`: (1) `estimatePitch` no longer trusts the *first* prominent autocorrelation peak — every prominent peak competes as a candidate, each reduced to its fundamental via comb-verified divisors (now all divisors, not just 2–4), scored by **comb energy** (best-phase sum of tooth-strength − mean, so off-line teeth count against a candidate; plain averages let sparse harmonics cherry-pick a few strong rows, raw sums let fine sidebands pad themselves with texture). (2) Signals are **outlier-clipped at the 95th percentile** before pitch/phase analysis so no header/legend row outweighs a grid line. (3) The comb's **phase is re-anchored on the morph-opened line-coverage signal** (text is erased there, so real lines dominate) — the edge-projection comb had locked onto the sideband phase, shifting every boundary 13px and mis-classifying every cell; the shift is only applied when coverage decisively (>1.3×) prefers the new phase. Verified: the failing chart exactly **34×34, 831 beads, all 5 legend counts** (332/291/129/67/12); all six real reference charts plus the flush-edge replica re-run exact; a dense-code replica (a printed code on every one of 1156 cells, labels on all four sides, legend) also exact — now via the statistical path directly.
- 2026-07-15 — **Checkerboard half-pitch trap fixed.** A 34×34 chart with a large checkered background was detected as 70×34: the checker "no stitch" texture has sub-square edges at exactly **half** the cell pitch, giving the statistical pitch estimator full comb support at pitch/2 in one axis. New `undoHalfPitch` check in `estimatePitch`: at a true pitch, the doubled comb's opposite phase also lands on grid lines (measured 0.86–0.99 of the best phase across all reference charts); at a checker-halved pitch it lands on checker-only edges (~0.60) — if the opposite phase is < 0.72× the best, the pitch was halved, so double it. Detection also now stashes its raw projection signals on `__PS_GRID_SIGNALS__` for tuning. Verified: the failing chart is now exactly **34×34, 741 beads, all 5 colour counts matching the legend** (204/158/145/135/99); all six other charts re-run unchanged and exact.
- 2026-07-15 — **Flush-edge grids and split patterns no longer cut off.** Two extent fixes in `grid.ts`: (1) `extendComb` prepends/appends a grid boundary when the detected comb leaves ≥0.6× a cell pitch of image uncovered at either end — charts whose grid sits flush against the image edge (common in Perler exports with a side legend panel) were losing their first row/column; (2) extent trimming now merges content runs across gaps of up to 2 empty rows/columns **when both sides are substantial (≥3 lines)** — a pattern part detached from the main figure (e.g. an ear, a floating piece) was being discarded as outside the grid, while the substantial-segment requirement keeps legend chip rows from being pulled in. Verified on a flush-edge 36×38 replica with right-side legend, sparse top row, and an empty interior column (previously 33×37, now exactly 36×38 with all 6 top-row beads); all five reference charts re-run unchanged and exact (34×34/1024/11 with identical per-colour counts, 22×21/265/12, 34×34/767/6, 32×32/703, 45×47/1250).
- 2026-07-05 — Initial build: monorepo scaffolded; shared-core written and typechecked; backend, web, and mobile implemented.
- 2026-07-05 — Pushed to GitHub as private repo `ebenitez1/pattern-studio`.
- 2026-07-05 — Made repo public; added GitHub Pages deploy workflow for the web app (relative Vite base).
- 2026-07-05 — Fixed "Illegal invocation" bug: shared-core API client now binds global `fetch` to `globalThis` (calling it as `this.fetchFn(...)` rebound `this` and browsers rejected it; Node/undici didn't catch it). Also affected mobile.
- 2026-07-05 — Verified full pipeline against the live local backend (upload → poll → result → PNG/CSV/PDF export all 200).
- 2026-07-13 — **Ruled-line detection tuned on the real dense chart.** Coverage threshold lowered to 0.2×max (light-grey lines barely survive JPEG); acceptance relaxed to modal-gap ≥25% + anchor support ≥50%, safe because the cross-check is now **asymmetric**: text fools statistics toward a *smaller* pitch, so the ruled result is preferred only when its pitch is significantly *larger* (comb pitch < 0.75× ruled pitch). Pitch+anchor refined by least squares over matched lines (the modal gap alone drifted ~½ cell across 34 columns, shearing the last column). Result on the real 34×34/1024 chart: **34×34, 1024 beads, all 11 colour counts exactly matching the legend** (260,185,179,147,143,44,38,17,4,4,3); all four reference charts unchanged and exact via the statistical path.
- 2026-07-13 — **Ruled-line cross-check.** A dense 34×34 chart with a printed code on every cell fooled the statistical pitch (detected 93×125). detectGrid now also extracts physical ruled lines (adaptive threshold → short morphological open kills text clusters → rows/cols with high surviving coverage are lines → modal-gap pitch + best-supported anchor → full comb via `linesToBoundaries`). The ruled result is used **only when it disagrees with the statistical pitch by > 25%** — real lines beat statistics when text floods the signal; otherwise the proven comb path runs. Acceptance requires the modal gap to dominate (≥40% of gaps) and ≥60% anchor support, so charts without clean lines reject and fall back. Verified: all four reference charts unchanged and exact (each agreeing with its lines → comb path); the ruled path itself produces 34×34/767/6 exact when applied to the same chart style.
- 2026-07-13 — **Toolbar removed + full printed grid size + inline Settings.** (1) The top toolbar is gone; its controls moved into the sidebar: symbol search + filter controls live in the Symbols panel, Settings is its own collapsible sidebar panel (inline — fixes the misaligned popover), upload via the library's "＋ Add" button. (2) Checkerboard-background charts now keep their **full printed grid size**: `cellIsChecker` in grid.ts counts checker "no stitch" cells as grid content during extent trimming (and protects checker edge bands from the label-strip), so a 34×34 chart with empty border rows reads as 34×34 instead of the bead bounding box. Verified: c2 now 34×34 with beads still exactly 767/6; c1 22×21/265/12, cb 32×32/703, sprite 45×47/1250 all unchanged.
- 2026-07-07 — **Library polish + Current Project section.** (1) "Done?" renamed to "Mark as Complete" (library + current-project). (2) Upload now shows a size indicator — "✓ Pattern added — C × R cells" — for ~1.6s before opening the pattern, and fit-to-screen was made robust (extracted `fitIfDefault`, also invoked from the ResizeObserver so a canvas measured after project creation still auto-fits; previously a fresh upload could open unfitted). (3) New "Current Project" sidebar section above Projects: thumbnail, name, size, colour count, live bead progress bar, Mark-as-Complete and Close actions. Verified all three in-browser.
- 2026-07-07 — **Pattern library.** The Projects panel is now a full library: "＋ Add" button opens the upload dialog (custom `ps:open-upload` event); each pattern has a **Done?/✓ Done** toggle marking the whole pattern completed (`Project.completed` flag, persisted; badge + faded row); the Edit form gains a **rename** field (`renameProjectById` store action keeps an open project's title in sync); delete already existed. Verified in-browser end-to-end: add → mark done (persisted in IndexedDB) → rename → un-done → delete. Mobile typecheck unaffected (new fields optional).
- 2026-07-07 — **Per-colour hide toggle.** Each colour in the symbol list has a Hide/Hidden toggle: hidden colours render as empty canvas in the viewer and PNG export, and their tiles are **not clickable** until unhidden. Implemented as `hiddenSymbolIds` on the shared FilterState (`toggleHiddenColor` store action; `cellRenderStateFast` takes an optional hidden-id set; hidden cells and hide-completed cells now paint light canvas instead of leaving dark holes). Verified in-browser: hidden colour's cells export as #f0f0f0, clicks on them are blocked (progress unchanged), and unhiding restores clicking; mobile typecheck unaffected.
- 2026-07-07 — **Completed check mark restored.** Completed tiles keep the 20% fade and additionally draw a green ✓ (full opacity, `#66bb6a` matching the panel badge) in the viewer (cells ≥ 12px) and PNG export. Verified: exported completed cell shows the faded fill plus green check pixels; neighbours unaffected.
- 2026-07-07 — **DMC colour matching.** Implemented the colour-matching hook: shared-core gains a ~340-entry DMC floss table (`logic/dmc.ts`) with CIELAB nearest-colour matching (`nearestDmc`); the web pipeline fills `color_code`/`color_name` on every symbol, and the symbol list / stats table now show "DMC 310 · Black" instead of hex (hex remains as a tooltip; CSV export includes the columns automatically, and search already matched on them). Validation: on the 22×21 chart, all **12/12 detected colours matched exactly the DMC codes printed in the chart's own legend** (310, 355, 3826, 413, 3760, 519, 721, 209, 3864, 3047, B5200, 924); sprite colours map to sensible codes (3371, White, 972/973/307, 729). Note: matches are nearest-neighbour approximations — screen-rendered colours may map to an adjacent shade on some charts.
- 2026-07-07 — **Enclosed white is a real colour.** Empty-cell classification now distinguishes the two kinds of "light" cell by texture: checkerboard-marked cells (two-tone, lum p10–p90 spread > 7, only testable on cells ≥ 14px) are "no stitch" and stripped wherever they are; solid near-white cells are background only when connected to the grid border — solid white **enclosed by the design** (e.g. a white mane) is kept as a tracked, toggleable colour at any size (the old ≤ 5-cell cap is gone). Verified: sprite now tracks 321 enclosed white mane cells (toggleable); the checkerboard chart improved to **exactly 767/6** (its 9 enclosed checker cells now correctly stripped); the other DMC charts unchanged (265/12, 703).
- 2026-07-07 — **Background cells render as light canvas.** Empty/background cells now draw as light `#f0f0f0` squares in the viewer and PNG export (previously skipped, showing the dark workspace — which made white chart areas look black). They remain untracked and unclickable; counts unchanged. Verified: sprite export is 51% light canvas / 27% figure / 22% outline, corner background pixel exactly #f0f0f0 — matching the source chart's white-canvas look.
- 2026-07-07 — **Inset thumbnails.** Symbol thumbnails are now cropped with the same inset as colour sampling, so surrounding grid lines never contaminate them — on fine grids an un-inset 8px crop was mostly dark grid line, making white/light cells render as dark-framed tiles in the viewer. Verified: on the sprite pattern every thumbnail's mean colour now matches its dominant colour (white symbol → white thumbnail); DMC chart thumbnails keep their printed codes (high contrast retained) and detection is unchanged. Note: previously saved projects keep their old thumbnails — re-upload to regenerate.
- 2026-07-07 — **Completion visuals.** Completed tiles now render at 20% opacity (faded but visible) in the viewer and PNG export, replacing the green-tint/checkmark overlay; symbol glyphs stay visible (faded) on completed cells. When every cell of a colour is completed, its row in the symbol list fades and shows a green "✓ Complete" badge instead of the done/left breakdown. Verified in-browser: export pixel of a completed cell is exactly 0.2× its base colour; badge appears only for the fully-completed colour.
- 2026-07-05 — **Hybrid pitch detection (fine grids).** A fine, sparse pixel-art pattern was detected at half resolution (chunky) because autocorrelation locked onto the 2× harmonic. estimatePitch now uses autocorrelation for the ballpark then comb-*verifies* sub-multiples (½, ⅓): if a finer pitch's comb still lands on real grid lines it becomes the fundamental, else the coarse value is kept. Resolution is capped at ~130 cells/axis so a fine checkerboard background's sub-cell texture isn't mistaken for the cell pitch on large scans. Verified: a 444px sprite detects at 45×47 (full detail, clean yellow/black on a stripped white background); the three DMC charts unchanged (22×21/265, 32×32/703, 33×32/768).
- 2026-07-05 — **Interior background + colour fidelity.** Empty cells are now split by connectivity: a near-white/light cell is stripped as background only if it's reachable from the grid border OR part of a large enclosed region; small enclosed empty regions (design highlights like eyes) are kept as real cells (`computeBackground` flood-fill in symbols.ts). Cell colour is taken by MODE (most common colour bucket) rather than mean, so thin grid lines and slight cell-boundary overlap no longer muddy the colour on fine grids. Uploaded images are composited over white so a transparent PNG background reads as empty, not black. Verified: a Pokémon sprite pattern keeps its interior white highlights; the three DMC charts (22×21/265, 32×32/703, 34×34→33×32/767) are unchanged (±1 cell).
- 2026-07-05 — **Grid detection round 3 (colored axis labels).** Added a uniform-edge-strip pass: after the bead-extent trim, an outer row/col is dropped if it is (a) uniform in colour AND (b) that colour is sparse in the grid interior (density < ~2.5%). This removes tinted axis-number label bands (e.g. periwinkle) that are pixel-identical to beads, while keeping real solid bead edges (whose colour recurs densely inside) — even when the label tint equals a rare palette colour. Verified across three real charts: 32×32/703 beads (the periwinkle-label chart, now correct), 22×21/265 and 34×34→33×32/767 both unchanged. Known unsupported styles: no-grid patterns on a solid coloured background, and screenshots / outline-symbol (non-filled) charts.
- 2026-07-05 — **Grid detection round 2 (second real chart).** Fixed the autocorrelation pitch to return the *fundamental* period (first strong peak) instead of the global max — a harmonic was winning and giving 1/3 the columns. Replaced edge-support extent trimming with a 2D **bead-extent** trim: the grid is the largest contiguous block of rows/cols containing a "bead cell" (inset mostly coloured-or-dark, ≥50% fill), which excludes axis-number labels and the legend where light checkerboard vs. label background are pixel-identical. Background classification now covers grey/white checkerboard empties (light + desaturated + no ink), not just white. Verified against a second real 34×34 chart: 6 colours, 767 tracked beads with counts exactly matching the legend (191,179,159,129,83,26); the first chart still detects 22×21 / 12 colours / 265 exactly (no regression). Note: the grid is trimmed to the bead bounding box, so fully-empty outer border rows/cols are excluded (dims reflect the bead extent, not the chart's printed row/col count).
- 2026-07-05 — **Reworked grid detection for real numbered charts.** The old "find long dark lines" approach broke on real cross-stitch charts (rows of dark filled cells look like grid lines). Replaced with periodicity detection: directional edge projections → autocorrelation for the uniform cell pitch → phase-aligned comb → trim to the contiguous supported run (excludes outside axis-number labels, white margins, and the colour legend). Also: near-white empty cells (no printed ink) are now treated as untracked **background** (`BACKGROUND_SYMBOL_ID`) rather than a phantom "white" symbol, and clustering is **colour-dominant** (identical colours merge despite print/JPEG shape-hash noise; shape still separates glyphs on similar backgrounds). Verified against a real 22×21 DMC chart: detected 22×21, 265 tracked cells, 12 symbols with counts exactly matching the legend (73,48,37,34,23,18,17,5,4,3,2,1) — including DMC B5200 snow-white beads (distinguished from empty cells by their printed code). Simple synthetic patterns still pass (no regression).
- 2026-07-05 — Three UX changes (verified in-browser): (1) grid detection now crops to the outlined border — the bounding box of non-white content — so surrounding white margin is excluded from tracking/stats; (2) "Clear completed" button in the Stats panel resets all completed cells to Not Started (shared-core `clearStatus` + store `clearCompleted`); (3) highlight color is now a single Yellow-or-Purple choice (replaced the yellow/cyan colorblind toggle), applied consistently in the viewer and PNG export.
- 2026-07-05 — **Web app moved to fully in-browser processing (WASM)** so the Pages site needs no backend at all. Added shared-core color-aware perceptual-hash clustering; web `processing/` modules (opencv.js grid detection, pdf.js, optional tesseract.js OCR, canvas/jsPDF export). Verified in a real browser: synthetic 8×10 / 3-color pattern → detected 8×10, 3 symbols, correct colors; PNG + CSV exports correct. Two bugs found and fixed during verification: (1) morphological line kernel too short → filled symbols mistaken for grid lines (3× over-segmentation), fixed by requiring near-full-span lines; (2) phash ignored color → color-coded patterns collapsed to one symbol, fixed by making clustering shape+color aware.
