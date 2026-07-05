import type { Project, ProjectSummary } from "./types";

/**
 * Persistence boundary. Each platform provides an implementation:
 *   web    → Dexie.js (IndexedDB)
 *   mobile → expo-sqlite
 *
 * The store auto-saves through whichever implementation is registered, so all
 * progress/viewport writes flow through here.
 */
export interface ProjectStorage {
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<Project | null>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
}

let storage: ProjectStorage | null = null;

export function registerStorage(impl: ProjectStorage): void {
  storage = impl;
}

export function getStorage(): ProjectStorage {
  if (!storage) {
    throw new Error(
      "No ProjectStorage registered — call registerStorage() at app startup",
    );
  }
  return storage;
}
