import { useMemo } from "react";
import { computeStats, useProjectStore, type PatternSymbol } from "@pattern-studio/core";

export function StatsPanel() {
  const project = useProjectStore((s) => s.project);
  const gridRevision = useProjectStore((s) => s.gridRevision);

  const stats = useMemo(() => {
    if (!project) return null;
    return computeStats(project.grid, project.progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, gridRevision]);

  if (!project || !stats) {
    return <p className="panel-empty">Open a project to see stats.</p>;
  }

  const symbolById = new Map<string, PatternSymbol>();
  for (const s of project.grid.symbols) symbolById.set(s.id, s);

  const pct = Math.round(stats.completion * 100);

  return (
    <div className="stats-panel">
      <dl className="stats-grid">
        <div>
          <dt>Grid</dt>
          <dd>
            {stats.rows} × {stats.cols}
          </dd>
        </div>
        <div>
          <dt>Total cells</dt>
          <dd>{stats.total_cells.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Unique symbols</dt>
          <dd>{stats.unique_symbols}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{stats.completed.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>{stats.remaining.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Needs review</dt>
          <dd>{stats.needs_review.toLocaleString()}</dd>
        </div>
      </dl>

      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Completion"
      >
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        <span className="progress-bar-label">{pct}%</span>
      </div>

      <table className="stats-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Total</th>
            <th>Done</th>
            <th>Left</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {stats.per_symbol.map((row) => {
            const sym = symbolById.get(row.symbol_id);
            const done = row.total === 0 ? 0 : Math.round((row.completed / row.total) * 100);
            return (
              <tr key={row.symbol_id}>
                <td className="stats-symbol-cell">
                  <span
                    className="stats-swatch"
                    style={{ background: sym?.dominant_color ?? "var(--color-surface-raised)" }}
                  />
                  {sym?.ocr_text ?? sym?.color_name ?? row.symbol_id}
                </td>
                <td>{row.total}</td>
                <td>{row.completed}</td>
                <td>{row.remaining}</td>
                <td>{done}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
