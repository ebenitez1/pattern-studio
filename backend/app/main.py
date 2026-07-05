"""Pattern Studio FastAPI application.

Run with:  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import exporters
from .jobs import ensure_data_dirs, registry
from .models import ExportRequest, GridData, JobStatusResponse, UploadResponse

ALLOWED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".pdf"}

EXPORT_MEDIA = {
    "png": ("image/png", "pattern.png"),
    "csv": ("text/csv; charset=utf-8", "bead-counts.csv"),
    "pdf": ("application/pdf", "progress-report.pdf"),
}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_data_dirs()
    yield


app = FastAPI(title="Pattern Studio API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/upload", response_model=UploadResponse)
async def upload(file: UploadFile = File(...)) -> UploadResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix or 'unknown'}'. "
                   f"Allowed: png, jpg, jpeg, webp, pdf.",
        )
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    ensure_data_dirs()
    job = registry.create(file.filename or f"upload{suffix}", data)
    registry.submit(job.job_id)
    return UploadResponse(job_id=job.job_id)


@app.get("/job/{job_id}", response_model=JobStatusResponse)
def job_status(job_id: str) -> JobStatusResponse:
    job = registry.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job '{job_id}'")
    return JobStatusResponse(**job.status_dict())


@app.get("/job/{job_id}/result", response_model=GridData)
def job_result(job_id: str) -> GridData:
    job = registry.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job '{job_id}'")
    if job.state != "done" or job.result is None:
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' is not done (state: {job.state})",
        )
    return GridData(**job.result)


@app.post("/job/{job_id}/export")
def job_export(job_id: str, req: ExportRequest) -> Response:
    job = registry.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job '{job_id}'")
    if job.state != "done" or job.result is None:
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' is not done (state: {job.state})",
        )

    grid = job.result
    progress = dict(req.progress or {})
    if req.format == "png":
        body = exporters.export_png(
            grid,
            symbol_ids=req.symbol_ids,
            hide_completed=req.hide_completed,
            progress=progress,
        )
    elif req.format == "csv":
        body = exporters.export_csv(grid, symbol_ids=req.symbol_ids,
                                    progress=progress)
    else:  # pdf
        body = exporters.export_pdf(grid, symbol_ids=req.symbol_ids,
                                    progress=progress)

    media_type, filename = EXPORT_MEDIA[req.format]
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
