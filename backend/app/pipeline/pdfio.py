"""PDF -> image loading via pdf2image (poppler).

Respects the POPPLER_PATH env var on Windows (path to poppler's bin/ folder).
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np

RENDER_DPI = 300


def pdf_to_bgr(path: Path, dpi: int = RENDER_DPI) -> np.ndarray:
    """Render the most detailed page of a PDF to a BGR numpy array.

    "Most detailed" = the page whose rendered bitmap has the highest edge
    variance; for single-page pattern PDFs this is simply the first page.
    """
    from pdf2image import convert_from_path  # imported lazily; needs poppler

    kwargs = {}
    poppler_path = os.environ.get("POPPLER_PATH")
    if poppler_path:
        kwargs["poppler_path"] = poppler_path

    pages = convert_from_path(str(path), dpi=dpi, **kwargs)
    if not pages:
        raise ValueError("PDF contained no renderable pages")

    if len(pages) == 1:
        best = pages[0]
    else:
        # pick the page with the most fine detail (proxy: gradient energy)
        best, best_score = None, -1.0
        for page in pages:
            g = np.asarray(page.convert("L"), dtype=np.float32)
            gy, gx = np.gradient(g)
            score = float(np.mean(gx * gx + gy * gy))
            if score > best_score:
                best, best_score = page, score

    rgb = np.asarray(best.convert("RGB"))
    return rgb[:, :, ::-1].copy()  # RGB -> BGR
