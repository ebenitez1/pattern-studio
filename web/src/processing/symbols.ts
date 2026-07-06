/**
 * From an image + grid boundaries, extract each cell, perceptually hash it
 * (shared-core), cluster into symbols, and assemble the GridData the rest of
 * the app already consumes — identical shape to the backend's result.
 */
import {
  clusterCells,
  distanceToConfidence,
  perceptualHash,
  type GridCell,
  type GridData,
  type HashedCell,
  type PatternSymbol,
} from "@pattern-studio/core";
import type { LoadedImage } from "./loadImage";
import type { GridBoundaries } from "./grid";

const HASH_SAMPLE = 24; // sample each cell into 24x24 gray for hashing
const THUMB_SIZE = 48;
const INSET = 0.16; // ignore the outer 16% of a cell (grid lines / borders)

interface CellRegion {
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function buildRegions(bounds: GridBoundaries): {
  regions: CellRegion[];
  rows: number;
  cols: number;
} {
  const { rowBoundaries, colBoundaries } = bounds;
  const rows = Math.max(1, rowBoundaries.length - 1);
  const cols = Math.max(1, colBoundaries.length - 1);
  const regions: CellRegion[] = [];
  for (let r = 0; r < rows; r++) {
    const y0 = rowBoundaries[r]!;
    const y1 = rowBoundaries[r + 1]!;
    for (let c = 0; c < cols; c++) {
      const x0 = colBoundaries[c]!;
      const x1 = colBoundaries[c + 1]!;
      regions.push({ row: r, col: c, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  return { regions, rows, cols };
}

/** Nearest-neighbour sample of a cell's inset centre into an SxS gray buffer. */
function sampleGray(
  data: Uint8ClampedArray,
  imgW: number,
  region: CellRegion,
  size: number,
): Float64Array {
  const out = new Float64Array(size * size);
  const insetX = region.w * INSET;
  const insetY = region.h * INSET;
  const x0 = region.x + insetX;
  const y0 = region.y + insetY;
  const innerW = Math.max(1, region.w - 2 * insetX);
  const innerH = Math.max(1, region.h - 2 * insetY);
  for (let sy = 0; sy < size; sy++) {
    const py = Math.min(imgW - 1, Math.floor(y0 + (sy / size) * innerH));
    for (let sx = 0; sx < size; sx++) {
      const px = Math.floor(x0 + (sx / size) * innerW);
      const idx = (py * imgW + px) * 4;
      // luminance
      out[sy * size + sx] =
        0.299 * data[idx]! + 0.587 * data[idx + 1]! + 0.114 * data[idx + 2]!;
    }
  }
  return out;
}

/** Mean colour of a cell's inset centre as #rrggbb. */
function meanColor(
  data: Uint8ClampedArray,
  imgW: number,
  region: CellRegion,
): string {
  const insetX = region.w * INSET;
  const insetY = region.h * INSET;
  const x0 = Math.floor(region.x + insetX);
  const y0 = Math.floor(region.y + insetY);
  const x1 = Math.ceil(region.x + region.w - insetX);
  const y1 = Math.ceil(region.y + region.h - insetY);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * imgW + x) * 4;
      r += data[idx]!;
      g += data[idx + 1]!;
      b += data[idx + 2]!;
      n++;
    }
  }
  if (n === 0) return "#000000";
  const to2 = (v: number) =>
    Math.round(v / n)
      .toString(16)
      .padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function thumbnailDataUrl(
  source: CanvasImageSource,
  region: CellRegion,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    source,
    region.x,
    region.y,
    Math.max(1, region.w),
    Math.max(1, region.h),
    0,
    0,
    THUMB_SIZE,
    THUMB_SIZE,
  );
  return canvas.toDataURL("image/png");
}

export interface RecognizedGrid {
  grid: GridData;
  /** representative cell region per symbol id — used later for OCR crops */
  representativeRegion: Record<string, CellRegion>;
}

export function recognizeSymbols(
  img: LoadedImage,
  bounds: GridBoundaries,
  hashThreshold = 10,
): RecognizedGrid {
  const { imageData, width } = img;
  const data = imageData.data;
  const { regions, rows, cols } = buildRegions(bounds);

  // hash + colour every cell
  const hashed: HashedCell[] = regions.map((region) => {
    const gray = sampleGray(data, width, region, HASH_SAMPLE);
    return {
      row: region.row,
      col: region.col,
      hash: perceptualHash(gray, HASH_SAMPLE, HASH_SAMPLE),
      color: meanColor(data, width, region),
    };
  });

  const cluster = clusterCells(hashed, hashThreshold);

  // a canvas holding the full image so thumbnails can be cropped from it
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = imageData.width;
  fullCanvas.height = imageData.height;
  fullCanvas.getContext("2d")?.putImageData(imageData, 0, 0);

  const cells: GridCell[] = regions.map((region, i) => ({
    row: region.row,
    col: region.col,
    symbol_id: cluster.symbolIdByCell[i]!,
    confidence: distanceToConfidence(cluster.distanceByCell[i]!),
  }));

  const representativeRegion: Record<string, CellRegion> = {};
  const symbols: PatternSymbol[] = Object.keys(cluster.counts)
    .map((id) => {
      const repIdx = cluster.representativeCellIndex[id]!;
      const region = regions[repIdx]!;
      representativeRegion[id] = region;
      return {
        id,
        thumbnail: thumbnailDataUrl(fullCanvas, region),
        ocr_text: null,
        dominant_color: hashed[repIdx]!.color,
        color_name: null,
        color_code: null,
        count: cluster.counts[id]!,
      } satisfies PatternSymbol;
    })
    .sort((a, b) => b.count - a.count);

  return {
    grid: { rows, cols, cells, symbols },
    representativeRegion,
  };
}
