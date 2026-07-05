"""Export a finished job's GridData as PNG (re-rendered grid), CSV (bead
count list) or PDF (progress report)."""

from __future__ import annotations

import csv
import io
from typing import Dict, Optional, Tuple

from PIL import Image, ImageDraw

CELL_PX = 24
GRID_LINE = (60, 60, 60)
BACKGROUND = (255, 255, 255)
FALLBACK_COLOR = "#9e9e9e"
DIM_BLEND = 0.15  # how much of the original color survives when dimmed


def _hex_to_rgb(hex_color: Optional[str]) -> Tuple[int, int, int]:
    value = (hex_color or FALLBACK_COLOR).lstrip("#")
    try:
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except (ValueError, IndexError):
        return (158, 158, 158)


def _dim(rgb: Tuple[int, int, int]) -> Tuple[int, int, int]:
    return tuple(int(round(c * DIM_BLEND + 255 * (1 - DIM_BLEND))) for c in rgb)  # type: ignore[return-value]


def _symbol_stats(grid: dict, progress: Dict[str, str]) -> Dict[str, dict]:
    """Per-symbol total/completed counts derived from the progress map."""
    stats = {
        s["id"]: {"symbol": s, "total": 0, "completed": 0}
        for s in grid["symbols"]
    }
    for cell in grid["cells"]:
        entry = stats.get(cell["symbol_id"])
        if entry is None:
            continue
        entry["total"] += 1
        if progress.get(f"{cell['row']}:{cell['col']}") == "completed":
            entry["completed"] += 1
    return stats


# ---------------------------------------------------------------------------
# PNG
# ---------------------------------------------------------------------------

def export_png(
    grid: dict,
    symbol_ids: Optional[list] = None,
    hide_completed: bool = False,
    progress: Optional[Dict[str, str]] = None,
) -> bytes:
    progress = progress or {}
    selected = set(symbol_ids) if symbol_ids else None
    colors = {s["id"]: _hex_to_rgb(s.get("dominant_color")) for s in grid["symbols"]}

    rows, cols = grid["rows"], grid["cols"]
    width, height = cols * CELL_PX + 1, rows * CELL_PX + 1
    img = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(img)

    for cell in grid["cells"]:
        r, c = cell["row"], cell["col"]
        if hide_completed and progress.get(f"{r}:{c}") == "completed":
            continue  # leave the cell empty
        rgb = colors.get(cell["symbol_id"], (158, 158, 158))
        if selected is not None and cell["symbol_id"] not in selected:
            rgb = _dim(rgb)  # excluded by the filter: draw very dim
        x0, y0 = c * CELL_PX, r * CELL_PX
        draw.rectangle([x0 + 1, y0 + 1, x0 + CELL_PX - 1, y0 + CELL_PX - 1],
                       fill=rgb)

    for r in range(rows + 1):
        y = r * CELL_PX
        draw.line([(0, y), (width - 1, y)], fill=GRID_LINE, width=1)
    for c in range(cols + 1):
        x = c * CELL_PX
        draw.line([(x, 0), (x, height - 1)], fill=GRID_LINE, width=1)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

def export_csv(
    grid: dict,
    symbol_ids: Optional[list] = None,
    progress: Optional[Dict[str, str]] = None,
) -> bytes:
    progress = progress or {}
    selected = set(symbol_ids) if symbol_ids else None
    stats = _symbol_stats(grid, progress)

    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(["symbol_id", "ocr_text", "dominant_color", "total",
                     "completed", "remaining"])
    for symbol in grid["symbols"]:
        if selected is not None and symbol["id"] not in selected:
            continue
        entry = stats[symbol["id"]]
        writer.writerow([
            symbol["id"],
            symbol.get("ocr_text") or "",
            symbol.get("dominant_color") or "",
            entry["total"],
            entry["completed"],
            entry["total"] - entry["completed"],
        ])
    return out.getvalue().encode("utf-8")


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

def export_pdf(
    grid: dict,
    symbol_ids: Optional[list] = None,
    progress: Optional[Dict[str, str]] = None,
) -> bytes:
    from reportlab.lib import colors as rl_colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import (Paragraph, SimpleDocTemplate, Spacer,
                                    Table, TableStyle)

    progress = progress or {}
    selected = set(symbol_ids) if symbol_ids else None
    stats = _symbol_stats(grid, progress)

    total_cells = len(grid["cells"])
    completed = sum(1 for cell in grid["cells"]
                    if progress.get(f"{cell['row']}:{cell['col']}") == "completed")
    completion = (completed / total_cells) if total_cells else 0.0

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter,
                            title="Pattern Studio progress report")
    styles = getSampleStyleSheet()
    story = [
        Paragraph("Pattern Studio — Progress Report", styles["Title"]),
        Spacer(1, 0.15 * inch),
        Paragraph(
            f"Grid: {grid['rows']} rows x {grid['cols']} cols &nbsp;|&nbsp; "
            f"Total cells: {total_cells} &nbsp;|&nbsp; "
            f"Completed: {completed} &nbsp;|&nbsp; "
            f"Remaining: {total_cells - completed} &nbsp;|&nbsp; "
            f"Complete: {completion * 100:.1f}%",
            styles["Normal"],
        ),
        Spacer(1, 0.25 * inch),
    ]

    table_data = [["Symbol", "OCR", "Color", "Total", "Completed", "Remaining"]]
    for symbol in grid["symbols"]:
        if selected is not None and symbol["id"] not in selected:
            continue
        entry = stats[symbol["id"]]
        table_data.append([
            symbol["id"],
            symbol.get("ocr_text") or "-",
            symbol.get("dominant_color") or "-",
            str(entry["total"]),
            str(entry["completed"]),
            str(entry["total"] - entry["completed"]),
        ])

    table = Table(table_data, hAlign="LEFT")
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#333333")),
        ("TEXTCOLOR", (0, 0), (-1, 0), rl_colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, rl_colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [rl_colors.white, rl_colors.HexColor("#f2f2f2")]),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
    ]
    # tint each row's "Color" cell with the symbol's dominant color
    row_idx = 1
    for symbol in grid["symbols"]:
        if selected is not None and symbol["id"] not in selected:
            continue
        hex_color = symbol.get("dominant_color")
        if hex_color:
            try:
                style.append(("BACKGROUND", (2, row_idx), (2, row_idx),
                              rl_colors.HexColor(hex_color)))
            except ValueError:
                pass
        row_idx += 1
    table.setStyle(TableStyle(style))
    story.append(table)

    doc.build(story)
    return buf.getvalue()
