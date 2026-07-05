"""Stage 6 — orchestrator: wires all pipeline stages together and reports
progress via a callback so /job/{id} can show live status."""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Dict, Optional

import numpy as np
from PIL import Image

from . import grid as grid_mod
from . import ocr as ocr_mod
from . import pdfio
from . import preprocess as pre_mod
from . import symbols as sym_mod

ProgressCallback = Callable[[str, float], None]

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def _load_bgr(path: Path) -> np.ndarray:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return pdfio.pdf_to_bgr(path)
    with Image.open(path) as img:
        rgb = np.asarray(img.convert("RGB"))
    return rgb[:, :, ::-1].copy()  # RGB -> BGR


def run_pipeline(
    input_path: Path,
    progress: Optional[ProgressCallback] = None,
    hamming_threshold: int = sym_mod.DEFAULT_HAMMING_THRESHOLD,
) -> Dict:
    """Process an uploaded image/PDF into a GridData dict (wire format)."""

    def report(stage: str, frac: float) -> None:
        if progress is not None:
            progress(stage, frac)

    report("loading", 0.02)
    bgr = _load_bgr(input_path)

    report("preprocessing", 0.10)
    color, gray = pre_mod.preprocess(bgr)

    report("grid-detection", 0.35)
    spec = grid_mod.detect_grid(color, gray)

    report("symbol-clustering", 0.60)
    groups = sym_mod.cluster_symbols(spec.cells, hamming_threshold=hamming_threshold)

    report("ocr", 0.85)
    ocr_mod.recognize_symbols(groups)

    report("finalizing", 0.95)
    # map every cell (row-major) to its symbol + confidence
    cell_symbol = {}
    for group in groups:
        for idx, conf in zip(group.member_indices, group.confidences):
            cell_symbol[idx] = (group.symbol_id, conf)

    cells_out = []
    for i, cell in enumerate(spec.cells):
        symbol_id, confidence = cell_symbol.get(i, ("s1", 0.0))
        cells_out.append({
            "row": cell.row,
            "col": cell.col,
            "symbol_id": symbol_id,
            "confidence": round(float(confidence), 4),
        })

    symbols_out = [
        {
            "id": g.symbol_id,
            "thumbnail": g.thumbnail,
            "ocr_text": g.ocr_text,
            "dominant_color": g.dominant_color,
            "color_name": None,
            "color_code": None,
            "count": g.count,
        }
        for g in groups
    ]

    result = {
        "rows": spec.rows,
        "cols": spec.cols,
        "cells": cells_out,
        "symbols": symbols_out,
    }
    report("done", 1.0)
    return result
