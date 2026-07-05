import {
  CELL_STATUS_CYCLE,
  cellKey,
  type CellProgress,
  type CellStatus,
  type GridData,
  type ProjectStats,
  type SymbolStats,
} from "../types";

/** Next status when the user taps a cell. */
export function nextCellStatus(current: CellStatus): CellStatus {
  const i = CELL_STATUS_CYCLE.indexOf(current);
  return CELL_STATUS_CYCLE[(i + 1) % CELL_STATUS_CYCLE.length] ?? "not_started";
}

export function getCellStatus(
  progress: Record<string, CellProgress>,
  row: number,
  col: number,
): CellStatus {
  return progress[cellKey(row, col)]?.status ?? "not_started";
}

/**
 * Pure status-cycle transition. Returns a new sparse progress map; cells that
 * cycle back to not_started are removed to keep the map small.
 */
export function cycleCell(
  progress: Record<string, CellProgress>,
  row: number,
  col: number,
  now: number,
): Record<string, CellProgress> {
  const key = cellKey(row, col);
  const next = nextCellStatus(progress[key]?.status ?? "not_started");
  const copy = { ...progress };
  if (next === "not_started") {
    delete copy[key];
  } else {
    copy[key] = { status: next, updated_at: now };
  }
  return copy;
}

/** Set an explicit status (used by bulk actions / future smart modes). */
export function setCellStatus(
  progress: Record<string, CellProgress>,
  row: number,
  col: number,
  status: CellStatus,
  now: number,
): Record<string, CellProgress> {
  const key = cellKey(row, col);
  const copy = { ...progress };
  if (status === "not_started") {
    delete copy[key];
  } else {
    copy[key] = { status, updated_at: now };
  }
  return copy;
}

/** Full statistics for the stats panel. O(cells). */
export function computeStats(
  grid: GridData,
  progress: Record<string, CellProgress>,
): ProjectStats {
  const perSymbol = new Map<string, SymbolStats>();
  for (const s of grid.symbols) {
    perSymbol.set(s.id, {
      symbol_id: s.id,
      total: 0,
      completed: 0,
      skipped: 0,
      needs_review: 0,
      remaining: 0,
    });
  }

  let completed = 0;
  let skipped = 0;
  let needsReview = 0;

  for (const cell of grid.cells) {
    const stats = perSymbol.get(cell.symbol_id);
    if (!stats) continue;
    stats.total++;
    const status = progress[cellKey(cell.row, cell.col)]?.status ?? "not_started";
    if (status === "completed") {
      stats.completed++;
      completed++;
    } else if (status === "skipped") {
      stats.skipped++;
      skipped++;
    } else if (status === "needs_review") {
      stats.needs_review++;
      needsReview++;
    }
  }

  for (const stats of perSymbol.values()) {
    stats.remaining = stats.total - stats.completed;
  }

  const total = grid.cells.length;
  return {
    rows: grid.rows,
    cols: grid.cols,
    total_cells: total,
    unique_symbols: grid.symbols.length,
    completed,
    skipped,
    needs_review: needsReview,
    remaining: total - completed,
    completion: total === 0 ? 0 : completed / total,
    per_symbol: [...perSymbol.values()].sort((a, b) => b.total - a.total),
  };
}
