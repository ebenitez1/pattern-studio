/**
 * Client-side export — replaces the backend's /export endpoint so the static
 * app can produce PNG / CSV / PDF with no server. Honors the active filter and
 * the user's progress, matching the on-screen viewer.
 */
import {
  buildBeadCountCsv,
  cellRenderStateFast,
  computeStats,
  EXPORT_MIME,
  selectedIdSet,
  statusOf,
  type CellProgress,
  type ExportFormat,
  type FilterState,
  type GridData,
} from "@pattern-studio/core";

const CELL_PX = 22; // export cell size
const MAJOR = 10; // heavier grid line every N cells

function renderPngBlob(
  grid: GridData,
  filter: FilterState,
  progress: Record<string, CellProgress>,
): Promise<Blob> {
  const w = grid.cols * CELL_PX;
  const h = grid.rows * CELL_PX;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);

  const colorById = new Map(
    grid.symbols.map((s) => [s.id, s.dominant_color ?? "#888888"]),
  );
  const selected = selectedIdSet(filter);

  for (const cell of grid.cells) {
    const state = cellRenderStateFast(cell, filter, selected, progress);
    if (state === "hidden") continue;
    const x = cell.col * CELL_PX;
    const y = cell.row * CELL_PX;
    const base = colorById.get(cell.symbol_id) ?? "#888888";

    if (state === "dimmed") {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = base;
      ctx.fillRect(x, y, CELL_PX, CELL_PX);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = base;
      ctx.fillRect(x, y, CELL_PX, CELL_PX);
      if (state === "highlighted") {
        ctx.strokeStyle = "#ffd60a";
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, CELL_PX - 3, CELL_PX - 3);
      }
    }

    // completed overlay (check)
    if (statusOf(progress, cell.row, cell.col) === "completed") {
      ctx.strokeStyle = "rgba(46,125,50,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + CELL_PX / 2);
      ctx.lineTo(x + CELL_PX / 2 - 1, y + CELL_PX - 5);
      ctx.lineTo(x + CELL_PX - 4, y + 5);
      ctx.stroke();
    }
  }

  // grid lines
  ctx.strokeStyle = "#333842";
  ctx.lineWidth = 1;
  for (let c = 0; c <= grid.cols; c++) {
    ctx.globalAlpha = c % MAJOR === 0 ? 0.9 : 0.4;
    ctx.beginPath();
    ctx.moveTo(c * CELL_PX + 0.5, 0);
    ctx.lineTo(c * CELL_PX + 0.5, h);
    ctx.stroke();
  }
  for (let r = 0; r <= grid.rows; r++) {
    ctx.globalAlpha = r % MAJOR === 0 ? 0.9 : 0.4;
    ctx.beginPath();
    ctx.moveTo(0, r * CELL_PX + 0.5);
    ctx.lineTo(w, r * CELL_PX + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG encode failed"))),
      "image/png",
    );
  });
}

async function renderPdfBlob(
  grid: GridData,
  name: string,
  progress: Record<string, CellProgress>,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const stats = computeStats(grid, progress);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const left = 48;
  let y = 56;

  doc.setFontSize(20);
  doc.text("Pattern Studio — Progress Report", left, y);
  y += 26;
  doc.setFontSize(12);
  doc.text(name, left, y);
  y += 24;

  const pct = Math.round(stats.completion * 100);
  const lines = [
    `Grid: ${stats.rows} rows x ${stats.cols} cols  (${stats.total_cells} cells)`,
    `Unique symbols: ${stats.unique_symbols}`,
    `Completed: ${stats.completed} / ${stats.total_cells}  (${pct}%)`,
    `Remaining: ${stats.remaining}`,
    `Skipped: ${stats.skipped}   Needs review: ${stats.needs_review}`,
  ];
  for (const line of lines) {
    doc.text(line, left, y);
    y += 18;
  }
  y += 10;

  doc.setFontSize(13);
  doc.text("Per-symbol", left, y);
  y += 8;
  doc.setFontSize(10);
  const byId = new Map(grid.symbols.map((s) => [s.id, s]));
  const header = ["Symbol", "Color", "OCR", "Total", "Done", "Left"];
  const colX = [left, left + 70, left + 150, left + 210, left + 260, left + 310];
  y += 16;
  header.forEach((hLabel, i) => doc.text(hLabel, colX[i]!, y));
  y += 4;
  doc.setDrawColor(180);
  doc.line(left, y, left + 350, y);
  y += 14;

  for (const s of stats.per_symbol) {
    if (y > 720) {
      doc.addPage();
      y = 56;
    }
    const sym = byId.get(s.symbol_id);
    const row = [
      s.symbol_id,
      sym?.dominant_color ?? "",
      sym?.ocr_text ?? "",
      String(s.total),
      String(s.completed),
      String(s.remaining),
    ];
    row.forEach((cellText, i) => doc.text(cellText, colX[i]!, y));
    y += 15;
  }

  return doc.output("blob");
}

export async function exportLocal(
  format: ExportFormat,
  grid: GridData,
  name: string,
  filter: FilterState,
  progress: Record<string, CellProgress>,
): Promise<Blob> {
  if (format === "csv") {
    return new Blob([buildBeadCountCsv(grid, progress)], {
      type: EXPORT_MIME.csv,
    });
  }
  if (format === "png") {
    return renderPngBlob(grid, filter, progress);
  }
  return renderPdfBlob(grid, name, progress);
}
