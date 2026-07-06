import { useState } from "react";
import {
  exportFileName,
  highlightColor,
  useProjectStore,
  type ExportFormat,
} from "@pattern-studio/core";
import { exportLocal } from "../processing/localExport";
import { useA11y } from "../a11y";

const FORMATS: ExportFormat[] = ["png", "csv", "pdf"];

export function ExportMenu() {
  const project = useProjectStore((s) => s.project);
  const filter = useProjectStore((s) => s.filter);
  const { prefs } = useA11y();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!project) {
    return <p className="panel-empty">Open a project to export.</p>;
  }

  const doExport = async (format: ExportFormat) => {
    if (busy) return;
    setBusy(format);
    setError(null);
    try {
      const blob = await exportLocal(
        format,
        project.grid,
        project.name,
        filter,
        project.progress,
        highlightColor(prefs),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(project.name, format);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="export-menu">
      <div className="export-buttons">
        {FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => void doExport(f)}
          >
            {busy === f ? "Exporting…" : f.toUpperCase()}
          </button>
        ))}
      </div>
      {error && <p className="panel-error">{error}</p>}
      <p className="panel-note">
        Exports respect the current filter (Show Only selection, Hide
        Completed) and include your progress.
      </p>
    </div>
  );
}
