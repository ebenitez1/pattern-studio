/**
 * expo-sqlite implementation of the core ProjectStorage interface.
 *
 * Layout: one `projects` table holding both denormalized summary columns
 * (fast list screens — no JSON parse of the big blob) and a `data` column
 * with the full Project JSON.
 */
import * as SQLite from "expo-sqlite";
import type {
  Project,
  ProjectStorage,
  ProjectSummary,
  ProjectTag,
} from "@pattern-studio/core";

const DB_NAME = "pattern-studio.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          thumbnail TEXT,
          rows INTEGER NOT NULL,
          cols INTEGER NOT NULL,
          completed_cells INTEGER NOT NULL DEFAULT 0,
          total_cells INTEGER NOT NULL DEFAULT 0,
          last_opened_at INTEGER NOT NULL DEFAULT 0,
          data TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

interface SummaryRow {
  id: string;
  name: string;
  tags: string;
  thumbnail: string | null;
  rows: number;
  cols: number;
  completed_cells: number;
  total_cells: number;
  last_opened_at: number;
}

function parseTags(raw: string): ProjectTag[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProjectTag[]) : [];
  } catch {
    return [];
  }
}

function countCompleted(project: Project): number {
  let completed = 0;
  for (const key in project.progress) {
    if (project.progress[key].status === "completed") completed++;
  }
  return completed;
}

export const sqliteStorage: ProjectStorage = {
  async listProjects(): Promise<ProjectSummary[]> {
    const db = await getDb();
    // Summary columns only — the `data` JSON blob is never parsed here.
    const rows = await db.getAllAsync<SummaryRow>(
      `SELECT id, name, tags, thumbnail, rows, cols,
              completed_cells, total_cells, last_opened_at
       FROM projects
       ORDER BY last_opened_at DESC`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      tags: parseTags(r.tags),
      thumbnail: r.thumbnail,
      rows: r.rows,
      cols: r.cols,
      completed_cells: r.completed_cells,
      total_cells: r.total_cells,
      last_opened_at: r.last_opened_at,
    }));
  },

  async loadProject(id: string): Promise<Project | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ data: string }>(
      "SELECT data FROM projects WHERE id = ?",
      id,
    );
    if (!row) return null;
    return JSON.parse(row.data) as Project;
  },

  async saveProject(project: Project): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO projects
         (id, name, tags, thumbnail, rows, cols,
          completed_cells, total_cells, last_opened_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      project.id,
      project.name,
      JSON.stringify(project.tags),
      project.thumbnail,
      project.grid.rows,
      project.grid.cols,
      countCompleted(project),
      project.grid.cells.length,
      project.last_opened_at,
      JSON.stringify(project),
    );
  },

  async deleteProject(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync("DELETE FROM projects WHERE id = ?", id);
  },
};
