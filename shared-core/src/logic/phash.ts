/**
 * Perceptual hashing + symbol clustering — pure TypeScript, no DOM/WASM.
 *
 * Mirrors the backend's ImageHash-based approach so the browser pipeline
 * groups cells into symbols the same way the FastAPI server does. Kept in
 * shared-core because it's platform-agnostic (web uses it now; a future native
 * mobile pipeline can reuse it).
 *
 * A pHash here is a 64-bit value expressed as a 64-char "0"/"1" string so it
 * needs no BigInt and hamming distance is a trivial char compare.
 */

export type PerceptualHash = string; // length 64, chars '0'|'1'

const HASH_SIZE = 8; // 8x8 low-frequency block → 64 bits
const DCT_SIZE = 32; // work on a 32x32 reduced image, like the backend's resize

/** 1-D DCT-II coefficient cache, keyed by N. */
const dctCache = new Map<number, Float64Array>();

function dctMatrix(n: number): Float64Array {
  const cached = dctCache.get(n);
  if (cached) return cached;
  const m = new Float64Array(n * n);
  const c0 = Math.sqrt(1 / n);
  const c = Math.sqrt(2 / n);
  for (let k = 0; k < n; k++) {
    const coeff = k === 0 ? c0 : c;
    for (let i = 0; i < n; i++) {
      m[k * n + i] = coeff * Math.cos(((2 * i + 1) * k * Math.PI) / (2 * n));
    }
  }
  dctCache.set(n, m);
  return m;
}

/** 2-D DCT of a square NxN matrix (row transform then column transform). */
function dct2d(input: Float64Array, n: number): Float64Array {
  const m = dctMatrix(n);
  const tmp = new Float64Array(n * n);
  // rows
  for (let y = 0; y < n; y++) {
    for (let k = 0; k < n; k++) {
      let sum = 0;
      for (let x = 0; x < n; x++) sum += m[k * n + x]! * input[y * n + x]!;
      tmp[y * n + k] = sum;
    }
  }
  // columns
  const out = new Float64Array(n * n);
  for (let x = 0; x < n; x++) {
    for (let k = 0; k < n; k++) {
      let sum = 0;
      for (let y = 0; y < n; y++) sum += m[k * n + y]! * tmp[y * n + x]!;
      out[k * n + x] = sum;
    }
  }
  return out;
}

/**
 * Compute a DCT-based perceptual hash from a grayscale buffer.
 * @param gray  row-major grayscale values (0..255), length w*h
 * The buffer is nearest-neighbour resampled to 32x32 first.
 */
export function perceptualHash(
  gray: ArrayLike<number>,
  w: number,
  h: number,
): PerceptualHash {
  // resample to DCT_SIZE x DCT_SIZE
  const reduced = new Float64Array(DCT_SIZE * DCT_SIZE);
  for (let y = 0; y < DCT_SIZE; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / DCT_SIZE));
    for (let x = 0; x < DCT_SIZE; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / DCT_SIZE));
      reduced[y * DCT_SIZE + x] = gray[sy * w + sx]!;
    }
  }

  const coeffs = dct2d(reduced, DCT_SIZE);

  // take the top-left HASH_SIZE x HASH_SIZE low-frequency block, excluding the
  // DC term (0,0) from the median so a flat block doesn't skew the threshold.
  const block: number[] = [];
  for (let y = 0; y < HASH_SIZE; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      block.push(coeffs[y * DCT_SIZE + x]!);
    }
  }
  const sorted = block.slice(1).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;

  let bits = "";
  for (let i = 0; i < block.length; i++) {
    bits += block[i]! > median ? "1" : "0";
  }
  return bits;
}

/** Hamming distance between two 64-char hash strings. */
export function hammingDistance(a: PerceptualHash, b: PerceptualHash): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d + Math.abs(a.length - b.length);
}

export interface HashedCell {
  row: number;
  col: number;
  hash: PerceptualHash;
  /** mean colour of the cell centre, #rrggbb (used for the symbol swatch) */
  color: string;
}

export interface ClusterResult {
  /** symbol id per input cell, index-aligned with the input array */
  symbolIdByCell: string[];
  /** representative cell index for each symbol id */
  representativeCellIndex: Record<string, number>;
  /** cell count per symbol id */
  counts: Record<string, number>;
  /** per-cell hamming distance to its cluster representative (→ confidence) */
  distanceByCell: number[];
}

interface Cluster {
  repHash: PerceptualHash;
  repIndex: number;
  repRgb: [number, number, number];
  members: number[];
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** Euclidean RGB distance (0..~441). */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * Greedy representative-list clustering. A cell joins the first cluster whose
 * representative is within BOTH `hashThreshold` (shape) and `colorThreshold`
 * (colour) — so cells are the same symbol only when shape and colour agree.
 * This distinguishes colour-coded patterns (same cell shape, different colour)
 * as well as glyph-coded patterns (same background, different shape). Symbol
 * ids are assigned "s1", "s2", ... ordered by count desc.
 *
 * @param hashThreshold  max hamming distance for the shape hash (default 10)
 * @param colorThreshold max RGB distance to be the same colour (default 45)
 */
export function clusterCells(
  cells: HashedCell[],
  hashThreshold = 10,
  colorThreshold = 45,
): ClusterResult {
  const clusters: Cluster[] = [];
  const clusterOfCell: number[] = new Array(cells.length);
  const distanceOfCell: number[] = new Array(cells.length).fill(0);

  for (let i = 0; i < cells.length; i++) {
    const hash = cells[i]!.hash;
    const rgb = hexToRgb(cells[i]!.color);
    let best = -1;
    let bestDist = Infinity;
    for (let c = 0; c < clusters.length; c++) {
      const d = hammingDistance(hash, clusters[c]!.repHash);
      if (d > hashThreshold) continue;
      const [r, g, b] = clusters[c]!.repRgb;
      const cd = Math.sqrt(
        (rgb[0] - r) ** 2 + (rgb[1] - g) ** 2 + (rgb[2] - b) ** 2,
      );
      if (cd > colorThreshold) continue;
      // rank by combined closeness so the nearest matching cluster wins
      const score = d + cd / 8;
      if (score < bestDist) {
        bestDist = score;
        best = c;
      }
    }
    if (best === -1) {
      clusters.push({
        repHash: hash,
        repIndex: i,
        repRgb: rgb,
        members: [i],
      });
      clusterOfCell[i] = clusters.length - 1;
      distanceOfCell[i] = 0;
    } else {
      clusters[best]!.members.push(i);
      clusterOfCell[i] = best;
      distanceOfCell[i] = hammingDistance(hash, clusters[best]!.repHash);
    }
  }

  // order clusters by member count desc → stable symbol ids
  const order = clusters
    .map((_, idx) => idx)
    .sort((a, b) => clusters[b]!.members.length - clusters[a]!.members.length);

  const symbolIdByCluster: Record<number, string> = {};
  const representativeCellIndex: Record<string, number> = {};
  const counts: Record<string, number> = {};
  order.forEach((clusterIdx, rank) => {
    const id = `s${rank + 1}`;
    symbolIdByCluster[clusterIdx] = id;
    representativeCellIndex[id] = clusters[clusterIdx]!.repIndex;
    counts[id] = clusters[clusterIdx]!.members.length;
  });

  const symbolIdByCell = clusterOfCell.map((c) => symbolIdByCluster[c]!);

  return {
    symbolIdByCell,
    representativeCellIndex,
    counts,
    distanceByCell: distanceOfCell,
  };
}

/** Convert a cluster hamming distance to a 0..1 confidence, matching backend. */
export function distanceToConfidence(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance / 64));
}
