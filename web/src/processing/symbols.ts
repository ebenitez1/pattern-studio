/**
 * From an image + grid boundaries, extract each cell, perceptually hash it
 * (shared-core), cluster into symbols, and assemble the GridData the rest of
 * the app already consumes — identical shape to the backend's result.
 */
import {
  BACKGROUND_SYMBOL_ID,
  clusterCells,
  distanceToConfidence,
  nearestDmc,
  perceptualHash,
  type GridCell,
  type GridData,
  type HashedCell,
  type PatternSymbol,
} from "@pattern-studio/core";
import { hasPrintedCode } from "./printedCode";
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

const to2 = (v: number) => Math.round(v).toString(16).padStart(2, "0");

/**
 * Dominant colour of a cell's inset centre as #rrggbb, by MODE not mean. Pixels
 * are quantised into coarse colour buckets; the most populous bucket wins and
 * its member pixels are averaged. This ignores the minority pixels from thin
 * grid lines and slight boundary overlap that a plain mean would blend into a
 * muddy grey — important for fine grids where cells are only a few pixels.
 */
function dominantColor(
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

  const counts = new Map<number, number>();
  const sums = new Map<number, [number, number, number]>();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * imgW + x) * 4;
      const r = data[idx]!;
      const g = data[idx + 1]!;
      const b = data[idx + 2]!;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); // 16 levels/chan
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const s = sums.get(key);
      if (s) {
        s[0] += r;
        s[1] += g;
        s[2] += b;
      } else {
        sums.set(key, [r, g, b]);
      }
    }
  }
  let bestKey = -1;
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      bestKey = k;
    }
  }
  if (bestKey < 0) return "#000000";
  const s = sums.get(bestKey)!;
  const c = counts.get(bestKey)!;
  return `#${to2(s[0] / c)}${to2(s[1] / c)}${to2(s[2] / c)}`;
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
  // Crop with the same inset used for colour sampling so the surrounding grid
  // lines never contaminate the thumbnail — on fine grids (cells only a few
  // pixels) an un-inset crop is mostly dark grid line, which made white cells
  // render as dark-framed tiles in the viewer.
  const insetX = region.w * INSET;
  const insetY = region.h * INSET;
  ctx.drawImage(
    source,
    region.x + insetX,
    region.y + insetY,
    Math.max(1, region.w - 2 * insetX),
    Math.max(1, region.h - 2 * insetY),
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

  // Hash + colour every cell. Only cells carrying printed codes are tracked;
  // background cells keep the grid dense but carry the reserved id.
  const hashed: HashedCell[] = [];
  const isBackground: boolean[] = [];
  for (const region of regions) {
    const gray = sampleGray(data, width, region, HASH_SAMPLE);
    const color = dominantColor(data, width, region);
    hashed.push({
      row: region.row,
      col: region.col,
      hash: perceptualHash(gray, HASH_SAMPLE, HASH_SAMPLE),
      color,
    });
    isBackground.push(!hasPrintedCode(data, width, region));
  }

  const contentRegionIdx: number[] = [];
  const contentCells: HashedCell[] = [];
  hashed.forEach((h, i) => {
    if (!isBackground[i]) {
      contentRegionIdx.push(i);
      contentCells.push(h);
    }
  });

  const cluster = clusterCells(contentCells, hashThreshold);

  // a canvas holding the full image so thumbnails can be cropped from it
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = imageData.width;
  fullCanvas.height = imageData.height;
  fullCanvas.getContext("2d")?.putImageData(imageData, 0, 0);

  // symbol id + confidence per region (background cells → reserved id)
  const symbolByRegion = new Array<string>(regions.length).fill(
    BACKGROUND_SYMBOL_ID,
  );
  const confByRegion = new Array<number>(regions.length).fill(1);
  contentRegionIdx.forEach((regionIdx, ci) => {
    symbolByRegion[regionIdx] = cluster.symbolIdByCell[ci]!;
    confByRegion[regionIdx] = distanceToConfidence(cluster.distanceByCell[ci]!);
  });

  const cells: GridCell[] = regions.map((region, i) => ({
    row: region.row,
    col: region.col,
    symbol_id: symbolByRegion[i]!,
    confidence: confByRegion[i]!,
  }));

  const representativeRegion: Record<string, CellRegion> = {};
  const symbols: PatternSymbol[] = Object.keys(cluster.counts)
    .map((id) => {
      const contentRep = cluster.representativeCellIndex[id]!;
      const regionIdx = contentRegionIdx[contentRep]!;
      const region = regions[regionIdx]!;
      representativeRegion[id] = region;
      const dominant = hashed[regionIdx]!.color;
      const dmc = nearestDmc(dominant);
      return {
        id,
        thumbnail: thumbnailDataUrl(fullCanvas, region),
        ocr_text: null,
        dominant_color: dominant,
        color_name: dmc?.name ?? null,
        color_code: dmc ? `DMC ${dmc.code}` : null,
        count: cluster.counts[id]!,
      } satisfies PatternSymbol;
    })
    .sort((a, b) => b.count - a.count);

  return {
    grid: { rows, cols, cells, symbols },
    representativeRegion,
  };
}
