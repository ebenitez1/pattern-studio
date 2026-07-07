/**
 * Turn an uploaded File (image or PDF) into an ImageData the pipeline can
 * process. PDFs are rendered with pdf.js (first page, high scale). Everything
 * runs in the browser — no backend.
 */

/** Cap the working resolution so huge phone photos don't blow up memory. */
const MAX_DIM = 2600;

export interface LoadedImage {
  imageData: ImageData;
  width: number;
  height: number;
}

function canvasToImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function fitDimensions(w: number, h: number): { w: number; h: number } {
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

async function loadRasterImage(file: File | Blob): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(file);
  const { w, h } = fitDimensions(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  // Composite over white so a transparent PNG background reads as white (empty)
  // rather than black — otherwise transparent areas become dark "beads".
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { imageData: canvasToImageData(canvas), width: w, height: h };
}

async function loadPdfFirstPage(file: File | Blob): Promise<LoadedImage> {
  // pdf.js needs its worker; point it at the bundled worker URL (Vite resolves
  // the ?url import to a hashed asset served from the same origin — Pages-safe).
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
    .default as string;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) });
  const doc = await loadingTask.promise;
  const page = await doc.getPage(1);

  // render at a scale that yields a detailed raster, then clamp to MAX_DIM
  const baseViewport = page.getViewport({ scale: 1 });
  const targetScale = Math.min(
    3,
    MAX_DIM / Math.max(baseViewport.width, baseViewport.height),
  );
  const viewport = page.getViewport({ scale: Math.max(1, targetScale) });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas context unavailable");
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  void loadingTask.destroy();
  return {
    imageData: canvasToImageData(canvas),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function loadImageFromFile(file: File): Promise<LoadedImage> {
  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  return isPdf ? loadPdfFirstPage(file) : loadRasterImage(file);
}
