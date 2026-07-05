# Pattern Studio — Backend

FastAPI service that turns an uploaded Perler-bead / cross-stitch pattern
(image or PDF) into a structured grid: cell boundaries, clustered symbols,
dominant colors, optional OCR — plus PNG / CSV / PDF exports.

The JSON wire format matches `shared-core/src/types.ts` exactly (snake_case).

## Setup (Windows)

```powershell
cd pattern-studio\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt        # runtime only
# or, to also run the tests:
pip install -r requirements-dev.txt    # adds pytest + httpx
```

### Optional native dependencies

Both are optional — the server runs without them, with reduced features.

| Tool | Needed for | Where to get it |
| --- | --- | --- |
| **Tesseract OCR** | `ocr_text` on letter/number symbols (otherwise null) | UB Mannheim build: <https://github.com/UB-Mannheim/tesseract/wiki> |
| **Poppler** | PDF uploads (`pdf2image`) | Windows release: <https://github.com/oschwartz10612/poppler-windows/releases> |

Point the backend at them with environment variables (no PATH edits needed):

```powershell
$env:TESSERACT_CMD = "C:\Program Files\Tesseract-OCR\tesseract.exe"
$env:POPPLER_PATH  = "C:\tools\poppler-24.08.0\Library\bin"
```

If Tesseract is missing, OCR is skipped silently (`ocr_text: null`). If
Poppler is missing, PDF uploads fail with a job error; images still work.

Other env vars:

- `PATTERN_STUDIO_DATA` — override the data directory (default: `backend\data`).

## Run

```powershell
uvicorn app.main:app --reload --port 8000
```

Job artifacts (original upload + `result.json`) are persisted under
`data\jobs\{job_id}\`, so finished results survive a server restart.

## API

All endpoints allow CORS from any origin.

### GET /health

```bash
curl http://localhost:8000/health
# {"ok": true}
```

### POST /upload

Multipart field `file`; accepts png / jpg / jpeg / webp / pdf. Returns
immediately; processing runs on a background worker (max 2 concurrent).

```bash
curl -F "file=@pattern.png" http://localhost:8000/upload
# {"job_id": "a1b2c3d4e5f6"}
```

### GET /job/{id}

```bash
curl http://localhost:8000/job/a1b2c3d4e5f6
# {"job_id":"a1b2c3d4e5f6","state":"processing","progress":0.6,"stage":"symbol-clustering","error":null}
```

States: `queued | processing | done | error`. Unknown id → 404.

### GET /job/{id}/result

Returns `GridData` (rows, cols, row-major cells, symbol table). 409 until the
job is `done`.

```bash
curl http://localhost:8000/job/a1b2c3d4e5f6/result
```

### POST /job/{id}/export

Body: `{"format": "png"|"csv"|"pdf", "symbol_ids"?: [...], "hide_completed"?: bool, "progress"?: {"row:col": status}}`.
Returns the file with the right content-type and content-disposition.

```bash
# re-rendered grid PNG, highlighting only s1/s2 (others drawn dim)
curl -o pattern-export.png http://localhost:8000/job/a1b2c3d4e5f6/export \
  -H "Content-Type: application/json" \
  -d '{"format":"png","symbol_ids":["s1","s2"],"hide_completed":true,"progress":{"0:0":"completed"}}'

# bead-count CSV (completed/remaining derived from the progress map)
curl -o bead-counts.csv http://localhost:8000/job/a1b2c3d4e5f6/export \
  -H "Content-Type: application/json" -d '{"format":"csv"}'

# PDF progress report
curl -o report.pdf http://localhost:8000/job/a1b2c3d4e5f6/export \
  -H "Content-Type: application/json" \
  -d '{"format":"pdf","progress":{"0:0":"completed","0:1":"completed"}}'
```

## Pipeline

Modular stages under `app/pipeline/` — each is replaceable in isolation:

1. `pdfio.py` — PDF → bitmap at 300 DPI (poppler via pdf2image, `POPPLER_PATH` aware).
2. `preprocess.py` — denoise, CLAHE, unsharp mask, Hough-based deskew (0.5°–15°), brightness normalization.
3. `grid.py` — morphological line extraction + projection clustering; falls back to autocorrelation pitch estimation when fewer than 3 lines are found on an axis.
4. `symbols.py` — phash clustering (hamming ≤ 10 by default), representative crops, dominant colors, thumbnails.
5. `ocr.py` — pytesseract (`--psm 10`, alnum whitelist) on glyph-like symbols only; degrades to null without tesseract.
6. `run.py` — orchestrator with live progress callbacks.

## Tests

```powershell
.\.venv\Scripts\Activate.ps1
python -m pytest tests/ -x -q
```

The smoke test synthesizes a 12×10 pattern image, runs it through the full
HTTP flow (upload → poll → result → export) and passes with or without
Tesseract installed.
