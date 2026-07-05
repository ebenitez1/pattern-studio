/**
 * Drag-and-drop / file-picker upload. Uploads to the backend, polls the job
 * with a progress UI, then creates a local project (with a canvas-generated
 * thumbnail) from the resulting grid.
 */
import { useCallback, useRef, useState, type DragEvent } from "react";
import { useProjectStore, type JobStatus } from "@pattern-studio/core";
import { apiClient } from "../api";
import { gridThumbnailDataUrl } from "../lib/thumbnail";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "processing"; fileName: string; stage: string; progress: number }
  | { kind: "error"; message: string };

function projectNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  return base || fileName;
}

export function UploadDropzone({ onDone }: { onDone?: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const createProject = useProjectStore((s) => s.createProject);

  const busy = phase.kind === "uploading" || phase.kind === "processing";

  const handleFile = useCallback(
    async (file: File) => {
      if (busy) return;
      setPhase({ kind: "uploading", fileName: file.name });
      try {
        const { job_id } = await apiClient.upload({
          file,
          name: file.name,
          type: file.type || "application/octet-stream",
        });
        setPhase({
          kind: "processing",
          fileName: file.name,
          stage: "queued",
          progress: 0,
        });
        const grid = await apiClient.waitForJob(job_id, (status: JobStatus) => {
          setPhase({
            kind: "processing",
            fileName: file.name,
            stage: status.stage || status.state,
            progress: status.progress,
          });
        });
        const thumbnail = gridThumbnailDataUrl(grid);
        await createProject({
          name: projectNameFromFile(file.name),
          sourceFileName: file.name,
          jobId: job_id,
          grid,
          thumbnail,
        });
        setPhase({ kind: "idle" });
        onDone?.();
      } catch (e) {
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [busy, createProject, onDone],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div
      className={`dropzone ${dragOver ? "drag-over" : ""} ${busy ? "busy" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />

      {phase.kind === "idle" && (
        <>
          <p className="dropzone-title">Drop a pattern image or PDF here</p>
          <p className="dropzone-sub">
            The analyzer will detect the grid, symbols and colours.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => inputRef.current?.click()}
          >
            Choose file…
          </button>
        </>
      )}

      {phase.kind === "uploading" && (
        <p className="dropzone-title">Uploading {phase.fileName}…</p>
      )}

      {phase.kind === "processing" && (
        <div className="dropzone-progress">
          <p className="dropzone-title">Analyzing {phase.fileName}</p>
          <p className="dropzone-sub">
            {phase.stage} — {Math.round(phase.progress * 100)}%
          </p>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.round(phase.progress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {phase.kind === "error" && (
        <>
          <p className="panel-error">{phase.message}</p>
          <button
            type="button"
            className="btn"
            onClick={() => setPhase({ kind: "idle" })}
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}
