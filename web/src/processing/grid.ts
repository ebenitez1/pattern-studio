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

/**
 * Fundamental period of a signal via autocorrelation. Returns the FIRST strong
 * autocorrelation peak (the fundamental), not the global max — otherwise a
 * harmonic (2×/3× the true cell pitch) can win and the grid comes out with 1/3
 * the columns. Raw (un-normalised) autocorrelation is used so the score decays
 * with lag, keeping the fundamental dominant over its harmonics.
 */
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

  const hi = Math.min(maxPitch, Math.floor(n / 2));
  if (hi <= minPitch) return null;

  const r = new Float64Array(hi + 1);
  let globalMax = 0;
  for (let lag = minPitch; lag <= hi; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += centered[i]! * centered[i + lag]!;
    r[lag] = acc;
    if (acc > globalMax) globalMax = acc;
  }
  if (globalMax <= 0) return null;

  // Skip the monotonic decay away from lag 0 (descend to the first local min)...
  let lag = minPitch;
  while (lag < hi && r[lag + 1]! < r[lag]!) lag++;
  // ...then return the first local maximum that is prominent (a real period),
  // which is the fundamental. Harmonics are later, weaker peaks.
  const prominence = globalMax * 0.5;
  for (; lag < hi; lag++) {
    if (
      r[lag]! >= prominence &&
      r[lag]! >= r[lag - 1]! &&
      r[lag]! >= r[lag + 1]!
    ) {
      return lag;
    }
  }
  // fallback: the global-max lag
  let bestLag = minPitch;
  let best = -Infinity;
  for (let l = minPitch; l <= hi; l++) {
    if (r[l]! > best) {
      best = r[l]!;
      bestLag = l;
    }
  }
  return bestLag;
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
): {
  boundaries: number[];
  extent: [number, number];
  pitch: number;
  teeth: number[];
  support: number[];
} | null {
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

  // full comb of teeth across the whole axis (trimmed later by fill content)
  const teeth: number[] = [];
  const support: number[] = [];
  for (let p = bestPhase; p <= length; p += pitch) {
    teeth.push(Math.round(p));
    support.push(sampleAt(p));
  }
  if (teeth.length < 3) return null;

  return {
    boundaries: teeth,
    extent: [teeth[0]!, teeth[teeth.length - 1]!],
    pitch,
    teeth,
    support: support.map((s) => Math.round(s)),
  };
}

/** Longest contiguous run of `true` in a boolean array → [start, end] indices. */
function longestTrueRun(a: boolean[]): [number, number] {
  let bs = 0;
  let be = -1;
  let i = 0;
  while (i < a.length) {
    if (!a[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < a.length && a[j + 1]) j++;
    if (j - i > be - bs) {
      bs = i;
      be = j;
    }
    i = j + 1;
  }
  return [bs, be < bs ? bs : be];
}

/**
 * Fraction of a cell's inset centre that is a real "bead" pixel: clearly
 * saturated (a colour) OR clearly dark. This excludes the light/desaturated
 * backgrounds — white, grey/white checkerboard, AND the pale colour tints some
 * charts use behind their axis-number labels (e.g. lavender) — so label bands
 * don't get mistaken for grid content.
 */
function cellBeadFraction(
  rgba: Uint8ClampedArray,
  imgW: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const ix0 = Math.floor(x0 + (x1 - x0) * 0.22);
  const iy0 = Math.floor(y0 + (y1 - y0) * 0.22);
  const ix1 = Math.ceil(x1 - (x1 - x0) * 0.22);
  const iy1 = Math.ceil(y1 - (y1 - y0) * 0.22);
  let bead = 0;
  let n = 0;
  for (let y = iy0; y < iy1; y++) {
    for (let x = ix0; x < ix1; x++) {
      const p = (y * imgW + x) * 4;
      const r = rgba[p]!;
      const g = rgba[p + 1]!;
      const b = rgba[p + 2]!;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (!(lum > 185 && sat < 30)) bead++;
      n++;
    }
  }
  return n === 0 ? 0 : bead / n;
}

function cellMeanRgb(
  rgba: Uint8ClampedArray,
  imgW: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number] {
  const ix0 = Math.floor(x0 + (x1 - x0) * 0.25);
  const iy0 = Math.floor(y0 + (y1 - y0) * 0.25);
  const ix1 = Math.ceil(x1 - (x1 - x0) * 0.25);
  const iy1 = Math.ceil(y1 - (y1 - y0) * 0.25);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = iy0; y < iy1; y++) {
    for (let x = ix0; x < ix1; x++) {
      const p = (y * imgW + x) * 4;
      r += rgba[p]!;
      g += rgba[p + 1]!;
      b += rgba[p + 2]!;
      n++;
    }
  }
  if (n === 0) return [0, 0, 0];
  return [r / n, g / n, b / n];
}

/** A line of cell colours is "uniform" if almost all cells cluster near one
 *  colour — the signature of an axis-number label band (all cells share one
 *  tint, with only the centred digit varying), unlike a real grid row which
 *  mixes bead colours and empty cells. */
function isUniformLine(colors: [number, number, number][]): boolean {
  if (colors.length < 4) return false;
  let cr = 0;
  let cg = 0;
  let cb = 0;
  for (const [r, g, b] of colors) {
    cr += r;
    cg += g;
    cb += b;
  }
  const n = colors.length;
  cr /= n;
  cg /= n;
  cb /= n;
  let within = 0;
  for (const [r, g, b] of colors) {
    const d = Math.sqrt((r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2);
    if (d < 40) within++;
  }
  return within / n >= 0.92;
}

function centroid(
  cells: [number, number, number][],
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of cells) {
    r += c[0];
    g += c[1];
    b += c[2];
  }
  const n = Math.max(1, cells.length);
  return [r / n, g / n, b / n];
}

/**
 * Strip outer rows/cols that are uniform-coloured axis-label bands (e.g.
 * periwinkle number strips). These look like beads pixel-for-pixel, so two
 * tests are required: the edge is (a) uniform in colour AND (b) that colour is
 * essentially absent from the grid interior. A real solid bead edge fails (b) —
 * its colour recurs inside — so it's kept. One strip per side (labels are a
 * single row/col).
 */
export function stripUniformEdges(
  colTeeth: number[],
  rowTeeth: number[],
  rgba: Uint8ClampedArray,
  imgW: number,
): { colTeeth: number[]; rowTeeth: number[] } {
  const nc = colTeeth.length - 1;
  const nr = rowTeeth.length - 1;
  if (nc < 6 || nr < 6) return { colTeeth, rowTeeth };

  const color: [number, number, number][][] = [];
  for (let r = 0; r < nr; r++) {
    color[r] = [];
    for (let c = 0; c < nc; c++) {
      color[r]![c] = cellMeanRgb(
        rgba,
        imgW,
        colTeeth[c]!,
        rowTeeth[r]!,
        colTeeth[c + 1]!,
        rowTeeth[r + 1]!,
      );
    }
  }

  // how many interior (non-border-ring) cells match a colour
  const interiorMatches = (col: [number, number, number]): number => {
    let cnt = 0;
    for (let r = 1; r < nr - 1; r++) {
      for (let c = 1; c < nc - 1; c++) {
        const cc = color[r]![c]!;
        const d = Math.sqrt(
          (cc[0] - col[0]) ** 2 + (cc[1] - col[1]) ** 2 + (cc[2] - col[2]) ** 2,
        );
        if (d < 22) cnt++;
      }
    }
    return cnt;
  };
  // A label band's tint is at most sparse in the interior (even if it happens
  // to equal a rare bead colour); a real solid bead edge's colour recurs
  // densely inside. Threshold on interior density, not an absolute count.
  const interiorTol = Math.max(3, Math.floor(0.025 * (nr - 2) * (nc - 2)));
  const isLabelBand = (cells: [number, number, number][]): boolean =>
    isUniformLine(cells) && interiorMatches(centroid(cells)) <= interiorTol;

  const topCells = color[0]!;
  const botCells = color[nr - 1]!;
  const leftCells = color.map((row) => row[0]!);
  const rightCells = color.map((row) => row[nc - 1]!);

  let ct = colTeeth.slice();
  let rt = rowTeeth.slice();
  if (isLabelBand(topCells)) rt = rt.slice(1);
  if (isLabelBand(botCells)) rt = rt.slice(0, -1);
  if (isLabelBand(leftCells)) ct = ct.slice(1);
  if (isLabelBand(rightCells)) ct = ct.slice(0, -1);
  return { colTeeth: ct, rowTeeth: rt };
}

/**
 * Trim two full combs to the grid's real extent: the largest contiguous block
 * of rows/cols that contain at least one bead cell. A bead cell is mostly
 * coloured-or-dark (any bead colour, including black/grey); empty checkerboard
 * cells and axis-number labels are light with at most a tiny digit, so they
 * don't count — which excludes the surrounding labels and the colour legend
 * while keeping interior empty cells.
 */
export function trimToBeadExtent(
  colTeeth: number[],
  rowTeeth: number[],
  rgba: Uint8ClampedArray,
  imgW: number,
): { colTeeth: number[]; rowTeeth: number[] } {
  const nc = colTeeth.length - 1;
  const nr = rowTeeth.length - 1;
  if (nc < 2 || nr < 2) return { colTeeth, rowTeeth };
  const rowHas = new Array<boolean>(nr).fill(false);
  const colHas = new Array<boolean>(nc).fill(false);
  // A bead cell is a solid colour (~90-100% of the inset). Axis-number label
  // cells are light with digits filling only ~20-35%, so 0.5 excludes them.
  const BEAD = 0.5;
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const f = cellBeadFraction(
        rgba,
        imgW,
        colTeeth[c]!,
        rowTeeth[r]!,
        colTeeth[c + 1]!,
        rowTeeth[r + 1]!,
      );
      if (f > BEAD) {
        rowHas[r] = true;
        colHas[c] = true;
      }
    }
  }
  const [cs, ce] = longestTrueRun(colHas);
  const [rs, re] = longestTrueRun(rowHas);
  return {
    colTeeth: colTeeth.slice(cs, ce + 2),
    rowTeeth: rowTeeth.slice(rs, re + 2),
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
        colScore[x] = colScore[x]! + Math.abs(dx[off]!);
        rs += Math.abs(dy[off]!);
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

    if (
      colResult &&
      rowResult &&
      colResult.teeth.length >= 3 &&
      rowResult.teeth.length >= 3
    ) {
      const trimmed = trimToBeadExtent(
        colResult.teeth,
        rowResult.teeth,
        rgba,
        width,
      );
      // strip uniform-coloured axis-label bands (e.g. periwinkle number strips)
      const stripped = stripUniformEdges(
        trimmed.colTeeth,
        trimmed.rowTeeth,
        rgba,
        width,
      );
      colBoundaries = stripped.colTeeth;
      rowBoundaries = stripped.rowTeeth;
    } else {
      usedFallback = true;
      colBoundaries = colResult?.teeth ?? fallbackAxis(colScore, colNonWhite, width);
      rowBoundaries = rowResult?.teeth ?? fallbackAxis(rowScore, rowNonWhite, height);
    }

    const debug: GridDebug = {
      width,
      height,
      pitchX: colResult?.pitch ?? null,
      pitchY: rowResult?.pitch ?? null,
      cols: colBoundaries.length - 1,
      rows: rowBoundaries.length - 1,
      colExtent: [colBoundaries[0]!, colBoundaries[colBoundaries.length - 1]!],
      rowExtent: [rowBoundaries[0]!, rowBoundaries[rowBoundaries.length - 1]!],
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
