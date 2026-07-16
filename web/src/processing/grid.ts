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
  /** true when the ruled grid lines were detected and used directly */
  usedRuled?: boolean;
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

/** Best-phase average edge strength of a pitch-P comb — high when every tooth
 *  lands on a real grid line (P is the cell pitch or a multiple of it), low for
 *  a sub-cell pitch whose teeth fall between lines. Used to verify a candidate.
 *  Assumes the signal has been outlier-clipped (see estimatePitch), otherwise a
 *  sparse harmonic comb can cherry-pick a few very strong rows and win. */
function combAverage(signal: Float64Array, P: number): number {
  const n = signal.length;
  const sampleMax = (pos: number): number => {
    const xi = Math.round(pos);
    let m = 0;
    for (let dd = -1; dd <= 1; dd++) {
      const j = xi + dd;
      if (j >= 0 && j < n && signal[j]! > m) m = signal[j]!;
    }
    return m;
  };
  let best = 0;
  const phaseStep = P > 40 ? Math.ceil(P / 40) : 1;
  for (let phase = 0; phase < P; phase += phaseStep) {
    let s = 0;
    let cnt = 0;
    for (let pos = phase; pos < n; pos += P) {
      s += sampleMax(pos);
      cnt++;
    }
    if (cnt > 0) best = Math.max(best, s / cnt);
  }
  return best;
}

/** Average edge strength of a pitch-P comb at one specific phase. */
function combPhaseAverage(signal: Float64Array, P: number, phase: number): number {
  const n = signal.length;
  let s = 0;
  let cnt = 0;
  for (let pos = phase; pos < n; pos += P) {
    const xi = Math.round(pos);
    let m = 0;
    for (let dd = -1; dd <= 1; dd++) {
      const j = xi + dd;
      if (j >= 0 && j < n && signal[j]! > m) m = signal[j]!;
    }
    s += m;
    cnt++;
  }
  return cnt > 0 ? s / cnt : 0;
}

/**
 * Half-pitch artifact check. A checkerboard "no stitch" texture has sub-square
 * edges at exactly half the cell pitch, so the estimator can return pitch/2
 * with full comb support. Signature: at the halved pitch the teeth ALTERNATE
 * strong (real grid line) / weak (checker-only edge), whereas at a true pitch
 * every tooth is a real line. So: find the doubled comb's best phase; if the
 * opposite phase (best + pitch) is much weaker, the pitch was halved — double.
 */
function undoHalfPitch(
  signal: Float64Array,
  pitch: number,
  maxPitch: number,
): number {
  for (let iter = 0; iter < 2; iter++) {
    const dbl = pitch * 2;
    if (dbl > maxPitch) break;
    let best = -1;
    let bestPhase = 0;
    const step = Math.max(1, Math.round(pitch / 20));
    for (let ph = 0; ph < dbl; ph += step) {
      const s = combPhaseAverage(signal, dbl, ph);
      if (s > best) {
        best = s;
        bestPhase = ph;
      }
    }
    if (best <= 0) break;
    const other = combPhaseAverage(signal, dbl, (bestPhase + pitch) % dbl);
    // Measured on real charts: at a TRUE pitch the opposite phase also lands
    // on grid lines (ratio 0.86–0.99); at a checker-halved pitch it lands on
    // checker-only edges (ratio ~0.60). 0.72 sits centred in the gap.
    if (other < 0.72 * best) {
      pitch = dbl;
    } else {
      break;
    }
  }
  return pitch;
}

/**
 * Fundamental cell pitch. Autocorrelation gives a robust ballpark pitch L (the
 * first prominent peak), but on sparse fine grids it can lock onto a 2×/3×
 * harmonic (chunky result). So we then comb-verify sub-multiples of L: if L/2
 * or L/3 is still a valid pitch (its comb lands on real lines nearly as well as
 * L's), that finer value is the true fundamental. A genuine coarse chart fails
 * the check (a half-pitch comb falls between lines) and keeps L.
 */
export function estimatePitch(
  rawSignal: Float64Array,
  minPitch: number,
  maxPitch: number,
): number | null {
  const n = rawSignal.length;
  if (n < minPitch * 2) return null;

  // Clip extreme outliers first: bold header/legend/label rows tower over the
  // grid lines, dominate the autocorrelation, and let a sparse harmonic comb
  // cherry-pick them to out-average the true pitch. After clipping at the 95th
  // percentile no single row is worth more than a strong grid line.
  const sorted = Array.from(rawSignal).sort((a, b) => a - b);
  const cap = sorted[Math.floor(0.95 * (sorted.length - 1))]!;
  const signal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    signal[i] = cap > 0 ? Math.min(rawSignal[i]!, cap) : rawSignal[i]!;
  }

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

  // Candidate lags: every prominent autocorrelation local-max. The FIRST
  // prominent peak is not reliable — secondary edges (bead insets, printed
  // codes) put sidebands at pitch±d that can precede the true pitch — so all
  // prominent peaks compete and the comb decides which lands on real lines.
  const prominence = globalMax * 0.5;
  const candidates: number[] = [];
  for (let l = minPitch + 1; l < hi; l++) {
    if (r[l]! >= prominence && r[l]! >= r[l - 1]! && r[l]! >= r[l + 1]!) {
      candidates.push(l);
    }
  }
  if (candidates.length === 0) {
    let L = -1;
    for (let l = minPitch; l <= hi; l++) if (L < 0 || r[l]! > r[L]!) L = l;
    if (L < minPitch) return null;
    candidates.push(L);
  }

  // Reduce each candidate to its fundamental (comb-verified sub-multiples),
  // then score each fundamental by COMB ENERGY: best-phase sum of
  // (tooth strength - signal mean). Off-line teeth count NEGATIVE, so a
  // sideband pitch (most teeth on nothing) and a sparse harmonic (few teeth)
  // both lose to the true pitch (every tooth an above-mean line). Averages or
  // raw sums both fail here: an average lets a sparse comb cherry-pick a few
  // strong rows; a raw sum lets a fine comb pad itself with texture noise.
  const combEnergy = (P: number): number => {
    const sampleMax = (pos: number): number => {
      const xi = Math.round(pos);
      let m = 0;
      for (let dd = -1; dd <= 1; dd++) {
        const j = xi + dd;
        if (j >= 0 && j < n && signal[j]! > m) m = signal[j]!;
      }
      return m;
    };
    let best = -Infinity;
    const phaseStep = P > 40 ? Math.ceil(P / 40) : 1;
    for (let phase = 0; phase < P; phase += phaseStep) {
      let s = 0;
      for (let pos = phase; pos < n; pos += P) s += sampleMax(pos) - mean;
      if (s > best) best = s;
    }
    return best;
  };

  const scored: { fund: number; score: number }[] = [];
  const seenFunds = new Set<number>();
  for (const L of candidates) {
    let fund = L;
    const baseAvg = combAverage(signal, L);
    const kMax = Math.min(32, Math.floor(L / minPitch));
    for (let k = kMax; k >= 2; k--) {
      const sub = Math.round(L / k);
      if (sub >= minPitch && combAverage(signal, sub) >= 0.8 * baseAvg) {
        fund = sub;
        break;
      }
    }
    if (seenFunds.has(fund)) continue;
    seenFunds.add(fund);
    scored.push({ fund, score: combEnergy(fund) });
  }
  if (scored.length === 0) return null;

  let maxScore = -Infinity;
  for (const s of scored) if (s.score > maxScore) maxScore = s.score;
  // near-tie (a 2x harmonic collects the same lines): prefer the finer pitch
  let bestPitch = -1;
  for (const s of scored) {
    const nearTop =
      maxScore > 0 ? s.score >= 0.98 * maxScore : s.score >= maxScore;
    if (nearTop && (bestPitch < 0 || s.fund < bestPitch)) bestPitch = s.fund;
  }
  if (bestPitch < minPitch) return null;
  return undoHalfPitch(signal, bestPitch, hi);
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
  const smRaw = smooth(score, 1);
  // Clip extreme outliers (bold header/legend/label rows) BEFORE phase
  // selection too: an unclipped monster row 13px off the grid can drag the
  // comb's best phase onto a sideband, misaligning every boundary.
  const sortedSm = Array.from(smRaw).sort((a, b) => a - b);
  const smCap = sortedSm[Math.floor(0.95 * (sortedSm.length - 1))]!;
  const sm = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    sm[i] = smCap > 0 ? Math.min(smRaw[i]!, smCap) : smRaw[i]!;
  }
  // Cap resolution at ~130 cells/axis: excludes sub-cell texture (e.g. a fine
  // checkerboard background) on large scans, while small images still allow a
  // few-pixel cell pitch.
  const minPitch = Math.max(5, Math.floor(length / 130));
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

/**
 * Turn detected ruled-line positions into a full comb of cell boundaries.
 * Lines through dark regions are often invisible, so instead of requiring
 * every line we require CONSISTENCY: the modal gap between detected lines is
 * the pitch, the best-supported line anchors the phase, and the comb is laid
 * across the whole axis (later trimmed to the grid by bead/checker content).
 * Returns null when the peaks don't agree on a single pitch — no ruled grid.
 */
export function linesToBoundaries(
  peaks: number[],
  length: number,
): number[] | null {
  if (peaks.length < 5) return null;
  const sorted = [...peaks].sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i]! - sorted[i - 1]!;
    if (g >= 5 && g <= length / 4) gaps.push(g);
  }
  if (gaps.length < 4) return null;

  // modal gap = pitch (cluster within ±2px)
  let bestM = 0;
  let bestCnt = 0;
  for (const g of gaps) {
    let c = 0;
    for (const h of gaps) if (Math.abs(h - g) <= 2) c++;
    if (c > bestCnt) {
      bestCnt = c;
      bestM = g;
    }
  }
  // the modal gap must be a substantial mode — noise and missing lines dilute
  // it, so require a quarter of the gaps rather than a strict majority (the
  // asymmetric pitch cross-check downstream guards against false positives)
  if (bestCnt < Math.max(4, Math.ceil(gaps.length * 0.25))) return null;
  let sum = 0;
  let n = 0;
  for (const h of gaps) {
    if (Math.abs(h - bestM) <= 2) {
      sum += h;
      n++;
    }
  }
  const m = sum / n;

  // anchor = the line position most peaks agree with (p + k·m)
  const tol = Math.max(3, m * 0.15);
  let anchor = -1;
  let support = 0;
  for (const p of sorted) {
    let c = 0;
    for (const q of sorted) {
      const k = Math.round((q - p) / m);
      if (Math.abs(q - (p + k * m)) <= tol) c++;
    }
    if (c > support) {
      support = c;
      anchor = p;
    }
  }
  if (anchor < 0 || support < Math.max(5, sorted.length * 0.5)) return null;

  // Refine pitch + anchor by least squares over the matched lines — the modal
  // gap alone drifts by half a cell across a large grid, which would shear the
  // outer columns. Far-apart matched lines pin the pitch precisely.
  let mRef = m;
  let aRef = anchor;
  for (let iter = 0; iter < 2; iter++) {
    const ks: number[] = [];
    const qs: number[] = [];
    for (const q of sorted) {
      const k = Math.round((q - aRef) / mRef);
      if (Math.abs(q - (aRef + k * mRef)) <= tol) {
        ks.push(k);
        qs.push(q);
      }
    }
    if (ks.length < 5) break;
    const kMean = ks.reduce((a, b) => a + b, 0) / ks.length;
    const qMean = qs.reduce((a, b) => a + b, 0) / qs.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < ks.length; i++) {
      num += (ks[i]! - kMean) * (qs[i]! - qMean);
      den += (ks[i]! - kMean) ** 2;
    }
    if (den <= 0) break;
    mRef = num / den;
    aRef = qMean - kMean * mRef;
    if (mRef < 4) return null;
  }

  // full comb across the axis; content-based trims cut it to the grid later
  const start = aRef - Math.floor(aRef / mRef) * mRef;
  const out: number[] = [];
  for (let p = start; p <= length + 0.5; p += mRef) out.push(Math.round(p));
  const cells = out.length - 1;
  if (cells < 4 || cells > 250) return null;
  return out;
}

/**
 * Longest run of `true` in a boolean array, merging neighbouring runs across
 * gaps of up to `maxGap` when BOTH runs are substantial (≥ minSegment) — a
 * pattern legitimately has fully-empty rows/columns between its parts, which
 * must not cut the grid short; but a 1–2-line blob past a gap (a legend chip
 * row, a stray mark) must not get pulled in.
 */
function longestTrueRun(
  a: boolean[],
  maxGap = 2,
  minSegment = 3,
): [number, number] {
  // collect maximal contiguous runs
  const runs: [number, number][] = [];
  let i = 0;
  while (i < a.length) {
    if (!a[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < a.length && a[j + 1]) j++;
    runs.push([i, j]);
    i = j + 1;
  }
  if (runs.length === 0) return [0, 0];

  // merge adjacent substantial runs separated by small gaps
  const merged: [number, number][] = [runs[0]!];
  for (let k = 1; k < runs.length; k++) {
    const prev = merged[merged.length - 1]!;
    const cur = runs[k]!;
    const gap = cur[0] - prev[1] - 1;
    const prevLen = prev[1] - prev[0] + 1;
    const curLen = cur[1] - cur[0] + 1;
    if (gap <= maxGap && prevLen >= minSegment && curLen >= minSegment) {
      prev[1] = cur[1];
    } else {
      merged.push(cur);
    }
  }

  let best = merged[0]!;
  for (const r of merged) if (r[1] - r[0] > best[1] - best[0]) best = r;
  return best;
}

/**
 * Ensure a comb covers the full axis: a grid drawn flush against the image
 * edge can leave the first/last cell outside the detected teeth (e.g. phase 39
 * with pitch 40 orphans the whole first row). Prepend/append clamped teeth
 * when a near-full cell of space is uncovered.
 */
function extendComb(teeth: number[], length: number): number[] {
  if (teeth.length < 2) return teeth;
  const out = teeth.slice();
  const pitch =
    (out[out.length - 1]! - out[0]!) / Math.max(1, out.length - 1);
  if (out[0]! >= pitch * 0.6) out.unshift(Math.max(0, Math.round(out[0]! - pitch)));
  if (length - out[out.length - 1]! >= pitch * 0.6)
    out.push(Math.min(length, Math.round(out[out.length - 1]! + pitch)));
  return out;
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

/**
 * Is this cell a grey/white checkerboard "no stitch" marker? Checker cells are
 * entirely light and desaturated but mix two tones (luminance p10–p90 spread
 * ≥ 8). Axis-label cells fail on the dark digit ink (minLum), bead cells fail
 * on saturation/darkness, and plain white fails on spread. Only meaningful on
 * cells big enough for the inset to hold real texture (≥ 14px).
 */
function cellIsChecker(
  rgba: Uint8ClampedArray,
  imgW: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  if (x1 - x0 < 14 || y1 - y0 < 14) return false;
  const ix0 = Math.floor(x0 + (x1 - x0) * 0.22);
  const iy0 = Math.floor(y0 + (y1 - y0) * 0.22);
  const ix1 = Math.ceil(x1 - (x1 - x0) * 0.22);
  const iy1 = Math.ceil(y1 - (y1 - y0) * 0.22);
  const lums: number[] = [];
  for (let y = iy0; y < iy1; y++) {
    for (let x = ix0; x < ix1; x++) {
      const p = (y * imgW + x) * 4;
      const r = rgba[p]!;
      const g = rgba[p + 1]!;
      const b = rgba[p + 2]!;
      if (Math.max(r, g, b) - Math.min(r, g, b) >= 45) return false; // colour
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 150) return false; // ink / dark bead
      lums.push(lum);
    }
  }
  if (lums.length < 8) return false;
  lums.sort((a, b) => a - b);
  const spread =
    lums[Math.floor(lums.length * 0.9)]! - lums[Math.floor(lums.length * 0.1)]!;
  return spread >= 8;
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

  // a band that is mostly checkerboard "no stitch" cells is empty grid, not a
  // label strip — keep it so the grid retains its full printed size
  const checkerFrac = (
    coords: [number, number, number, number][],
  ): number => {
    let cnt = 0;
    for (const [x0, y0, x1, y1] of coords) {
      if (cellIsChecker(rgba, imgW, x0, y0, x1, y1)) cnt++;
    }
    return coords.length === 0 ? 0 : cnt / coords.length;
  };
  const rowCoords = (r: number): [number, number, number, number][] =>
    Array.from({ length: nc }, (_, c) => [
      colTeeth[c]!,
      rowTeeth[r]!,
      colTeeth[c + 1]!,
      rowTeeth[r + 1]!,
    ]);
  const colCoords = (c: number): [number, number, number, number][] =>
    Array.from({ length: nr }, (_, r) => [
      colTeeth[c]!,
      rowTeeth[r]!,
      colTeeth[c + 1]!,
      rowTeeth[r + 1]!,
    ]);

  const topCells = color[0]!;
  const botCells = color[nr - 1]!;
  const leftCells = color.map((row) => row[0]!);
  const rightCells = color.map((row) => row[nc - 1]!);

  let ct = colTeeth.slice();
  let rt = rowTeeth.slice();
  if (isLabelBand(topCells) && checkerFrac(rowCoords(0)) < 0.5)
    rt = rt.slice(1);
  if (isLabelBand(botCells) && checkerFrac(rowCoords(nr - 1)) < 0.5)
    rt = rt.slice(0, -1);
  if (isLabelBand(leftCells) && checkerFrac(colCoords(0)) < 0.5)
    ct = ct.slice(1);
  if (isLabelBand(rightCells) && checkerFrac(colCoords(nc - 1)) < 0.5)
    ct = ct.slice(0, -1);
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
  // Checkerboard "no stitch" cells also count as grid content so the grid
  // keeps its full printed size (e.g. 34×34) even when the border rows are
  // empty — they become untracked background later.
  const BEAD = 0.5;
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const x0 = colTeeth[c]!;
      const y0 = rowTeeth[r]!;
      const x1 = colTeeth[c + 1]!;
      const y1 = rowTeeth[r + 1]!;
      const isGrid =
        cellBeadFraction(rgba, imgW, x0, y0, x1, y1) > BEAD ||
        cellIsChecker(rgba, imgW, x0, y0, x1, y1);
      if (isGrid) {
        rowHas[r] = true;
        colHas[c] = true;
      }
    }
  }
  const [cs, ce] = longestTrueRun(colHas);
  const [rs, re] = longestTrueRun(rowHas);
  (globalThis as unknown as Record<string, unknown>).__PS_TRIM__ = {
    rowHas: rowHas.slice(),
    colHas: colHas.slice(),
    rowTeeth: rowTeeth.slice(),
    colTeeth: colTeeth.slice(),
    runs: { cols: [cs, ce], rows: [rs, re] },
  };
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
  const binary = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    // directional gradients: |dx| marks vertical edges, |dy| horizontal edges
    cv.Sobel(gray, gradX, cv.CV_32F, 1, 0, 3);
    cv.Sobel(gray, gradY, cv.CV_32F, 0, 1, 3);
    const dx = gradX.data32F;
    const dy = gradY.data32F;
    const rgba = imageData.data;

    // Ruled-grid pass. A short morphological open (longer than any printed
    // code cluster ~20-30px, shorter than a cell) erases text but keeps grid
    // lines — even lines broken by dark cells survive as multi-cell runs
    // across the lighter cells. Rows/columns with high surviving coverage are
    // the ruled lines.
    cv.adaptiveThreshold(
      gray,
      binary,
      255,
      cv.ADAPTIVE_THRESH_MEAN_C,
      cv.THRESH_BINARY_INV,
      Math.max(11, Math.floor(Math.min(width, height) / 40) | 1),
      5,
    );
    const openLen = Math.max(24, Math.floor(Math.min(width, height) * 0.03));
    const horizMask = new cv.Mat();
    const vertMask = new cv.Mat();
    const hK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(openLen, 1));
    cv.morphologyEx(binary, horizMask, cv.MORPH_OPEN, hK);
    hK.delete();
    const vK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, openLen));
    cv.morphologyEx(binary, vertMask, cv.MORPH_OPEN, vK);
    vK.delete();
    const hData = horizMask.data;
    const vData = vertMask.data;

    const colScore = new Float64Array(width); // vertical-edge strength / column
    const rowScore = new Float64Array(height); // horizontal-edge strength / row
    const colNonWhite = new Float64Array(width);
    const rowNonWhite = new Float64Array(height);
    const rowCover = new Float64Array(height); // opened-mask coverage per row
    const colCover = new Float64Array(width);

    for (let y = 0; y < height; y++) {
      const rowOff = y * width;
      let rs = 0;
      let rw = 0;
      let rc = 0;
      for (let x = 0; x < width; x++) {
        const off = rowOff + x;
        colScore[x] = colScore[x]! + Math.abs(dx[off]!);
        rs += Math.abs(dy[off]!);
        if (hData[off]! > 0) rc++;
        if (vData[off]! > 0) colCover[x] = colCover[x]! + 1;
        const p = off * 4;
        if (rgba[p]! < 235 || rgba[p + 1]! < 235 || rgba[p + 2]! < 235) {
          rw++;
          colNonWhite[x] = colNonWhite[x]! + 1;
        }
      }
      rowScore[y] = rs;
      rowNonWhite[y] = rw;
      rowCover[y] = rc;
    }
    horizMask.delete();
    vertMask.delete();

    // line positions = centroids of runs of high-coverage rows/columns
    const coverPeaks = (cover: Float64Array): number[] => {
      let max = 0;
      for (let i = 0; i < cover.length; i++) max = Math.max(max, cover[i]!);
      if (max <= 0) return [];
      const thr = max * 0.2;
      const peaks: number[] = [];
      let runStart = -1;
      for (let i = 0; i <= cover.length; i++) {
        const on = i < cover.length && cover[i]! >= thr;
        if (on && runStart < 0) runStart = i;
        if (!on && runStart >= 0) {
          peaks.push(Math.round((runStart + i - 1) / 2));
          runStart = -1;
        }
      }
      return peaks;
    };
    const rowPeaks = coverPeaks(rowCover);
    const colPeaks = coverPeaks(colCover);
    const ruledRows = linesToBoundaries(rowPeaks, height);
    const ruledCols = linesToBoundaries(colPeaks, width);

    // statistical pitch detection (proven on charts without heavy text)
    const colResult = combBoundaries(colScore, width);
    const rowResult = combBoundaries(rowScore, height);

    // Cross-check: dense printed text fools the statistical pitch toward a
    // SMALLER (sub-cell) value, never a larger one — so prefer the physical
    // ruled lines only when they say the cells are significantly bigger than
    // the statistics claim. If the line detector itself caught text (smaller
    // pitch than statistics), keep the statistics.
    const medGap = (b: number[]): number => {
      const gaps = b.slice(1).map((v, i) => v - b[i]!);
      return gaps.sort((a, z) => a - z)[Math.floor(gaps.length / 2)]!;
    };
    const ruledOk = !!(ruledRows && ruledCols);
    let preferRuled = false;
    if (ruledOk) {
      const rpx = medGap(ruledCols!);
      const rpy = medGap(ruledRows!);
      const cpx = colResult?.pitch ?? null;
      const cpy = rowResult?.pitch ?? null;
      preferRuled =
        cpx === null ||
        cpy === null ||
        cpx < 0.75 * rpx ||
        cpy < 0.75 * rpy;
    }

    let colBoundaries: number[];
    let rowBoundaries: number[];
    let usedFallback = false;
    let usedRuled = false;

    if (preferRuled) {
      usedRuled = true;
      const trimmed = trimToBeadExtent(
        extendComb(ruledCols!, width),
        extendComb(ruledRows!, height),
        rgba,
        width,
      );
      const stripped = stripUniformEdges(
        trimmed.colTeeth,
        trimmed.rowTeeth,
        rgba,
        width,
      );
      colBoundaries = stripped.colTeeth;
      rowBoundaries = stripped.rowTeeth;
    } else if (
      colResult &&
      rowResult &&
      colResult.teeth.length >= 3 &&
      rowResult.teeth.length >= 3
    ) {
      // Re-anchor the statistical comb's PHASE on the physical line-coverage
      // signal: dense printed codes put strong edges a fixed offset from every
      // line (a sideband), and the edge-projection comb can lock onto that
      // offset, misaligning every boundary. The morph-opened coverage signal
      // has text erased, so real lines dominate it. Keep the comb's pitch;
      // shift its phase only when the coverage clearly prefers another one.
      const rephase = (
        teeth: number[],
        pitch: number,
        cover: Float64Array,
        length: number,
      ): number[] => {
        if (teeth.length < 3 || pitch < 4) return teeth;
        const winMax = (pos: number): number => {
          const xi = Math.round(pos);
          let m = 0;
          for (let dd = -2; dd <= 2; dd++) {
            const j = xi + dd;
            if (j >= 0 && j < cover.length && cover[j]! > m) m = cover[j]!;
          }
          return m;
        };
        const phaseSum = (ph: number): number => {
          let s = 0;
          for (let p = ph; p < length; p += pitch) s += winMax(p);
          return s;
        };
        let bestPh = 0;
        let bestS = -1;
        for (let ph = 0; ph < pitch; ph++) {
          const s = phaseSum(ph);
          if (s > bestS) {
            bestS = s;
            bestPh = ph;
          }
        }
        const curPh = ((teeth[0]! % pitch) + pitch) % pitch;
        if (bestPh === curPh) return teeth;
        // only override when the coverage decisively prefers the new phase —
        // on charts with weak/no ruled lines the coverage is noise, and the
        // comb's own phase must stand
        if (bestS < 1.3 * phaseSum(curPh)) return teeth;
        const out: number[] = [];
        for (let p = bestPh; p <= length + 0.5; p += pitch) {
          out.push(Math.round(p));
        }
        return out.length >= 3 ? out : teeth;
      };
      const trimmed = trimToBeadExtent(
        extendComb(
          rephase(colResult.teeth, colResult.pitch, colCover, width),
          width,
        ),
        extendComb(
          rephase(rowResult.teeth, rowResult.pitch, rowCover, height),
          height,
        ),
        rgba,
        width,
      );
      // strip uniform-coloured axis-label bands (e.g. periwinkle strips)
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
      colBoundaries =
        colResult?.teeth ?? fallbackAxis(colScore, colNonWhite, width);
      rowBoundaries =
        rowResult?.teeth ?? fallbackAxis(rowScore, rowNonWhite, height);
    }

    const medianGap = (b: number[]): number | null => {
      if (b.length < 2) return null;
      const gaps = b.slice(1).map((v, i) => v - b[i]!);
      return gaps.sort((a, z) => a - z)[Math.floor(gaps.length / 2)]!;
    };
    const debug: GridDebug = {
      width,
      height,
      pitchX: medianGap(colBoundaries),
      pitchY: medianGap(rowBoundaries),
      cols: colBoundaries.length - 1,
      rows: rowBoundaries.length - 1,
      colExtent: [colBoundaries[0]!, colBoundaries[colBoundaries.length - 1]!],
      rowExtent: [rowBoundaries[0]!, rowBoundaries[rowBoundaries.length - 1]!],
      usedFallback,
      usedRuled,
    };
    (globalThis as unknown as { __PS_GRID_DEBUG__?: GridDebug }).__PS_GRID_DEBUG__ =
      debug;
    (globalThis as unknown as Record<string, unknown>).__PS_GRID_SIGNALS__ = {
      colScore: Array.from(colScore),
      rowScore: Array.from(rowScore),
      colCover: Array.from(colCover),
      rowCover: Array.from(rowCover),
    };

    return { rowBoundaries, colBoundaries };
  } finally {
    src.delete();
    gray.delete();
    gradX.delete();
    gradY.delete();
    binary.delete();
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
