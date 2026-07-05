import { colors, type GridData } from "@pattern-studio/core";

/**
 * Draw the grid to an offscreen canvas (~160px wide, one dominant-colour
 * square per cell) and return a small PNG data-URL for the project list.
 */
export function gridThumbnailDataUrl(grid: GridData, targetWidth = 160): string | null {
  if (grid.cols <= 0 || grid.rows <= 0) return null;

  const cellPx = Math.max(1, Math.floor(targetWidth / grid.cols));
  const width = grid.cols * cellPx;
  const height = grid.rows * cellPx;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, width, height);

  const colorBySymbol = new Map<string, string | null>();
  for (const s of grid.symbols) colorBySymbol.set(s.id, s.dominant_color);

  for (const cell of grid.cells) {
    const color = colorBySymbol.get(cell.symbol_id);
    if (!color) continue;
    ctx.fillStyle = color;
    ctx.fillRect(cell.col * cellPx, cell.row * cellPx, cellPx, cellPx);
  }

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
