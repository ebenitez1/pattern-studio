/**
 * Grid detection for real cross-stitch / Perler charts.
 *
 * Strategy (robust to filled cells, which broke the old "find long dark lines"
 * approach — rows of dark cells masquerade as grid lines):
 *   1. directional edge projections (|dx| per column, |dy| per row)
 *   2. autocorrelation → uniform cell pitch (charts are perfectly periodic)
 *   3. phase alignment → a comb of boundary positions
 *   4. trim the comb to the contiguous run with real edge support, which
 *      excludes the outside axis-number labels, the white margins and the
 *      colour legend below the grid
 *
 * Falls back to the old peak/pitch method if periodicity can't be found.
 */
import { loadOpenCv } from "./opencv";
import type { LoadedImage } from "./loadImage";

export interface GridBoundaries {
  rowBoundaries: number[]; // y pixel positions, ascending, length rows+1
  colBoundaries: number[]; // x pixel positions, ascending, length cols+1
}

/** Diagnostics for tuning; stashed on globalThis when detection runs. */
export interface GridDebug {
  width: number;
  height: number;
  pitchX: number | null;
  pitchY: number | null;
  cols: number;
  rows: number;
  colExtent: [number, number];
  rowExtent: [number, number];
  usedFallback: boolean;
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

/** Dominant period of a signal via autocorrelation. */
export function estimatePitch(
  signal: Float64Array,
  minPitch: number,
  maxPitch: number,
): number | null {
  const n = signal.length;
  if (n < minPitch * 2) return null;
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
    // normalise by overlap so long lags aren't penalised
    acc /= n - lag;
    if (acc > bestScore) {
      bestScore = acc;
      bestLag = lag;
    }
  }
  return bestLag > 0 && bestScore > 0 ? bestLag : null;
}

/** Content bounding span from a non-white-count projection (fallback path). */
export function contentSpanFromCounts(counts: Float64Array): [number, number] {
  const n = counts.length;
  if (n === 0) return [0, 0];
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, counts[i]!);
  const thr = Math.max(1, max * 0.06);
  let lo = 0;
  while (lo < n && counts[lo]! < thr) lo++;
  let hi = n - 1;
  while (hi > lo && counts[hi]! < thr) hi--;
  if (lo >= hi) return [0, n - 1];
  return [lo, hi];
}

function uniformBoundaries(start: number, end: number, pitch: number): number[] {
  const out: number[] = [];
  for (let p = start; p <= end + 0.5; p += pitch) out.push(Math.round(p));
  if (out.length === 0 || out[out.length - 1]! < end) out.push(end);
  return out;
}

/** Box-smooth a signal to stabilise autocorrelation/phase against noise. */
function smooth(signal: Float64Array, radius: number): Float64Array {
  if (radius <= 0) return signal;
  const n = signal.length;
  const out = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < Math.min(radius, n); i++) acc += signal[i]!;
  for (let i = 0; i < n; i++) {
    const add = i + radius;
    const sub = i - radius - 1;
    if (add < n) acc += signal[add]!;
    if (sub >= 0) acc -= signal[sub]!;
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n - 1, i + radius);
    out[i] = acc / (hi - lo + 1);
  }
  return out;
}

/**
 * Periodicity-based boundaries. Given a directional edge-strength projection,
 * find the uniform cell pitch, align a comb of boundaries to the edges, and
 * trim to the contiguous run with real support (dropping labels / legend /
 * margins). Returns null if no clear periodicity.
 */
export function combBoundaries(
  score: Float64Array,
  length: number,
): { boundaries: number[]; extent: [number, number]; pitch: number } | null {
  const sm = smooth(score, 1);
  const minPitch = Math.max(8, Math.floor(length / 200));
  const maxPitch = Math.max(minPitch + 2, Math.floor(length / 4));
  const pitch = estimatePitch(sm, minPitch, maxPitch);
  if (!pitch) return null;

  // best phase: comb sum over teeth, sampling a small window per tooth
  const sampleAt = (p: number): number => {
    const xi = Math.round(p);
    let m = 0;
    for (let d = -1; d <= 1; d++) {
      const j = xi + d;
      if (j >= 0 && j < length) m = Math.max(m, sm[j]!);
    }
    return m;
  };

  let bestPhase = 0;
  let bestSum = -1;
  for (let phase = 0; phase < pitch; phase++) {
    let sum = 0;
    for (let p = phase; p < length; p += pitch) sum += sampleAt(p);
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = phase;
    }
  }

  // teeth + their support
  const teeth: number[] = [];
  const support: number[] = [];
  for (let p = bestPhase; p <= length; p += pitch) {
    teeth.push(Math.round(p));
    support.push(sampleAt(p));
  }
  if (teeth.length < 3) return null;

  const sorted = [...support].sort((a, b) => a - b);
  const maxS = sorted[sorted.length - 1]!;
  const thr = maxS * 0.16;

  // longest contiguous run of supported teeth, bridging single weak gaps
  let bestStart = 0;
  let bestEnd = 0;
  let i = 0;
  while (i < teeth.length) {
    if (support[i]! < thr) {
      i++;
      continue;
    }
    let j = i;
    let gap = 0;
    let last = i;
    while (j + 1 < teeth.length) {
      if (support[j + 1]! >= thr) {
        j++;
        last = j;
        gap = 0;
      } else if (gap === 0 && j + 2 < teeth.length && support[j + 2]! >= thr) {
        // bridge a single weak interior tooth (same-colour neighbours)
        j += 2;
        last = j;
        gap = 0;
      } else {
        break;
      }
    }
    if (last - i > bestEnd - bestStart) {
      bestStart = i;
      bestEnd = last;
    }
    i = j + 1;
  }

  if (bestEnd - bestStart < 2) return null;
  const boundaries = teeth.slice(bestStart, bestEnd + 1);
  return {
    boundaries,
    extent: [boundaries[0]!, boundaries[boundaries.length - 1]!],
    pitch,
  };
}

// --- opencv-backed detection ---------------------------------------------

export async function detectGrid(img: LoadedImage): Promise<GridBoundaries> {
  const cv = await loadOpenCv();
  const { imageData, width, height } = img;

  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  const gradX = new cv.Mat();
  const gradY = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    // directional gradients: |dx| marks vertical edges, |dy| horizontal edges
    cv.Sobel(gray, gradX, cv.CV_32F, 1, 0, 3);
    cv.Sobel(gray, gradY, cv.CV_32F, 0, 1, 3);
    const dx = gradX.data32F;
    const dy = gradY.data32F;
    const rgba = imageData.data;

    const colScore = new Float64Array(width); // vertical-edge strength / column
    const rowScore = new Float64Array(height); // horizontal-edge strength / row
    const colNonWhite = new Float64Array(width);
    const rowNonWhite = new Float64Array(height);

    for (let y = 0; y < height; y++) {
      const rowOff = y * width;
      let rs = 0;
      let rw = 0;
      for (let x = 0; x < width; x++) {
        const off = rowOff + x;
        const ax = Math.abs(dx[off]!);
        const ay = Math.abs(dy[off]!);
        colScore[x] = colScore[x]! + ax;
        rs += ay;
        const p = off * 4;
        if (rgba[p]! < 235 || rgba[p + 1]! < 235 || rgba[p + 2]! < 235) {
          rw++;
          colNonWhite[x] = colNonWhite[x]! + 1;
        }
      }
      rowScore[y] = rs;
      rowNonWhite[y] = rw;
    }

    const colResult = combBoundaries(colScore, width);
    const rowResult = combBoundaries(rowScore, height);

    let colBoundaries: number[];
    let rowBoundaries: number[];
    let usedFallback = false;

    if (colResult && colResult.boundaries.length >= 3) {
      colBoundaries = colResult.boundaries;
    } else {
      usedFallback = true;
      colBoundaries = fallbackAxis(colScore, colNonWhite, width);
    }
    if (rowResult && rowResult.boundaries.length >= 3) {
      rowBoundaries = rowResult.boundaries;
    } else {
      usedFallback = true;
      rowBoundaries = fallbackAxis(rowScore, rowNonWhite, height);
    }

    const debug: GridDebug = {
      width,
      height,
      pitchX: colResult?.pitch ?? null,
      pitchY: rowResult?.pitch ?? null,
      cols: colBoundaries.length - 1,
      rows: rowBoundaries.length - 1,
      colExtent: colResult?.extent ?? [
        colBoundaries[0]!,
        colBoundaries[colBoundaries.length - 1]!,
      ],
      rowExtent: rowResult?.extent ?? [
        rowBoundaries[0]!,
        rowBoundaries[rowBoundaries.length - 1]!,
      ],
      usedFallback,
    };
    (globalThis as unknown as { __PS_GRID_DEBUG__?: GridDebug }).__PS_GRID_DEBUG__ =
      debug;

    return { rowBoundaries, colBoundaries };
  } finally {
    src.delete();
    gray.delete();
    gradX.delete();
    gradY.delete();
  }
}

/** Fallback when periodicity fails: crop to non-white span, uniform pitch. */
function fallbackAxis(
  score: Float64Array,
  nonWhite: Float64Array,
  length: number,
): number[] {
  const [lo, hi] = contentSpanFromCounts(nonWhite);
  const span = hi - lo;
  const pitch = estimatePitch(
    score.slice(lo, hi + 1),
    Math.max(6, Math.floor(length / 200)),
    Math.max(12, Math.floor(span / 3)),
  );
  if (pitch && pitch > 0) return uniformBoundaries(lo, hi, pitch);
  return [lo, hi];
}
