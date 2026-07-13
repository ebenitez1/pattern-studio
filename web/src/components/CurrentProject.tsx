import { useMemo } from "react";
import { computeStats, useProjectStore } from "@pattern-studio/core";

/**
 * "Current Project" sidebar section — a focused summary of the pattern that is
 * open right now (separate from the library list): thumbnail, name, size,
 * live bead progress, and quick actions.
 */
export function CurrentProject() {
  const project = useProjectStore((s) => s.project);
  const gridRevision = useProjectStore((s) => s.gridRevision);
  const closeProject = useProjectStore((s) => s.closeProject);
  const setProjectDone = useProjectStore((s) => s.setProjectDone);

  const stats = useMemo(() => {
    if (!project) return null;
    return computeStats(project.grid, project.progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, gridRevision]);

  if (!project || !stats) {
    return (
      <p className="panel-empty">
        No pattern open — pick one from Projects or add a new one.
      </p>
    );
  }

  const pct = Math.round(stats.completion * 100);

  return (
    <div className="current-project">
      <div className="current-project-head">
        {project.thumbnail ? (
          <img className="current-project-thumb" src={project.thumbnail} alt="" />
        ) : (
          <span className="current-project-thumb project-thumb-placeholder" />
        )}
        <div className="current-project-meta">
          <span className="current-project-name">
            {project.name}
            {project.completed && (
              <span className="project-done-badge">✓ Completed</span>
            )}
          </span>
          <span className="current-project-sub">
            {stats.rows} × {stats.cols} · {stats.unique_symbols} colors
          </span>
          <span className="current-project-sub">
            {stats.completed.toLocaleString()}/{stats.total_cells.toLocaleString()}{" "}
            beads placed
          </span>
        </div>
      </div>

      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Pattern completion"
      >
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        <span className="progress-bar-label">{pct}%</span>
      </div>

      <div className="current-project-actions">
        <button
          type="button"
          className={`btn btn-small ${project.completed ? "btn-done-active" : ""}`}
          onClick={() => void setProjectDone(project.id, !project.completed)}
        >
          {project.completed ? "✓ Completed" : "Mark as Complete"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => void closeProject()}
          title="Close this pattern (progress is saved)"
        >
          Close
        </button>
      </div>
    </div>
  );
}
