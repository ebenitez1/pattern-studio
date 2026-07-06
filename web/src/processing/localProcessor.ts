/**
 * Browser-side replacement for the FastAPI pipeline. Turns an uploaded File
 * into the same GridData the backend produced, entirely client-side, so the
 * app is fully static (GitHub Pages, no server).
 *
 * Stages mirror the backend orchestrator (run.py): load → grid → symbols →
 * (optional) OCR. Progress is reported through a callback shaped like the
 * JobStatus updates the upload UI already knows how to render.
 */
import type { GridData } from "@pattern-studio/core";
import { loadImageFromFile } from "./loadImage";
import { detectGrid } from "./grid";
import { recognizeSymbols } from "./symbols";
import { runOcr } from "./ocr";

export interface ProcessProgress {
  stage: string;
  progress: number; // 0..1
}

export interface ProcessOptions {
  ocr?: boolean;
  hashThreshold?: number;
}

export async function processFile(
  file: File,
  onProgress: (p: ProcessProgress) => void,
  opts: ProcessOptions = {},
): Promise<GridData> {
  onProgress({ stage: "loading image", progress: 0.05 });
  const img = await loadImageFromFile(file);

  onProgress({ stage: "detecting grid", progress: 0.3 });
  const bounds = await detectGrid(img);

  onProgress({ stage: "recognizing symbols", progress: 0.6 });
  const { grid, representativeRegion } = recognizeSymbols(
    img,
    bounds,
    opts.hashThreshold,
  );

  if (opts.ocr) {
    onProgress({ stage: "reading text (OCR)", progress: 0.8 });
    try {
      await runOcr(img, grid, representativeRegion, (f) =>
        onProgress({ stage: "reading text (OCR)", progress: 0.8 + f * 0.18 }),
      );
    } catch (err) {
      // OCR is best-effort; never fail the whole job because of it
      console.warn("OCR skipped:", err);
    }
  }

  onProgress({ stage: "done", progress: 1 });
  return grid;
}
