/**
 * Grid detection — mirrors the backend's OpenCV approach:
 *   adaptive threshold → morphological horizontal/vertical line masks →
 *   projection peaks → boundary positions, with an autocorrelation
 *   pitch-estimation fallback when a pattern has no drawn grid lines.
 *
 * Returns pixel boundary positions on each axis (R+1 rows, C+1 cols).
 */
import { loadOpenCv } from "./opencv";
import type { LoadedImage } from "./loadImage";

export interface GridBoundaries {
  rowBoundaries: number[]; // y pixel positions, ascending, length rows+1
  colBoundaries: number[]; // x pixel positions, ascending, length cols+1
}

// --- pure signal helpers (unit-testable, no opencv) -----------------------

/** Local-maxima peaks above (mean + k*std), merged if closer than minGap. */
export function findPeaks(
  signal: Float64Array,
  minGap: number,
  k = 0.6,
): number[] {
  const n = signal.length;
  if (n === 0) return [];
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i]!;
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = signal[i]! - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / n);
  const threshold = mean + k * std;

  const candidates: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = signal[i]!;
    if (v < threshold) continue;
    if (
      (i === 0 || signal[i - 1]! <= v) &&
      (i === n - 1 || signal[i + 1]! <= v)
    ) {
      candidates.push(i);
    }
  }

  // merge candidates within minGap into their centroid
  const merged: number[] = [];
  let group: number[] = [];
  for (const c of candidates) {
    if (group.length === 0 || c - group[group.length - 1]! <= minGap) {
      group.push(c);
    } else {
      merged.push(Math.round(group.reduce((a, b) => a + b, 0) / group.length));
      group = [c];
    }
  }
  if (group.length) {
    merged.push(Math.round(group.reduce((a, b) => a + b, 0) / group.length));
  }
  return merged;
}

/** Dominant period of a signal via autocorrelation (for gridless patterns). */
export function estimatePitch(
  signal: Float64Array,
  minPitch: number,
  maxPitch: number,
): number | null {
  const n = signal.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i]!;
  mean /= n;
  const centered = new Float64Array(n);
  for (let i = 0; i < n; i++) centered[i] = signal[i]! - mean;

  let bestLag = -1;
  let bestScore = -Infinity;
  const hi = Math.min(maxPitch, Math.floor(n / 2));
  for (let lag = minPitch; lag <= hi; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += centered[i]! * centered[i + lag]!;
    if (acc > bestScore) {
      bestScore = acc;
      bestLag = lag;
    }
  }
  return bestLag > 0 && bestScore > 0 ? bestLag : null;
}

/** Build uniform boundaries across [start,end] at the given pitch. */
function uniformBoundaries(start: number, end: number, pitch: number): number[] {
  const out: number[] = [];
  for (let p = start; p <= end + 0.5; p += pitch) out.push(Math.round(p));
  if (out.length === 0 || out[out.length - 1]! < end) out.push(end);
  return out;
}

/** Content bounding box on an axis: first/last index with signal above noise. */
function contentSpan(signal: Float64Array): [number, number] {
  const n = signal.length;
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, signal[i]!);
  const thr = max * 0.08;
  let lo = 0;
  while (lo < n && signal[lo]! <= thr) lo++;
  let hi = n - 1;
  while (hi > lo && signal[hi]! <= thr) hi--;
  return [lo, hi];
}

function axisBoundaries(
  lineProjection: Float64Array,
  contentProjection: Float64Array,
  length: number,
): number[] {
  // expect at least a few cells; minGap keeps us from splitting one line into many
  const minGap = Math.max(6, Math.floor(length / 300));
  const peaks = findPeaks(lineProjection, minGap);

  if (peaks.length >= 3) {
    // ensure the outer edges are represented
    const [lo, hi] = contentSpan(contentProjection);
    const bounds = [...peaks];
    if (bounds[0]! - lo > minGap * 2) bounds.unshift(lo);
    if (hi - bounds[bounds.length - 1]! > minGap * 2) bounds.push(hi);
    return bounds;
  }

  // fallback: estimate cell pitch from the content variation profile
  const [lo, hi] = contentSpan(contentProjection);
  const span = hi - lo;
  const pitch = estimatePitch(
    contentProjection.slice(lo, hi + 1),
    Math.max(6, Math.floor(length / 200)),
    Math.max(12, Math.floor(span / 3)),
  );
  if (pitch && pitch > 0) return uniformBoundaries(lo, hi, pitch);

  // last resort: assume a single cell spanning the content
  return [lo, hi];
}

// --- opencv-backed detection ---------------------------------------------

export async function detectGrid(img: LoadedImage): Promise<GridBoundaries> {
  const cv = await loadOpenCv();
  const { imageData, width, height } = img;

  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  const horiz = new cv.Mat();
  const vert = new cv.Mat();
  const grad = new cv.Mat();
  const gradX = new cv.Mat();
  const gradY = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // binary where features/lines are white
    cv.adaptiveThreshold(
      gray,
      binary,
      255,
      cv.ADAPTIVE_THRESH_MEAN_C,
      cv.THRESH_BINARY_INV,
      Math.max(11, (Math.floor(Math.min(width, height) / 40) | 1)),
      5,
    );

    // Horizontal line mask. The kernel must be long enough that only lines
    // spanning a large fraction of the image survive the morphological open —
    // otherwise a filled symbol's horizontal chord is mistaken for a grid line
    // and splits one real cell into several. A true grid line runs (nearly) the
    // full width; no symbol does.
    const hSize = Math.max(15, Math.floor(width * 0.33));
    const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(hSize, 1));
    cv.morphologyEx(binary, horiz, cv.MORPH_OPEN, hKernel);
    hKernel.delete();

    // vertical line mask (same reasoning, full-height lines only)
    const vSize = Math.max(15, Math.floor(height * 0.33));
    const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vSize));
    cv.morphologyEx(binary, vert, cv.MORPH_OPEN, vKernel);
    vKernel.delete();

    // gradient magnitude (for the gridless-pattern fallback projections)
    cv.Sobel(gray, gradX, cv.CV_32F, 1, 0, 3);
    cv.Sobel(gray, gradY, cv.CV_32F, 0, 1, 3);
    cv.magnitude(gradX, gradY, grad);

    const horizData = horiz.data; // Uint8 length w*h
    const vertData = vert.data;
    const gradData = grad.data32F; // Float32 length w*h

    // row line strength = sum of horizontal-mask across each row
    const rowLine = new Float64Array(height);
    const rowGrad = new Float64Array(height);
    // col line strength = sum of vertical-mask down each column
    const colLine = new Float64Array(width);
    const colGrad = new Float64Array(width);

    for (let y = 0; y < height; y++) {
      let rl = 0;
      let rg = 0;
      const rowOff = y * width;
      for (let x = 0; x < width; x++) {
        rl += horizData[rowOff + x]!;
        rg += gradData[rowOff + x]!;
      }
      rowLine[y] = rl;
      rowGrad[y] = rg;
    }
    for (let x = 0; x < width; x++) {
      let cl = 0;
      let cg = 0;
      for (let y = 0; y < height; y++) {
        const off = y * width + x;
        cl += vertData[off]!;
        cg += gradData[off]!;
      }
      colLine[x] = cl;
      colGrad[x] = cg;
    }

    const rowBoundaries = axisBoundaries(rowLine, rowGrad, height);
    const colBoundaries = axisBoundaries(colLine, colGrad, width);

    return { rowBoundaries, colBoundaries };
  } finally {
    src.delete();
    gray.delete();
    binary.delete();
    horiz.delete();
    vert.delete();
    grad.delete();
    gradX.delete();
    gradY.delete();
  }
}
