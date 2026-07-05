import { useState } from "react";
import {
  buildExportRequest,
  EXPORT_MIME,
  exportFileName,
  useProjectStore,
  type ExportFormat,
} from "@pattern-studio/core";
import { apiClient } from "../api";

const FORMATS: ExportFormat[] = ["png", "csv", "pdf"];

export function ExportMenu() {
  const project = useProjectStore((s) => s.project);
  const filter = useProjectStore((s) => s.filter);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!project) {
    return <p className="panel-empty">Open a project to export.</p>;
  }

  const jobId = project.job_id;

  const doExport = async (format: ExportFormat) => {
    if (!jobId || busy) return;
    setBusy(format);
    setError(null);
    try {
      const req = buildExportRequest(format, filter, project.progress);
      const blob = await apiClient.export(jobId, req);
      const typed =
        blob.type === EXPORT_MIME[format]
          ? blob
          : new Blob([blob], { type: EXPORT_MIME[format] });
      const url = URL.createObjectURL(typed);
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
            disabled={!jobId || busy !== null}
            onClick={() => void doExport(f)}
          >
            {busy === f ? "Exporting…" : f.toUpperCase()}
          </button>
        ))}
      </div>
      {!jobId && (
        <p className="panel-note">
          This project has no backend job attached, so server exports are
          unavailable.
        </p>
      )}
      {error && <p className="panel-error">{error}</p>}
      <p className="panel-note">
        Exports respect the current filter (Show Only selection, Hide
        Completed) and include your progress.
      </p>
    </div>
  );
}
