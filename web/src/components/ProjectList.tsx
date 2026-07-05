import { useEffect, useState } from "react";
import {
  searchProjects,
  useProjectStore,
  type ProjectSummary,
  type ProjectTag,
} from "@pattern-studio/core";
import { dexieStorage } from "../storage/dexieStorage";

const BUILT_IN_TAGS: ProjectTag[] = ["perler", "cross-stitch", "embroidery"];

function TagChips({ tags }: { tags: ProjectTag[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="tag-chips">
      {tags.map((t) => (
        <span key={t} className="tag-chip">
          {t}
        </span>
      ))}
    </span>
  );
}

interface EditState {
  id: string;
  tags: ProjectTag[];
  freeTag: string;
  notes: string;
}

export function ProjectList() {
  const projects = useProjectStore((s) => s.projects);
  const refreshProjects = useProjectStore((s) => s.refreshProjects);
  const openProject = useProjectStore((s) => s.openProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const activeId = useProjectStore((s) => s.project?.id ?? null);

  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<EditState | null>(null);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  // searchProjects already sorts by last_opened_at descending
  const visible = searchProjects(projects, query);

  const beginEdit = async (summary: ProjectSummary) => {
    const full = await dexieStorage.loadProject(summary.id);
    setEdit({
      id: summary.id,
      tags: full?.tags ?? summary.tags,
      freeTag: "",
      notes: full?.notes ?? "",
    });
  };

  const saveEdit = async () => {
    if (!edit) return;
    const full = await dexieStorage.loadProject(edit.id);
    if (full) {
      const tags = [...edit.tags];
      const free = edit.freeTag.trim();
      if (free && !tags.includes(free)) tags.push(free);
      await dexieStorage.saveProject({ ...full, tags, notes: edit.notes });
      // keep the open project in sync if it is the one being edited
      const store = useProjectStore.getState();
      if (store.project?.id === edit.id) {
        store.updateTags(tags);
        store.updateNotes(edit.notes);
      }
      await refreshProjects();
    }
    setEdit(null);
  };

  const toggleEditTag = (tag: ProjectTag) => {
    setEdit((prev) =>
      prev
        ? {
            ...prev,
            tags: prev.tags.includes(tag)
              ? prev.tags.filter((t) => t !== tag)
              : [...prev.tags, tag],
          }
        : prev,
    );
  };

  const confirmDelete = (p: ProjectSummary) => {
    if (window.confirm(`Delete “${p.name}”? This cannot be undone.`)) {
      void deleteProject(p.id);
    }
  };

  return (
    <div className="project-list">
      <input
        type="search"
        className="input"
        placeholder="Search projects…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search projects"
      />

      {visible.length === 0 && (
        <p className="panel-empty">
          {projects.length === 0
            ? "No projects yet — upload a pattern to get started."
            : "No projects match your search."}
        </p>
      )}

      <ul className="project-rows">
        {visible.map((p) => (
          <li
            key={p.id}
            className={`project-row ${p.id === activeId ? "active" : ""}`}
          >
            <button
              type="button"
              className="project-open"
              onClick={() => void openProject(p.id)}
              title={`Open ${p.name}`}
            >
              {p.thumbnail ? (
                <img className="project-thumb" src={p.thumbnail} alt="" />
              ) : (
                <span className="project-thumb project-thumb-placeholder" />
              )}
              <span className="project-meta">
                <span className="project-name">{p.name}</span>
                <span className="project-sub">
                  {p.rows}×{p.cols} · {p.completed_cells}/{p.total_cells} done
                </span>
                <TagChips tags={p.tags} />
              </span>
            </button>
            <span className="project-actions">
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => void beginEdit(p)}
                title="Edit tags and notes"
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small btn-danger"
                onClick={() => confirmDelete(p)}
                title="Delete project"
              >
                Delete
              </button>
            </span>

            {edit?.id === p.id && (
              <div className="project-edit">
                <div className="tag-toggle-row">
                  {BUILT_IN_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`tag-chip tag-chip-btn ${
                        edit.tags.includes(tag) ? "selected" : ""
                      }`}
                      onClick={() => toggleEditTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                  {edit.tags
                    .filter((t) => !BUILT_IN_TAGS.includes(t))
                    .map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="tag-chip tag-chip-btn selected"
                        onClick={() => toggleEditTag(tag)}
                        title="Remove tag"
                      >
                        {tag} ×
                      </button>
                    ))}
                </div>
                <input
                  type="text"
                  className="input"
                  placeholder="Add custom tag"
                  value={edit.freeTag}
                  onChange={(e) =>
                    setEdit((prev) =>
                      prev ? { ...prev, freeTag: e.target.value } : prev,
                    )
                  }
                />
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Notes"
                  value={edit.notes}
                  onChange={(e) =>
                    setEdit((prev) =>
                      prev ? { ...prev, notes: e.target.value } : prev,
                    )
                  }
                />
                <div className="project-edit-actions">
                  <button type="button" className="btn" onClick={() => void saveEdit()}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setEdit(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
