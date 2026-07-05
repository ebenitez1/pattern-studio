"""Pydantic models mirroring shared-core/src/types.ts (snake_case wire format)."""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

JobState = Literal["queued", "processing", "done", "error"]
CellStatus = Literal["not_started", "completed", "skipped", "needs_review"]
ExportFormat = Literal["png", "csv", "pdf"]


class UploadResponse(BaseModel):
    job_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    state: JobState
    progress: float = Field(ge=0.0, le=1.0)
    stage: str
    error: Optional[str] = None


class GridCell(BaseModel):
    row: int
    col: int
    symbol_id: str
    confidence: float


class PatternSymbol(BaseModel):
    id: str
    thumbnail: str
    ocr_text: Optional[str] = None
    dominant_color: Optional[str] = None
    color_name: Optional[str] = None
    color_code: Optional[str] = None
    count: int


class GridData(BaseModel):
    rows: int
    cols: int
    cells: List[GridCell]
    symbols: List[PatternSymbol]


class ExportRequest(BaseModel):
    format: ExportFormat
    symbol_ids: Optional[List[str]] = None
    hide_completed: bool = False
    progress: Optional[Dict[str, CellStatus]] = None
