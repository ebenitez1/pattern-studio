/**
 * Dexie (IndexedDB) implementation of the core ProjectStorage contract.
 * Must be registered via registerStorage() before anything touches the store.
 */
import Dexie, { type Table } from "dexie";
import {
  registerStorage,
  computeStats,
  type Project,
  type ProjectStorage,
  type ProjectSummary,
} from "@pattern-studio/core";

class PatternStudioDb extends Dexie {
  projects!: Table<Project, string>;

  constructor() {
    super("pattern-studio");
    this.version(1).stores({
      // Full Project objects; indexed by id + last_opened_at for list sorting.
      projects: "id, last_opened_at, name",
    });
  }
}

export const db = new PatternStudioDb();

function toSummary(p: Project): ProjectSummary {
  const stats = computeStats(p.grid, p.progress);
  return {
    id: p.id,
    name: p.name,
    tags: p.tags,
    thumbnail: p.thumbnail,
    rows: p.grid.rows,
    cols: p.grid.cols,
    completed_cells: stats.completed,
    total_cells: stats.total_cells,
    completed: p.completed ?? false,
    last_opened_at: p.last_opened_at,
  };
}

export const dexieStorage: ProjectStorage = {
  async listProjects(): Promise<ProjectSummary[]> {
    const all = await db.projects.toArray();
    return all
      .map(toSummary)
      .sort((a, b) => b.last_opened_at - a.last_opened_at);
  },

  async loadProject(id: string): Promise<Project | null> {
    return (await db.projects.get(id)) ?? null;
  },

  async saveProject(project: Project): Promise<void> {
    await db.projects.put(project);
  },

  async deleteProject(id: string): Promise<void> {
    await db.projects.delete(id);
  },
};

/** Call once at startup, before the store is used. */
export function initStorage(): void {
  registerStorage(dexieStorage);
}
