import { useMemo } from "react";
import {
  computeStats,
  searchSymbols,
  useProjectStore,
  type SymbolStats,
} from "@pattern-studio/core";
import { useA11y } from "../a11y";
import { FilterModeControl } from "./FilterModeControl";

export function SymbolPanel() {
  const { prefs } = useA11y();
  const project = useProjectStore((s) => s.project);
  const gridRevision = useProjectStore((s) => s.gridRevision);
  const searchQuery = useProjectStore((s) => s.searchQuery);
  const filter = useProjectStore((s) => s.filter);
  const toggleSymbol = useProjectStore((s) => s.toggleSymbol);
  const clearSelection = useProjectStore((s) => s.clearSelection);
  const setHideCompleted = useProjectStore((s) => s.setHideCompleted);
  const toggleHiddenColor = useProjectStore((s) => s.toggleHiddenColor);

  const stats = useMemo(() => {
    if (!project) return null;
    return computeStats(project.grid, project.progress);
    // recompute exactly once per grid change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, gridRevision]);

  const symbols = useMemo(() => {
    if (!project) return [];
    return searchSymbols(project.grid.symbols, searchQuery);
  }, [project, searchQuery]);

  if (!project || !stats) {
    return <p className="panel-empty">Open a project to see its symbols.</p>;
  }

  const statsBySymbol = new Map<string, SymbolStats>();
  for (const s of stats.per_symbol) statsBySymbol.set(s.symbol_id, s);

  const thumbSize = Math.round(28 * prefs.symbolScale);
  const selected = new Set(filter.selectedSymbolIds);
  const hidden = new Set(filter.hiddenSymbolIds);

  return (
    <div className="symbol-panel">
      <div className="symbol-panel-controls">
        <FilterModeControl compact />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={filter.hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
          />
          Hide Completed
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={clearSelection}
          disabled={filter.selectedSymbolIds.length === 0}
        >
          Clear selection ({filter.selectedSymbolIds.length})
        </button>
      </div>

      <ul className="symbol-list">
        {symbols.map((sym) => {
          const st = statsBySymbol.get(sym.id);
          const isSelected = selected.has(sym.id);
          const isComplete = !!st && st.total > 0 && st.completed === st.total;
          const isHidden = hidden.has(sym.id);
          return (
            <li key={sym.id} className="symbol-item">
              <button
                type="button"
                className={`symbol-row ${isSelected ? "selected" : ""} ${
                  isComplete ? "complete" : ""
                } ${isHidden ? "hidden-color" : ""}`}
                onClick={() => toggleSymbol(sym.id)}
                aria-pressed={isSelected}
              >
                {sym.thumbnail ? (
                  <img
                    className="symbol-thumb"
                    src={sym.thumbnail}
                    alt={sym.ocr_text ?? "symbol"}
                    style={{ width: thumbSize, height: thumbSize }}
                  />
                ) : (
                  <span
                    className="symbol-thumb symbol-swatch"
                    style={{
                      width: thumbSize,
                      height: thumbSize,
                      background: sym.dominant_color ?? "var(--color-surface-raised)",
                    }}
                  />
                )}
                <span className="symbol-meta">
                  <span
                    className="symbol-title"
                    title={sym.dominant_color ?? undefined}
                  >
                    {sym.ocr_text && <span className="ocr-badge">{sym.ocr_text}</span>}
                    {sym.color_code
                      ? `${sym.color_code} · ${sym.color_name}`
                      : (sym.color_name ?? sym.dominant_color ?? sym.id)}
                  </span>
                  {st && (
                    <span className="symbol-breakdown">
                      {isComplete ? (
                        <span className="symbol-complete-badge">✓ Complete</span>
                      ) : (
                        <>
                          {st.completed}/{st.total} done · {st.remaining} left
                        </>
                      )}
                    </span>
                  )}
                </span>
                <span className="symbol-count">{sym.count}</span>
              </button>
              <button
                type="button"
                className={`hide-toggle ${isHidden ? "active" : ""}`}
                onClick={() => toggleHiddenColor(sym.id)}
                aria-pressed={isHidden}
                title={
                  isHidden
                    ? "Show this color (unlock its tiles)"
                    : "Hide this color (its tiles become unclickable)"
                }
              >
                {isHidden ? "Hidden" : "Hide"}
              </button>
            </li>
          );
        })}
        {symbols.length === 0 && (
          <li className="panel-empty">No symbols match “{searchQuery}”.</li>
        )}
      </ul>
    </div>
  );
}
