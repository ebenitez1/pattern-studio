"""Stage 2 — image cleanup: denoise, contrast, sharpen, deskew, normalize.

Input:  BGR image (numpy).
Output: (color, gray) — the deskewed color image and an enhanced grayscale
        copy used by the downstream analysis stages.
"""

from __future__ import annotations

import math
from typing import Tuple

import cv2
import numpy as np

# Only correct skew in this range: below it isn't worth resampling,
# above it is probably not skew (rotated/landscape scan).
DESKEW_MIN_DEG = 0.5
DESKEW_MAX_DEG = 15.0


def _estimate_skew_deg(gray: np.ndarray) -> float:
    """Estimate the dominant skew angle (degrees) via Hough line voting.

    Returns the deviation of grid lines from the nearest axis, so 0.0 means
    the image is already square to the axes.
    """
    edges = cv2.Canny(gray, 50, 150)
    h, w = gray.shape[:2]
    threshold = max(80, min(h, w) // 4)
    lines = cv2.HoughLines(edges, 1, np.pi / 360.0, threshold)
    if lines is None or len(lines) == 0:
        return 0.0

    deviations = []
    for line in lines[:200]:
        theta = float(line[0][1])  # radians, 0..pi (0 = vertical line)
        deg = math.degrees(theta)
        # deviation from the nearest multiple of 90 deg, in (-45, 45]
        dev = ((deg + 45.0) % 90.0) - 45.0
        if abs(dev) <= DESKEW_MAX_DEG + 2.0:
            deviations.append(dev)
    if not deviations:
        return 0.0
    return float(np.median(deviations))


def _rotate(img: np.ndarray, angle_deg: float, border: int) -> np.ndarray:
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle_deg, 1.0)
    if img.ndim == 3:
        border_value: Tuple[int, ...] = (border, border, border)
    else:
        border_value = border  # type: ignore[assignment]
    return cv2.warpAffine(
        img, m, (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=border_value,
    )


def preprocess(bgr: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Return (color, gray): deskewed color image + enhanced grayscale copy."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # denoise (keep h modest so thin grid lines survive)
    gray = cv2.fastNlMeansDenoising(gray, None, h=7, templateWindowSize=7,
                                    searchWindowSize=21)

    # local contrast boost
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # unsharp mask
    blurred = cv2.GaussianBlur(gray, (0, 0), sigmaX=2.0)
    gray = cv2.addWeighted(gray, 1.5, blurred, -0.5, 0)

    # deskew (applied to both the analysis grayscale and the color source)
    color = bgr
    angle = _estimate_skew_deg(gray)
    if DESKEW_MIN_DEG <= abs(angle) <= DESKEW_MAX_DEG:
        gray = _rotate(gray, angle, border=255)
        color = _rotate(color, angle, border=255)

    # brightness normalization (full-range stretch)
    gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)

    return color, gray
