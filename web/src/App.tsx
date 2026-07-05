import { useEffect, useState } from "react";
import { useProjectStore } from "@pattern-studio/core";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { PatternCanvas } from "./components/PatternCanvas";
import { UploadDropzone } from "./components/UploadDropzone";

export default function App() {
  const project = useProjectStore((s) => s.project);
  const flushSave = useProjectStore((s) => s.flushSave);
  const [showUpload, setShowUpload] = useState(false);

  // make sure pending autosaves land before the tab closes
  useEffect(() => {
    const onHide = () => {
      void flushSave();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushSave]);

  return (
    <div className="app-shell">
      <TopBar onUploadClick={() => setShowUpload(true)} />
      <div className="app-main">
        <Sidebar />
        <main className="workspace">
          {project ? (
            <PatternCanvas />
          ) : (
            <div className="welcome">
              <h1>Pattern Studio</h1>
              <p className="welcome-sub">
                Upload a Perler-bead or cross-stitch pattern to analyze it and
                track your progress cell by cell.
              </p>
              <UploadDropzone />
            </div>
          )}
        </main>
      </div>

      {showUpload && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowUpload(false);
          }}
        >
          <div className="modal" role="dialog" aria-label="Upload pattern">
            <div className="modal-header">
              <h2>Upload pattern</h2>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowUpload(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <UploadDropzone onDone={() => setShowUpload(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
