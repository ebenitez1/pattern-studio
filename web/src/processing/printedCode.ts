/** Detect printed code strokes, independently of the cell's fill colour.
 * This does not transcribe codes: optional OCR supplies readable labels.
 * Blank cells (including enclosed holes and coloured swatches) are untracked.
 */
export interface CodeRegion { x: number; y: number; w: number; h: number }

export function hasPrintedCode(
  data: Uint8ClampedArray, width: number, region: CodeRegion,
): boolean {
  const height = Math.floor(data.length / (width * 4));
  const x0 = Math.max(0, Math.ceil(region.x + region.w * 0.16));
  const y0 = Math.max(0, Math.ceil(region.y + region.h * 0.16));
  const x1 = Math.min(width, Math.floor(region.x + region.w * 0.84));
  const y1 = Math.min(height, Math.floor(region.y + region.h * 0.84));
  const w = x1 - x0, h = y1 - y0;
  if (w < 3 || h < 3) return false;
  const lums = new Float64Array(w * h);
  const bins = new Array<number>(16).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = ((y0 + y) * width + x0 + x) * 4;
    const lum = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
    lums[y * w + x] = lum;
    const bin = Math.min(15, Math.floor(lum / 16));
    bins[bin] = bins[bin]! + 1;
  }
  const mode = bins.indexOf(Math.max(...bins));
  let sum = 0, count = 0;
  for (const lum of lums) if (Math.floor(lum / 16) === mode) { sum += lum; count++; }
  const background = sum / count;
  // Light text on dark cells and dark text on light/coloured cells both qualify.
  // Dark codes on saturated fills (e.g. E13 purple) can differ by only 24–50
  // luminance levels. A high cutoff silently removes an entire colour. Keep
  // these strokes; the component geometry below rejects borders and shadows.
  const mask = Uint8Array.from(lums, lum => Math.abs(lum - background) >= 24 ? 1 : 0);
  let strokes = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    const stack = [i]; mask[i] = 2;
    let area = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    while (stack.length) {
      const p = stack.pop()!; const x = p % w, y = Math.floor(p / w);
      area++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (mask[n] === 1) { mask[n] = 2; stack.push(n); }
      }
    }
    const ch = maxY - minY + 1, cw = maxX - minX + 1;
    // Grid-line bleed, shadows and large checker squares are not printed codes.
    // Allow narrow digits (1) and clipped/truncated multi-character codes.
    if (area >= 2 && ch >= Math.max(2, region.h * 0.12) &&
        ch <= region.h * 0.5 && cw <= region.w * 0.8 &&
        (minY + maxY) / 2 >= h * 0.2 && (minY + maxY) / 2 <= h * 0.8 &&
        !(minY === 0 && maxY === h - 1)) strokes += area;
  }
  const fraction = strokes / lums.length;
  return strokes >= 2 && fraction >= 0.006 && fraction <= 0.45;
}
