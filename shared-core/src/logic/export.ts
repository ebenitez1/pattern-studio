import type {
  CellProgress,
  CellStatus,
  ExportFormat,
  ExportRequest,
  FilterState,
} from "../types";

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
