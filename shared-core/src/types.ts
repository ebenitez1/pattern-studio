/**
 * Core data model shared by web, mobile and (as a JSON contract) the FastAPI backend.
 *
 * Backend wire format uses snake_case; everything here that crosses the API
 * boundary is defined in snake_case so no mapping layer is needed.
 */

// ---------------------------------------------------------------------------
// Cell status / progress
// ---------------------------------------------------------------------------

export type CellStatus = "not_started" | "completed" | "skipped" | "needs_review";

/** Order used when tapping a cell cycles its status. */
export const CELL_STATUS_CYCLE: readonly CellStatus[] = [
  "not_started",
  "completed",
  "skipped",
  "needs_review",
];

export interface CellProgress {
  status: CellStatus;
  /** epoch ms of last status change; 0 = never touched */
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Grid & symbols (produced by the backend pipeline)
// ---------------------------------------------------------------------------

export interface GridCell {
  row: number;
  col: number;
  /** id into the symbol table */
  symbol_id: string;
  /** 0..1 — how confident the recognizer was. Cells under a threshold can be
   *  surfaced for user review (future "AI uncertainty flagging"). */
  confidence: number;
}

export interface PatternSymbol {
  id: string;
  /** representative crop, data-URL png (small, thumbnail sized) */
  thumbnail: string;
  /** OCR text if the symbol is a letter/number, else null */
  ocr_text: string | null;
  /** dominant colour of the cell as #rrggbb (basis for future DMC/Perler matching) */
  dominant_color: string | null;
  /** optional brand colour info — populated by future colour-matching hook */
  color_name: string | null;
  color_code: string | null;
  /** number of cells using this symbol */
  count: number;
}

export interface GridData {
  rows: number;
  cols: number;
  /** row-major, rows*cols entries */
  cells: GridCell[];
  symbols: PatternSymbol[];
}

// ---------------------------------------------------------------------------
// Backend job API
// ---------------------------------------------------------------------------

export type JobState = "queued" | "processing" | "done" | "error";

export interface UploadResponse {
  job_id: string;
}

export interface JobStatus {
  job_id: string;
  state: JobState;
  /** 0..1 */
  progress: number;
  /** human readable pipeline stage, e.g. "grid-detection" */
  stage: string;
  error: string | null;
}

/** GET /job/{id}/result */
export type JobResult = GridData;

export type ExportFormat = "png" | "csv" | "pdf";

export interface ExportRequest {
  format: ExportFormat;
  /** restrict export to these symbols (empty = all) */
  symbol_ids?: string[];
  /** exclude completed cells (mirrors the "Hide Completed" filter) */
  hide_completed?: boolean;
  /** cell statuses, keyed by "row:col" — lets the PDF progress report and
   *  filtered exports reflect local progress without the backend storing it */
  progress?: Record<string, CellStatus>;
}

// ---------------------------------------------------------------------------
// Viewer / filters
// ---------------------------------------------------------------------------

export type FilterMode = "none" | "show_only" | "highlight";

export interface FilterState {
  mode: FilterMode;
  /** multi-select of symbol ids the mode applies to */
  selectedSymbolIds: string[];
  hideCompleted: boolean;
  /** colours toggled hidden — their cells render as empty canvas and are not
   *  clickable until unhidden */
  hiddenSymbolIds: string[];
}

export const DEFAULT_FILTER: FilterState = {
  mode: "none",
  selectedSymbolIds: [],
  hideCompleted: false,
  hiddenSymbolIds: [],
};

export interface Viewport {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, offsetX: 0, offsetY: 0 };

// ---------------------------------------------------------------------------
// Project (persisted locally per platform: Dexie on web, SQLite on mobile)
// ---------------------------------------------------------------------------

export type ProjectTag = "perler" | "cross-stitch" | "embroidery" | (string & {});

export interface Project {
  id: string;
  name: string;
  /** original upload filename, for display */
  source_file_name: string;
  /** backend job that produced the grid (kept for re-export) */
  job_id: string | null;
  grid: GridData;
  /** sparse map "row:col" -> progress; untouched cells are implicitly not_started */
  progress: Record<string, CellProgress>;
  viewport: Viewport;
  notes: string;
  tags: ProjectTag[];
  /** small data-URL preview for the project list */
  thumbnail: string | null;
  created_at: number;
  last_opened_at: number;
}

/** Lightweight row for project list screens. */
export interface ProjectSummary {
  id: string;
  name: string;
  tags: ProjectTag[];
  thumbnail: string | null;
  rows: number;
  cols: number;
  completed_cells: number;
  total_cells: number;
  last_opened_at: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const cellKey = (row: number, col: number): string => `${row}:${col}`;

/**
 * Reserved symbol id for empty/background cells (no bead) inside the grid.
 * These cells keep the grid dense (row-major rows*cols) but are not tracked,
 * counted, or listed as a symbol.
 */
export const BACKGROUND_SYMBOL_ID = "bg";

export interface SymbolStats {
  symbol_id: string;
  total: number;
  completed: number;
  skipped: number;
  needs_review: number;
  remaining: number;
}

export interface ProjectStats {
  rows: number;
  cols: number;
  total_cells: number;
  unique_symbols: number;
  completed: number;
  skipped: number;
  needs_review: number;
  remaining: number;
  /** 0..1 */
  completion: number;
  per_symbol: SymbolStats[];
}
