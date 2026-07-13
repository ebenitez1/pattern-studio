/**
 * Drag-and-drop / file-picker upload. Processes the pattern entirely in the
 * browser (no backend) with a progress UI, then creates a local project (with
 * a canvas-generated thumbnail) from the resulting grid.
 */
import { useCallback, useRef, useState, type DragEvent } from "react";
import { useProjectStore } from "@pattern-studio/core";
import { processFile } from "../processing/localProcessor";
import { gridThumbnailDataUrl } from "../lib/thumbnail";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "processing"; fileName: string; stage: string; progress: number }
  | { kind: "success"; fileName: string; rows: number; cols: number }
  | { kind: "error"; message: string };

function projectNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  return base || fileName;
}

export function UploadDropzone({ onDone }: { onDone?: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [ocr, setOcr] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const createProject = useProjectStore((s) => s.createProject);

  const busy = phase.kind === "uploading" || phase.kind === "processing";

  const handleFile = useCallback(
    async (file: File) => {
      if (busy) return;
      setPhase({
        kind: "processing",
        fileName: file.name,
        stage: "starting",
        progress: 0,
      });
      try {
        const grid = await processFile(
          file,
          (p) =>
            setPhase({
              kind: "processing",
              fileName: file.name,
              stage: p.stage,
              progress: p.progress,
            }),
          { ocr },
        );
        // show the detected pattern size first — once the project opens, this
        // dropzone may unmount (welcome screen), so the indicator comes before
        await new Promise<void>((resolve) => {
          setPhase({
            kind: "success",
            fileName: file.name,
            rows: grid.rows,
            cols: grid.cols,
          });
          setTimeout(resolve, 1600);
        });
        const thumbnail = gridThumbnailDataUrl(grid);
        await createProject({
          name: projectNameFromFile(file.name),
          sourceFileName: file.name,
          jobId: null,
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
    [busy, createProject, onDone, ocr],
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
            Everything is analyzed in your browser — the grid, symbols and
            colours are detected on-device, no upload.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => inputRef.current?.click()}
          >
            Choose file…
          </button>
          <label className="dropzone-ocr">
            <input
              type="checkbox"
              checked={ocr}
              onChange={(e) => setOcr(e.target.checked)}
            />
            Read letter/number labels (OCR) — slower, downloads ~15MB the first
            time
          </label>
        </>
      )}

      {phase.kind === "uploading" && (
        <p className="dropzone-title">Preparing {phase.fileName}…</p>
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

      {phase.kind === "success" && (
        <div className="dropzone-progress">
          <p className="dropzone-title dropzone-success">
            ✓ Pattern added — {phase.cols} × {phase.rows} cells
          </p>
          <p className="dropzone-sub">
            The grid has been sized to fit your screen.
          </p>
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
