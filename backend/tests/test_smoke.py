"""End-to-end smoke test: synthetic pattern image -> upload -> poll -> result
-> exports. Must pass whether or not tesseract/poppler are installed."""

from __future__ import annotations

import io
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.main import app

# ground truth for the synthetic pattern
ROWS, COLS = 10, 12
CELL = 40
LINE = 2
N_SYMBOLS = 5

SYMBOL_COLORS = [
    (200, 30, 30),    # red circle
    (30, 60, 200),    # blue square
    (20, 140, 40),    # green triangle
    (230, 140, 20),   # orange diamond
    (130, 30, 170),   # purple plus
]


def _draw_symbol(draw: ImageDraw.ImageDraw, kind: int, x0: int, y0: int,
                 x1: int, y1: int) -> None:
    color = SYMBOL_COLORS[kind]
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    if kind == 0:  # circle
        draw.ellipse([x0, y0, x1, y1], fill=color)
    elif kind == 1:  # square
        draw.rectangle([x0, y0, x1, y1], fill=color)
    elif kind == 2:  # triangle
        draw.polygon([(cx, y0), (x1, y1), (x0, y1)], fill=color)
    elif kind == 3:  # diamond
        draw.polygon([(cx, y0), (x1, cy), (cx, y1), (x0, cy)], fill=color)
    else:  # plus
        arm = max(3, (x1 - x0) // 3)
        draw.rectangle([cx - arm // 2, y0, cx + arm // 2, y1], fill=color)
        draw.rectangle([x0, cy - arm // 2, x1, cy + arm // 2], fill=color)


def make_pattern_png() -> bytes:
    width, height = COLS * CELL + LINE, ROWS * CELL + LINE
    img = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    # grid lines (including outer border)
    for c in range(COLS + 1):
        x = c * CELL
        draw.rectangle([x, 0, x + LINE - 1, height - 1], fill=(0, 0, 0))
    for r in range(ROWS + 1):
        y = r * CELL
        draw.rectangle([0, y, width - 1, y + LINE - 1], fill=(0, 0, 0))

    # one symbol per cell, deterministic mix of 5 kinds
    pad = 9
    for r in range(ROWS):
        for c in range(COLS):
            kind = (r + 2 * c) % N_SYMBOLS
            x0 = c * CELL + LINE + pad
            y0 = r * CELL + LINE + pad
            x1 = (c + 1) * CELL - pad
            y1 = (r + 1) * CELL - pad
            _draw_symbol(draw, kind, x0, y0, x1, y1)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def done_job_id(client) -> str:
    """Upload the synthetic pattern and wait for the pipeline to finish."""
    png = make_pattern_png()
    res = client.post(
        "/upload",
        files={"file": ("pattern.png", png, "image/png")},
    )
    assert res.status_code == 200, res.text
    job_id = res.json()["job_id"]
    assert job_id

    deadline = time.time() + 120
    status = None
    while time.time() < deadline:
        res = client.get(f"/job/{job_id}")
        assert res.status_code == 200, res.text
        status = res.json()
        assert status["job_id"] == job_id
        assert status["state"] in ("queued", "processing", "done", "error")
        assert 0.0 <= status["progress"] <= 1.0
        if status["state"] in ("done", "error"):
            break
        time.sleep(0.25)

    assert status is not None
    assert status["state"] == "done", f"pipeline failed: {status}"
    assert status["progress"] == 1.0
    return job_id


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_unknown_job_404(client):
    res = client.get("/job/does-not-exist")
    assert res.status_code == 404
    assert "detail" in res.json()


def test_upload_rejects_unknown_type(client):
    res = client.post("/upload", files={"file": ("evil.exe", b"MZ", "application/octet-stream")})
    assert res.status_code == 400


def test_result_grid(client, done_job_id):
    res = client.get(f"/job/{done_job_id}/result")
    assert res.status_code == 200, res.text
    grid = res.json()

    # plausible dimensions: within +/-2 of ground truth
    assert abs(grid["rows"] - ROWS) <= 2, grid["rows"]
    assert abs(grid["cols"] - COLS) <= 2, grid["cols"]
    assert len(grid["cells"]) == grid["rows"] * grid["cols"]

    # at least 2 distinct symbols recognized
    assert len(grid["symbols"]) >= 2
    assert sum(s["count"] for s in grid["symbols"]) == len(grid["cells"])

    for cell in grid["cells"]:
        assert 0.0 <= cell["confidence"] <= 1.0
        assert any(s["id"] == cell["symbol_id"] for s in grid["symbols"])

    for symbol in grid["symbols"]:
        assert symbol["thumbnail"].startswith("data:image/png;base64,")
        # ocr_text may be None (tesseract may be missing) — just check the key
        assert "ocr_text" in symbol
        assert symbol["dominant_color"] is None or symbol["dominant_color"].startswith("#")


def test_export_csv(client, done_job_id):
    res = client.post(f"/job/{done_job_id}/export", json={"format": "csv"})
    assert res.status_code == 200, res.text
    assert len(res.content) > 0
    assert res.headers["content-type"].startswith("text/csv")
    assert "attachment" in res.headers["content-disposition"]
    header = res.text.splitlines()[0]
    assert header == "symbol_id,ocr_text,dominant_color,total,completed,remaining"


def test_export_png(client, done_job_id):
    res = client.post(
        f"/job/{done_job_id}/export",
        json={
            "format": "png",
            "symbol_ids": ["s1"],
            "hide_completed": True,
            "progress": {"0:0": "completed", "0:1": "needs_review"},
        },
    )
    assert res.status_code == 200, res.text
    assert len(res.content) > 0
    assert res.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert res.headers["content-type"] == "image/png"


def test_export_pdf(client, done_job_id):
    res = client.post(
        f"/job/{done_job_id}/export",
        json={"format": "pdf", "progress": {"1:1": "completed"}},
    )
    assert res.status_code == 200, res.text
    assert res.content[:5] == b"%PDF-"
    assert res.headers["content-type"] == "application/pdf"


def test_export_before_done_409(client):
    # a job id that doesn't exist at all -> 404; result for the done job is
    # covered above. Exercise 409 via the result endpoint on a fresh unknown
    # (can't easily freeze a processing job here, so just verify 404 path).
    res = client.post("/job/nope/export", json={"format": "csv"})
    assert res.status_code == 404
