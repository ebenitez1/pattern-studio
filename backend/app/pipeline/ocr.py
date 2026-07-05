"""Stage 5 — optional OCR of glyph-like symbols with pytesseract.

Only symbols that look like a letter/number glyph (high contrast, mostly
two-tone) are OCRed. If tesseract is not installed the whole stage degrades
gracefully: every ocr_text stays None and the pipeline continues.

Respects the TESSERACT_CMD env var (full path to tesseract.exe on Windows).
"""

from __future__ import annotations

import os
from typing import List

import cv2
import numpy as np
from PIL import Image

from .symbols import SymbolGroup

TESS_CONFIG = (
    "--psm 10 -c tessedit_char_whitelist="
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
)


def _looks_like_glyph(crop_bgr: np.ndarray) -> bool:
    """High contrast and mostly two-tone -> plausibly a printed glyph."""
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    if float(gray.std()) < 30.0:
        return False  # flat / solid-color cell
    # two-tone test: after Otsu, most pixels should sit near one of the two
    # class means
    thresh, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    lo = gray[binary == 0]
    hi = gray[binary == 255]
    if lo.size == 0 or hi.size == 0:
        return False
    near_lo = np.abs(lo.astype(np.int32) - int(lo.mean())) < 40
    near_hi = np.abs(hi.astype(np.int32) - int(hi.mean())) < 40
    frac_two_tone = (near_lo.sum() + near_hi.sum()) / float(gray.size)
    return frac_two_tone > 0.8


def _prepare_for_ocr(crop_bgr: np.ndarray) -> Image.Image:
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    scale = max(1, int(round(96.0 / max(gray.shape))))
    if scale > 1:
        gray = cv2.resize(gray, None, fx=scale, fy=scale,
                          interpolation=cv2.INTER_CUBIC)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if float(binary.mean()) < 127:  # ensure dark glyph on white background
        binary = 255 - binary
    binary = cv2.copyMakeBorder(binary, 8, 8, 8, 8, cv2.BORDER_CONSTANT, value=255)
    return Image.fromarray(binary)


def recognize_symbols(symbols: List[SymbolGroup]) -> None:
    """Populate group.ocr_text in place. Never raises on a missing tesseract."""
    try:
        import pytesseract
    except ImportError:
        return

    tesseract_cmd = os.environ.get("TESSERACT_CMD")
    if tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    available = True
    for group in symbols:
        if not available:
            break
        if not _looks_like_glyph(group.representative):
            continue
        try:
            text = pytesseract.image_to_string(
                _prepare_for_ocr(group.representative), config=TESS_CONFIG
            )
        except pytesseract.TesseractNotFoundError:
            available = False  # leave every ocr_text as None
            break
        except Exception:
            continue  # single-symbol OCR hiccup: skip it
        text = text.strip()
        if text and text[0].isalnum():
            group.ocr_text = text[0]
