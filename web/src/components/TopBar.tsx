import { useProjectStore } from "@pattern-studio/core";
import { FilterModeControl } from "./FilterModeControl";
import { SettingsPopover } from "./SettingsPopover";

export function TopBar({ onUploadClick }: { onUploadClick: () => void }) {
  const project = useProjectStore((s) => s.project);
  const renameProject = useProjectStore((s) => s.renameProject);
  const searchQuery = useProjectStore((s) => s.searchQuery);
  const setSearchQuery = useProjectStore((s) => s.setSearchQuery);
  const hideCompleted = useProjectStore((s) => s.filter.hideCompleted);
  const setHideCompleted = useProjectStore((s) => s.setHideCompleted);

  return (
    <header className="top-bar">
      {project ? (
        <input
          className="project-name-input"
          value={project.name}
          onChange={(e) => renameProject(e.target.value)}
          aria-label="Project name"
          spellCheck={false}
        />
      ) : (
        <span className="app-title">Pattern Studio</span>
      )}

      <button type="button" className="btn btn-primary" onClick={onUploadClick}>
        Upload
      </button>

      <FilterModeControl />

      <label className="checkbox-row top-bar-toggle">
        <input
          type="checkbox"
          checked={hideCompleted}
          onChange={(e) => setHideCompleted(e.target.checked)}
        />
        Hide Completed
      </label>

      <input
        type="search"
        className="input top-bar-search"
        placeholder="Search symbols (letter, colour, code)…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        aria-label="Search symbols"
      />

      <SettingsPopover />
    </header>
  );
}
