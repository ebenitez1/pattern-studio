import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { getStorage } from "../storage";
import { cycleCell, setCellStatus, clearStatus } from "../logic/progress";
import { toggleHiddenSymbol, toggleSymbolSelection } from "../logic/filters";
import {
  DEFAULT_FILTER,
  DEFAULT_VIEWPORT,
  type CellStatus,
  type FilterMode,
  type FilterState,
  type GridData,
  type Project,
  type ProjectSummary,
  type ProjectTag,
  type Viewport,
} from "../types";

const AUTOSAVE_DEBOUNCE_MS = 800;

export interface ProjectStore {
  // -- project list -------------------------------------------------------
  projects: ProjectSummary[];
  refreshProjects: () => Promise<void>;

  // -- active project -----------------------------------------------------
  project: Project | null;
  openProject: (id: string) => Promise<void>;
  closeProject: () => Promise<void>;
  createProject: (args: {
    name: string;
    sourceFileName: string;
    jobId: string | null;
    grid: GridData;
    tags?: ProjectTag[];
    thumbnail?: string | null;
  }) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  updateNotes: (notes: string) => void;
  updateTags: (tags: ProjectTag[]) => void;
  renameProject: (name: string) => void;
  /** rename any stored project by id (library rename, project need not be open) */
  renameProjectById: (id: string, name: string) => Promise<void>;
  /** mark a whole pattern finished / not finished */
  setProjectDone: (id: string, done: boolean) => Promise<void>;

  // -- progress -----------------------------------------------------------
  cycleCell: (row: number, col: number) => void;
  setCellStatus: (row: number, col: number, status: CellStatus) => void;
  /** reset every completed cell back to not_started */
  clearCompleted: () => void;

  // -- viewer -------------------------------------------------------------
  viewport: Viewport;
  setViewport: (v: Viewport) => void;

  // -- filters / search ---------------------------------------------------
  filter: FilterState;
  setFilterMode: (mode: FilterMode) => void;
  toggleSymbol: (symbolId: string) => void;
  clearSelection: () => void;
  setHideCompleted: (hide: boolean) => void;
  /** toggle a colour hidden — hidden colours render as empty canvas and their
   *  cells cannot be clicked until unhidden */
  toggleHiddenColor: (symbolId: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // -- internal -----------------------------------------------------------
  /** monotonically increments on any change that should redraw the grid */
  gridRevision: number;
  flushSave: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave(get: () => ProjectStore) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void get().flushSave();
  }, AUTOSAVE_DEBOUNCE_MS);
}

export const useProjectStore = create<ProjectStore>()(
  subscribeWithSelector((set, get) => ({
    projects: [],
    project: null,
    viewport: DEFAULT_VIEWPORT,
    filter: DEFAULT_FILTER,
    searchQuery: "",
    gridRevision: 0,

    refreshProjects: async () => {
      const projects = await getStorage().listProjects();
      set({ projects });
    },

    openProject: async (id) => {
      const project = await getStorage().loadProject(id);
      if (!project) throw new Error(`Project ${id} not found`);
      project.last_opened_at = Date.now();
      await getStorage().saveProject(project);
      set({
        project,
        viewport: project.viewport ?? DEFAULT_VIEWPORT,
        filter: DEFAULT_FILTER,
        searchQuery: "",
        gridRevision: get().gridRevision + 1,
      });
    },

    closeProject: async () => {
      await get().flushSave();
      set({ project: null, viewport: DEFAULT_VIEWPORT, filter: DEFAULT_FILTER });
    },

    createProject: async ({ name, sourceFileName, jobId, grid, tags, thumbnail }) => {
      const now = Date.now();
      const project: Project = {
        id: `p_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        source_file_name: sourceFileName,
        job_id: jobId,
        grid,
        progress: {},
        viewport: DEFAULT_VIEWPORT,
        notes: "",
        tags: tags ?? [],
        thumbnail: thumbnail ?? null,
        created_at: now,
        last_opened_at: now,
      };
      await getStorage().saveProject(project);
      set({
        project,
        viewport: DEFAULT_VIEWPORT,
        filter: DEFAULT_FILTER,
        gridRevision: get().gridRevision + 1,
      });
      void get().refreshProjects();
      return project;
    },

    deleteProject: async (id) => {
      await getStorage().deleteProject(id);
      if (get().project?.id === id) set({ project: null });
      void get().refreshProjects();
    },

    renameProject: (name) => {
      const p = get().project;
      if (!p) return;
      set({ project: { ...p, name } });
      scheduleAutosave(get);
    },

    renameProjectById: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const current = get().project;
      if (current?.id === id) {
        get().renameProject(trimmed);
        await get().flushSave();
      } else {
        const stored = await getStorage().loadProject(id);
        if (!stored) return;
        await getStorage().saveProject({ ...stored, name: trimmed });
      }
      await get().refreshProjects();
    },

    setProjectDone: async (id, done) => {
      const current = get().project;
      if (current?.id === id) {
        set({ project: { ...current, completed: done } });
        await get().flushSave();
      } else {
        const stored = await getStorage().loadProject(id);
        if (!stored) return;
        await getStorage().saveProject({ ...stored, completed: done });
      }
      await get().refreshProjects();
    },

    updateNotes: (notes) => {
      const p = get().project;
      if (!p) return;
      set({ project: { ...p, notes } });
      scheduleAutosave(get);
    },

    updateTags: (tags) => {
      const p = get().project;
      if (!p) return;
      set({ project: { ...p, tags } });
      scheduleAutosave(get);
    },

    cycleCell: (row, col) => {
      const p = get().project;
      if (!p) return;
      const progress = cycleCell(p.progress, row, col, Date.now());
      set({
        project: { ...p, progress },
        gridRevision: get().gridRevision + 1,
      });
      scheduleAutosave(get);
    },

    setCellStatus: (row, col, status) => {
      const p = get().project;
      if (!p) return;
      const progress = setCellStatus(p.progress, row, col, status, Date.now());
      set({
        project: { ...p, progress },
        gridRevision: get().gridRevision + 1,
      });
      scheduleAutosave(get);
    },

    clearCompleted: () => {
      const p = get().project;
      if (!p) return;
      const progress = clearStatus(p.progress, "completed");
      set({
        project: { ...p, progress },
        gridRevision: get().gridRevision + 1,
      });
      scheduleAutosave(get);
    },

    setViewport: (viewport) => {
      set({ viewport });
      const p = get().project;
      if (p) {
        // keep viewport on the project object so resume restores zoom/pan
        p.viewport = viewport;
        scheduleAutosave(get);
      }
    },

    setFilterMode: (mode) => {
      set({
        filter: { ...get().filter, mode },
        gridRevision: get().gridRevision + 1,
      });
    },

    toggleSymbol: (symbolId) => {
      const filter = get().filter;
      const selectedSymbolIds = toggleSymbolSelection(
        filter.selectedSymbolIds,
        symbolId,
      );
      // selecting a symbol with no mode active defaults to highlight
      const mode =
        filter.mode === "none" && selectedSymbolIds.length > 0
          ? "highlight"
          : filter.mode;
      set({
        filter: { ...filter, selectedSymbolIds, mode },
        gridRevision: get().gridRevision + 1,
      });
    },

    clearSelection: () => {
      set({
        filter: { ...get().filter, selectedSymbolIds: [], mode: "none" },
        gridRevision: get().gridRevision + 1,
      });
    },

    setHideCompleted: (hideCompleted) => {
      set({
        filter: { ...get().filter, hideCompleted },
        gridRevision: get().gridRevision + 1,
      });
    },

    toggleHiddenColor: (symbolId) => {
      const filter = get().filter;
      set({
        filter: {
          ...filter,
          hiddenSymbolIds: toggleHiddenSymbol(filter.hiddenSymbolIds, symbolId),
        },
        gridRevision: get().gridRevision + 1,
      });
    },

    setSearchQuery: (searchQuery) => set({ searchQuery }),

    flushSave: async () => {
      const p = get().project;
      if (!p) return;
      await getStorage().saveProject({ ...p, viewport: get().viewport });
    },
  })),
);
