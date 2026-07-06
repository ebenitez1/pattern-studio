/**
 * Optional OCR for letter/number symbols, using tesseract.js. Off by default:
 * tesseract pulls its worker + language data from a CDN at runtime (~15MB), so
 * enabling it requires network access the first time. The pipeline works fully
 * without it — symbols just have no text label, exactly like the backend when
 * Tesseract isn't installed.
 */
import type { GridData } from "@pattern-studio/core";
import type { LoadedImage } from "./loadImage";

const WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

interface CellRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Cheap gate: does the representative crop look like a two-tone glyph? */
function looksLikeGlyph(
  data: Uint8ClampedArray,
  imgW: number,
  region: CellRegion,
): boolean {
  let min = 255;
  let max = 0;
  let sum = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(region.w, region.h) / 12));
  for (let y = region.y; y < region.y + region.h; y += step) {
    for (let x = region.x; x < region.x + region.w; x += step) {
      const idx = (y * imgW + x) * 4;
      const lum =
        0.299 * data[idx]! + 0.587 * data[idx + 1]! + 0.114 * data[idx + 2]!;
      min = Math.min(min, lum);
      max = Math.max(max, lum);
      sum += lum;
      n++;
    }
  }
  if (n === 0) return false;
  // needs strong contrast (a glyph on a background), not a flat colour swatch
  return max - min > 90;
}

function cropCanvas(
  source: CanvasImageSource,
  region: CellRegion,
): HTMLCanvasElement {
  const scale = 4; // upscale small cells so tesseract has pixels to work with
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.round(region.w * scale));
  canvas.height = Math.max(8, Math.round(region.h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    source,
    region.x,
    region.y,
    region.w,
    region.h,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

export async function runOcr(
  img: LoadedImage,
  grid: GridData,
  representativeRegion: Record<string, CellRegion>,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const glyphIds = grid.symbols
    .map((s) => s.id)
    .filter((id) => {
      const region = representativeRegion[id];
      return region && looksLikeGlyph(img.imageData.data, img.width, region);
    });
  if (glyphIds.length === 0) return;

  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng");
  try {
    await worker.setParameters({
      tessedit_char_whitelist: WHITELIST,
      // treat each crop as a single character
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_CHAR,
    });

    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = img.imageData.width;
    fullCanvas.height = img.imageData.height;
    fullCanvas.getContext("2d")?.putImageData(img.imageData, 0, 0);

    for (let i = 0; i < glyphIds.length; i++) {
      const id = glyphIds[i]!;
      const region = representativeRegion[id]!;
      const crop = cropCanvas(fullCanvas, region);
      const { data } = await worker.recognize(crop);
      const text = data.text.trim();
      if (text && data.confidence > 45) {
        const sym = grid.symbols.find((s) => s.id === id);
        if (sym) sym.ocr_text = text.slice(0, 3);
      }
      onProgress?.((i + 1) / glyphIds.length);
    }
  } finally {
    await worker.terminate();
  }
}
