import {
  cellKey,
  type CellProgress,
  type FilterState,
  type GridCell,
} from "../types";

/**
 * How a cell should be drawn under the active filter.
 * Renderers (Canvas on web, Skia on mobile) map these to actual styles:
 *   normal      → regular rendering
 *   dimmed      → transparent / gray (depending on mode)
 *   highlighted → bright highlight colour (colorblind-friendly yellow by default)
 *   hidden      → do not draw at all
 */
export type CellRenderState = "normal" | "dimmed" | "highlighted" | "hidden";

export function toggleSymbolSelection(
  selected: string[],
  symbolId: string,
): string[] {
  return selected.includes(symbolId)
    ? selected.filter((id) => id !== symbolId)
    : [...selected, symbolId];
}

/**
 * Resolve the render state for one cell. Pure and allocation-free so the
 * renderer can call it inside a 150x150+ draw loop.
 */
export function cellRenderState(
  cell: GridCell,
  filter: FilterState,
  progress: Record<string, CellProgress>,
): CellRenderState {
  if (filter.hideCompleted) {
    const status = progress[cellKey(cell.row, cell.col)]?.status;
    if (status === "completed") return "hidden";
  }

  if (filter.mode === "none" || filter.selectedSymbolIds.length === 0) {
    return "normal";
  }

  const selected = filter.selectedSymbolIds.includes(cell.symbol_id);
  if (filter.mode === "show_only") {
    return selected ? "normal" : "dimmed";
  }
  // highlight mode
  return selected ? "highlighted" : "dimmed";
}

/**
 * Precompute a Set for large grids — `includes` on every cell of a 300x300
 * grid is measurable; renderers can use this instead.
 */
export function selectedIdSet(filter: FilterState): Set<string> {
  return new Set(filter.selectedSymbolIds);
}

export function cellRenderStateFast(
  cell: GridCell,
  filter: FilterState,
  selectedIds: Set<string>,
  progress: Record<string, CellProgress>,
): CellRenderState {
  if (filter.hideCompleted) {
    const status = progress[cellKey(cell.row, cell.col)]?.status;
    if (status === "completed") return "hidden";
  }
  if (filter.mode === "none" || selectedIds.size === 0) return "normal";
  const selected = selectedIds.has(cell.symbol_id);
  if (filter.mode === "show_only") return selected ? "normal" : "dimmed";
  return selected ? "highlighted" : "dimmed";
}
