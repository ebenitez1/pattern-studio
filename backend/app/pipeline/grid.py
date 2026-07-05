"""Stage 3 — grid detection.

Primary path: extract horizontal/vertical line masks morphologically and
project them to find row/col boundary positions. Fallback path (when fewer
than 3 lines are found on an axis): estimate the cell pitch from the
autocorrelation of the intensity profile and synthesize uniform boundaries.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

import cv2
import numpy as np

MIN_CELL_PX = 5  # boundaries closer than this are merged / gaps skipped
MIN_PITCH_PX = 6  # smallest plausible cell pitch for the fallback


@dataclass
class Cell:
    row: int
    col: int
    bbox: tuple  # (x0, y0, x1, y1) in image coords
    crop: np.ndarray  # BGR crop, grid lines inset away


@dataclass
class GridSpec:
    row_bounds: List[int]  # y positions of horizontal grid lines
    col_bounds: List[int]  # x positions of vertical grid lines
    cells: List[Cell]  # row-major, rows*cols entries

    @property
    def rows(self) -> int:
        return len(self.row_bounds) - 1

    @property
    def cols(self) -> int:
        return len(self.col_bounds) - 1


def _cluster_peaks(profile: np.ndarray, min_gap: int = 4) -> List[int]:
    """Positions where profile is 'high', merged into cluster centers."""
    peak = float(profile.max())
    if peak <= 0:
        return []
    above = np.where(profile >= 0.4 * peak)[0]
    if above.size == 0:
        return []
    centers: List[int] = []
    run = [int(above[0])]
    for p in above[1:]:
        if p - run[-1] <= min_gap:
            run.append(int(p))
        else:
            centers.append(int(round(float(np.mean(run)))))
            run = [int(p)]
    centers.append(int(round(float(np.mean(run)))))
    return centers


def _merge_close(positions: List[int], min_gap: int) -> List[int]:
    if not positions:
        return []
    merged = [positions[0]]
    for p in positions[1:]:
        if p - merged[-1] < min_gap:
            merged[-1] = (merged[-1] + p) // 2
        else:
            merged.append(p)
    return merged


def _line_boundaries(line_mask: np.ndarray, axis: int) -> List[int]:
    """Project a line mask onto an axis and return boundary positions.

    axis=1 -> horizontal lines (returns y positions);
    axis=0 -> vertical lines (returns x positions).
    """
    profile = line_mask.astype(np.float64).sum(axis=axis)
    return _merge_close(_cluster_peaks(profile), MIN_CELL_PX)


def _periodic_boundaries(gray: np.ndarray, vertical: bool) -> List[int]:
    """Fallback: estimate cell pitch by autocorrelating the darkness profile
    and synthesize evenly spaced boundaries."""
    inv = 255.0 - gray.astype(np.float64)
    profile = inv.mean(axis=1 if not vertical else 0)
    size = profile.size
    profile = profile - profile.mean()
    if not np.any(profile):
        return [0, size - 1]

    ac = np.correlate(profile, profile, mode="full")[size - 1:]
    if ac[0] <= 0:
        return [0, size - 1]
    ac = ac / ac[0]

    # first local maximum past the minimum plausible pitch
    pitch = 0
    limit = size // 2
    for lag in range(MIN_PITCH_PX, limit - 1):
        if ac[lag] > 0.2 and ac[lag] >= ac[lag - 1] and ac[lag] >= ac[lag + 1]:
            pitch = lag
            break
    if pitch < MIN_PITCH_PX:
        return [0, size - 1]

    # phase: shift the comb to best line up with dark rows/cols
    inv_profile = inv.mean(axis=1 if not vertical else 0)
    best_phase, best_score = 0, -1.0
    for phase in range(pitch):
        idx = np.arange(phase, size, pitch)
        score = float(inv_profile[idx].mean())
        if score > best_score:
            best_phase, best_score = phase, score

    bounds = list(range(best_phase, size, pitch))
    if bounds[0] > pitch // 2:
        bounds.insert(0, 0)
    if size - 1 - bounds[-1] > pitch // 2:
        bounds.append(size - 1)
    return bounds


def _ensure_edges(bounds: List[int], size: int) -> List[int]:
    """If the outermost grid line wasn't drawn/found, add the image edge."""
    if len(bounds) >= 2:
        gaps = np.diff(bounds)
        pitch = float(np.median(gaps))
        if bounds[0] > 0.6 * pitch:
            bounds = [0] + bounds
        if (size - 1) - bounds[-1] > 0.6 * pitch:
            bounds = bounds + [size - 1]
    return bounds


def detect_grid(color: np.ndarray, gray: np.ndarray) -> GridSpec:
    h, w = gray.shape[:2]

    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV,
        blockSize=31, C=10,
    )

    # long thin kernels keep only full grid lines, dropping cell contents
    horiz_len = max(15, w // 12)
    vert_len = max(15, h // 12)
    horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (horiz_len, 1))
    vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, vert_len))
    horiz_mask = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horiz_kernel)
    vert_mask = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vert_kernel)

    row_bounds = _line_boundaries(horiz_mask, axis=1)  # y positions
    col_bounds = _line_boundaries(vert_mask, axis=0)  # x positions

    if len(row_bounds) < 3:
        row_bounds = _periodic_boundaries(gray, vertical=False)
    if len(col_bounds) < 3:
        col_bounds = _periodic_boundaries(gray, vertical=True)

    row_bounds = _ensure_edges(sorted(set(row_bounds)), h)
    col_bounds = _ensure_edges(sorted(set(col_bounds)), w)

    # keep only intervals big enough to be cells
    row_bounds = _filter_small_gaps(row_bounds)
    col_bounds = _filter_small_gaps(col_bounds)

    if len(row_bounds) < 2 or len(col_bounds) < 2:
        raise ValueError("Could not detect a grid in the image")

    cells: List[Cell] = []
    for r in range(len(row_bounds) - 1):
        y0, y1 = row_bounds[r], row_bounds[r + 1]
        inset_y = max(2, int(round((y1 - y0) * 0.12)))
        for c in range(len(col_bounds) - 1):
            x0, x1 = col_bounds[c], col_bounds[c + 1]
            inset_x = max(2, int(round((x1 - x0) * 0.12)))
            cy0, cy1 = y0 + inset_y, y1 - inset_y
            cx0, cx1 = x0 + inset_x, x1 - inset_x
            if cy1 - cy0 < 2 or cx1 - cx0 < 2:  # degenerate; use raw bbox
                cy0, cy1, cx0, cx1 = y0, y1, x0, x1
            crop = color[cy0:cy1, cx0:cx1].copy()
            cells.append(Cell(row=r, col=c, bbox=(x0, y0, x1, y1), crop=crop))

    return GridSpec(row_bounds=row_bounds, col_bounds=col_bounds, cells=cells)


def _filter_small_gaps(bounds: List[int]) -> List[int]:
    if len(bounds) < 2:
        return bounds
    out = [bounds[0]]
    for b in bounds[1:]:
        if b - out[-1] >= MIN_CELL_PX:
            out.append(b)
    return out
