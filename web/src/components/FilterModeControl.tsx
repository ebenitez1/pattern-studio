import { useProjectStore, type FilterMode } from "@pattern-studio/core";

const MODES: { mode: FilterMode; label: string }[] = [
  { mode: "none", label: "None" },
  { mode: "show_only", label: "Show Only" },
  { mode: "highlight", label: "Highlight" },
];

/** Segmented control for the filter mode; reused in top bar + symbol panel. */
export function FilterModeControl({ compact = false }: { compact?: boolean }) {
  const mode = useProjectStore((s) => s.filter.mode);
  const setFilterMode = useProjectStore((s) => s.setFilterMode);

  return (
    <div
      className={`segmented ${compact ? "segmented-compact" : ""}`}
      role="group"
      aria-label="Filter mode"
    >
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          className={`segmented-btn ${mode === m.mode ? "active" : ""}`}
          onClick={() => setFilterMode(m.mode)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
