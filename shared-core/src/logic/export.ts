import {
  cellKey,
  type CellProgress,
  type CellStatus,
  type ExportFormat,
  type ExportRequest,
  type FilterState,
  type GridData,
} from "../types";
import { computeStats } from "./progress";

/**
 * Build the export request body from current filter + progress state, so the
 * backend renders exactly what the user sees.
 */
export function buildExportRequest(
  format: ExportFormat,
  filter: FilterState,
  progress: Record<string, CellProgress>,
): ExportRequest {
  const progressStatuses: Record<string, CellStatus> = {};
  for (const [key, p] of Object.entries(progress)) {
    progressStatuses[key] = p.status;
  }
  return {
    format,
    symbol_ids:
      filter.mode === "show_only" && filter.selectedSymbolIds.length > 0
        ? filter.selectedSymbolIds
        : undefined,
    hide_completed: filter.hideCompleted || undefined,
    progress: progressStatuses,
  };
}

export function exportFileName(
  projectName: string,
  format: ExportFormat,
): string {
  const safe = projectName.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_");
  return `${safe || "pattern"}_export.${format}`;
}

export const EXPORT_MIME: Record<ExportFormat, string> = {
  png: "image/png",
  csv: "text/csv",
  pdf: "application/pdf",
};

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Build the bead-count CSV (pure) — same columns the backend emits, so the
 * browser export matches server export byte-for-byte in structure:
 * symbol_id, ocr_text, dominant_color, color_name, color_code, total, completed, remaining.
 */
export function buildBeadCountCsv(
  grid: GridData,
  progress: Record<string, CellProgress>,
): string {
  const stats = computeStats(grid, progress);
  const byId = new Map(grid.symbols.map((s) => [s.id, s]));
  const header = [
    "symbol_id",
    "ocr_text",
    "dominant_color",
    "color_name",
    "color_code",
    "total",
    "completed",
    "remaining",
  ];
  const rows = [header.join(",")];
  for (const s of stats.per_symbol) {
    const sym = byId.get(s.symbol_id);
    rows.push(
      [
        s.symbol_id,
        sym?.ocr_text ?? "",
        sym?.dominant_color ?? "",
        sym?.color_name ?? "",
        sym?.color_code ?? "",
        String(s.total),
        String(s.completed),
        String(s.remaining),
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return rows.join("\n") + "\n";
}

/** Resolve current cell status honoring the sparse progress map. */
export function statusOf(
  progress: Record<string, CellProgress>,
  row: number,
  col: number,
): CellStatus {
  return progress[cellKey(row, col)]?.status ?? "not_started";
}
