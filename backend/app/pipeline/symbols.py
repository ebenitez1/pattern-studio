"""Stage 4 — symbol recognition via perceptual-hash clustering.

Each cell crop is normalized (grayscale, 32x32, contrast stretched) and
phashed; cells whose hashes are within a hamming-distance threshold are
grouped into one symbol. Symbols are ordered by count desc -> "s1", "s2", ...
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass, field
from typing import List, Optional

import cv2
import imagehash
import numpy as np
from PIL import Image

from .grid import Cell

HASH_BITS = 64  # phash with hash_size=8
DEFAULT_HAMMING_THRESHOLD = 10
THUMBNAIL_PX = 48


@dataclass
class SymbolGroup:
    symbol_id: str
    member_indices: List[int]  # indices into the cells list
    representative: np.ndarray  # BGR crop
    confidences: List[float]  # aligned with member_indices
    dominant_color: Optional[str] = None
    thumbnail: str = ""
    ocr_text: Optional[str] = None

    @property
    def count(self) -> int:
        return len(self.member_indices)


def _normalize_crop(crop_bgr: np.ndarray) -> Image.Image:
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA)
    gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)  # contrast stretch
    return Image.fromarray(gray)


def _mean_hash(hashes: List[imagehash.ImageHash]) -> imagehash.ImageHash:
    stack = np.stack([h.hash for h in hashes]).astype(np.float64)
    return imagehash.ImageHash(stack.mean(axis=0) >= 0.5)


def _dominant_color_hex(crop_bgr: np.ndarray) -> Optional[str]:
    """Mean RGB of the center 60% of the crop, as #rrggbb."""
    h, w = crop_bgr.shape[:2]
    if h == 0 or w == 0:
        return None
    y0, y1 = int(h * 0.2), max(int(h * 0.8), int(h * 0.2) + 1)
    x0, x1 = int(w * 0.2), max(int(w * 0.8), int(w * 0.2) + 1)
    center = crop_bgr[y0:y1, x0:x1]
    b, g, r = [float(center[:, :, i].mean()) for i in range(3)]
    return "#{:02x}{:02x}{:02x}".format(int(round(r)), int(round(g)), int(round(b)))


def _thumbnail_data_url(crop_bgr: np.ndarray, size: int = THUMBNAIL_PX) -> str:
    rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
    img = Image.fromarray(rgb).resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def cluster_symbols(
    cells: List[Cell],
    hamming_threshold: int = DEFAULT_HAMMING_THRESHOLD,
) -> List[SymbolGroup]:
    """Group cells into symbols. Returns groups ordered by count desc with
    ids "s1", "s2", ... and per-member confidences (1 - distance/64)."""
    if not cells:
        return []

    hashes = [imagehash.phash(_normalize_crop(c.crop)) for c in cells]

    # representative-list clustering: assign to the nearest existing group
    # within threshold, else start a new group
    reps: List[imagehash.ImageHash] = []
    groups: List[List[int]] = []
    for i, h in enumerate(hashes):
        best_g, best_d = -1, hamming_threshold + 1
        for gi, rep in enumerate(reps):
            d = h - rep
            if d < best_d:
                best_g, best_d = gi, d
        if best_g >= 0:
            groups[best_g].append(i)
        else:
            reps.append(h)
            groups.append([i])

    groups.sort(key=len, reverse=True)

    out: List[SymbolGroup] = []
    for rank, members in enumerate(groups, start=1):
        mean_h = _mean_hash([hashes[i] for i in members])
        # representative crop = member closest to the group's mean hash
        rep_idx = min(members, key=lambda i: hashes[i] - mean_h)
        confidences = [
            max(0.0, 1.0 - (hashes[i] - mean_h) / float(HASH_BITS))
            for i in members
        ]
        rep_crop = cells[rep_idx].crop
        out.append(SymbolGroup(
            symbol_id=f"s{rank}",
            member_indices=members,
            representative=rep_crop,
            confidences=confidences,
            dominant_color=_dominant_color_hex(rep_crop),
            thumbnail=_thumbnail_data_url(rep_crop),
        ))
    return out
