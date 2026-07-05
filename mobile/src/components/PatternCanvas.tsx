/**
 * The core pattern viewer: one Skia <Canvas> that draws only the visible
 * window of the grid (plus overscan) into an SkPicture, with live pinch/pan
 * applied as a Skia Group transform driven by Reanimated shared values.
 *
 * Coordinate model:
 *   cellPx  = (canvasWidth / cols) * viewport.zoom * a11y.symbolScale
 *   screenX = viewport.offsetX + col * cellPx   (same for Y/rows)
 * i.e. zoom === 1 means "grid fits the canvas width".
 *
 * During a gesture the committed picture is transformed on the UI thread
 * (p' = S*p + T); on gesture end the transform is folded into the store
 * viewport (offset' = S*offset + T, zoom' = zoom*S) and the picture is
 * re-recorded. Store.setViewport also persists it (debounced autosave).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import {
  Canvas,
  Group,
  PaintStyle,
  Picture,
  Skia,
  createPicture,
  matchFont,
  type SkFont,
  type SkPaint,
} from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  runOnJS,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import {
  cellKey,
  cellRenderStateFast,
  colors,
  highlightColor,
  selectedIdSet,
  useProjectStore,
  type AccessibilityPrefs,
  type Viewport,
} from "@pattern-studio/core";
import { usePrefs } from "../prefs";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 100;
/** Cell size (px) above which the OCR glyph is drawn. */
const GLYPH_MIN_CELL_PX = 18;
/** Cell size (px) below which grid lines are skipped. */
const GRIDLINE_MIN_CELL_PX = 3;
/** Overscan around the visible window, as a fraction of the canvas size. */
const OVERSCAN = 0.5;

const FONT_FAMILY = Platform.select({
  ios: "Helvetica",
  default: "sans-serif",
});

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Perceived luminance of a #rrggbb color (0..255). */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return 128;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

interface SymbolRender {
  fill: SkPaint;
  glyph: string | null;
  glyphPaint: SkPaint;
}

function makeFillPaint(color: string): SkPaint {
  const p = Skia.Paint();
  p.setColor(Skia.Color(color));
  return p;
}

function makeStrokePaint(color: string, width: number): SkPaint {
  const p = Skia.Paint();
  p.setColor(Skia.Color(color));
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  return p;
}

export function PatternCanvas() {
  const project = useProjectStore((s) => s.project);
  const viewport = useProjectStore((s) => s.viewport);
  const filter = useProjectStore((s) => s.filter);
  const gridRevision = useProjectStore((s) => s.gridRevision);
  const setViewport = useProjectStore((s) => s.setViewport);
  const { a11y } = usePrefs();

  const [size, setSize] = useState({ w: 0, h: 0 });

  // ---- refs so gesture callbacks never see stale state --------------------
  const viewportRef = useRef<Viewport>(viewport);
  viewportRef.current = viewport;
  const a11yRef = useRef<AccessibilityPrefs>(a11y);
  a11yRef.current = a11y;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // ---- live gesture transform (UI thread) ---------------------------------
  const liveScale = useSharedValue(1);
  const liveTx = useSharedValue(0);
  const liveTy = useSharedValue(0);
  const activeGestures = useSharedValue(0);
  const committedZoom = useSharedValue(viewport.zoom);

  // Fold-in happened on the JS side: reset the live transform so the newly
  // recorded picture (which already includes it) is not transformed twice.
  useEffect(() => {
    committedZoom.value = viewport.zoom;
    liveScale.value = 1;
    liveTx.value = 0;
    liveTy.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  const transform = useDerivedValue(() => [
    { translateX: liveTx.value },
    { translateY: liveTy.value },
    { scale: liveScale.value },
  ]);

  // ---- commit / tap (JS thread) -------------------------------------------
  const commitTransform = useCallback(
    (s: number, tx: number, ty: number) => {
      const v = viewportRef.current;
      const { w, h } = sizeRef.current;
      const p = useProjectStore.getState().project;
      if (!p || w === 0) return;
      const zoom = clamp(v.zoom * s, MIN_ZOOM, MAX_ZOOM);
      const cellPx = (w / p.grid.cols) * zoom * a11yRef.current.symbolScale;
      const gridW = cellPx * p.grid.cols;
      const gridH = cellPx * p.grid.rows;
      // keep at least a quarter of the screen showing grid
      const offsetX = clamp(s * v.offsetX + tx, w * 0.25 - gridW, w * 0.75);
      const offsetY = clamp(s * v.offsetY + ty, h * 0.25 - gridH, h * 0.75);
      setViewport({ zoom, offsetX, offsetY });
    },
    [setViewport],
  );

  const handleTap = useCallback(
    (x: number, y: number) => {
      const store = useProjectStore.getState();
      const p = store.project;
      const v = viewportRef.current;
      const { w } = sizeRef.current;
      if (!p || w === 0) return;
      const cellPx = (w / p.grid.cols) * v.zoom * a11yRef.current.symbolScale;
      if (cellPx <= 0) return;
      const col = Math.floor((x - v.offsetX) / cellPx);
      const row = Math.floor((y - v.offsetY) / cellPx);
      if (row < 0 || row >= p.grid.rows || col < 0 || col >= p.grid.cols) return;
      store.cycleCell(row, col);
    },
    [],
  );

  // ---- gestures ------------------------------------------------------------
  const composedGesture = useMemo(() => {
    const onBegin = () => {
      "worklet";
      activeGestures.value += 1;
    };
    const onFinalize = () => {
      "worklet";
      activeGestures.value -= 1;
      if (
        activeGestures.value <= 0 &&
        (liveScale.value !== 1 || liveTx.value !== 0 || liveTy.value !== 0)
      ) {
        runOnJS(commitTransform)(liveScale.value, liveTx.value, liveTy.value);
      }
    };

    // Pinch: scale about the focal point, clamped against the committed zoom.
    const pinch = Gesture.Pinch()
      .onBegin(onBegin)
      .onChange((e) => {
        "worklet";
        const target = liveScale.value * e.scaleChange;
        const minS = MIN_ZOOM / Math.max(committedZoom.value, 1e-6);
        const maxS = MAX_ZOOM / Math.max(committedZoom.value, 1e-6);
        const next = clamp(target, minS, maxS);
        const f = next / liveScale.value;
        if (f !== 1) {
          // scale about focal F: T' = f*T + F*(1-f)
          liveTx.value = f * liveTx.value + e.focalX * (1 - f);
          liveTy.value = f * liveTy.value + e.focalY * (1 - f);
          liveScale.value = next;
        }
      })
      .onFinalize(onFinalize);

    // Pan: one-finger drag (two allowed so pinch+drag pans too). Incremental
    // changeX/changeY keeps this correct across mid-gesture commits.
    const pan = Gesture.Pan()
      .maxPointers(2)
      .onBegin(onBegin)
      .onChange((e) => {
        "worklet";
        liveTx.value += e.changeX;
        liveTy.value += e.changeY;
      })
      .onFinalize(onFinalize);

    // Tap: cycle the cell's status. Race so an activated pan/pinch wins.
    const tap = Gesture.Tap()
      .maxDuration(300)
      .onEnd((e, success) => {
        "worklet";
        if (success) runOnJS(handleTap)(e.x, e.y);
      });

    return Gesture.Race(Gesture.Simultaneous(pinch, pan), tap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitTransform, handleTap]);

  // ---- paints / fonts (few allocations; reused across records) -------------
  const symbolRender = useMemo(() => {
    const map = new Map<string, SymbolRender>();
    if (!project) return map;
    const lightGlyph = makeFillPaint("#ffffff");
    const darkGlyph = makeFillPaint("#111111");
    for (const s of project.grid.symbols) {
      const color = s.dominant_color ?? colors.surfaceRaised;
      map.set(s.id, {
        fill: makeFillPaint(color),
        glyph: s.ocr_text,
        glyphPaint: luminance(color) > 150 ? darkGlyph : lightGlyph,
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.grid.symbols]);

  const staticPaints = useMemo(() => {
    const hl = highlightColor(a11y);
    const hlFill = makeFillPaint(hl);
    hlFill.setAlphaf(0.3);
    return {
      completed: makeFillPaint(colors.statusCompleted),
      skipped: makeFillPaint(colors.statusSkipped),
      needsReview: makeStrokePaint(colors.statusNeedsReview, 2),
      dimmed: makeFillPaint(colors.dimmed),
      highlightFill: hlFill,
      highlightStroke: makeStrokePaint(hl, 2),
      gridLine: makeStrokePaint(
        a11y.highContrast ? "#8a93a6" : colors.gridLine,
        1,
      ),
      gridLineMajor: makeStrokePaint(
        a11y.highContrast ? "#c9d1e0" : colors.gridLineMajor,
        2,
      ),
    };
  }, [a11y]);

  const fontCache = useRef(new Map<number, SkFont>());
  const getFont = useCallback((sizePx: number): SkFont => {
    const key = Math.round(sizePx);
    let font = fontCache.current.get(key);
    if (!font) {
      font = matchFont({ fontFamily: FONT_FAMILY, fontSize: key });
      fontCache.current.set(key, font);
    }
    return font;
  }, []);

  // ---- picture: the memoized draw list --------------------------------------
  // Keyed on [gridRevision, viewport, filter, a11y] (+ project/canvas size):
  // gridRevision bumps on any progress/filter mutation in the store.
  const picture = useMemo(() => {
    if (!project || size.w === 0 || size.h === 0) return null;
    const { grid, progress } = project;
    const cellPx = (size.w / grid.cols) * viewport.zoom * a11y.symbolScale;
    if (cellPx <= 0) return null;
    const offX = viewport.offsetX;
    const offY = viewport.offsetY;
    const selected = selectedIdSet(filter);

    // visible cell window + overscan (so live panning reveals content)
    const mx = size.w * OVERSCAN;
    const my = size.h * OVERSCAN;
    const col0 = Math.max(0, Math.floor((-offX - mx) / cellPx));
    const col1 = Math.min(grid.cols - 1, Math.ceil((size.w + mx - offX) / cellPx));
    const row0 = Math.max(0, Math.floor((-offY - my) / cellPx));
    const row1 = Math.min(grid.rows - 1, Math.ceil((size.h + my - offY) / cellPx));
    if (col1 < col0 || row1 < row0) return null;

    const drawGlyphs = cellPx >= GLYPH_MIN_CELL_PX;
    const font = drawGlyphs ? getFont(cellPx * 0.58) : null;
    const glyphWidths = new Map<string, number>();
    const glyphBaseline = cellPx / 2 + cellPx * 0.58 * 0.36;

    const p = staticPaints;
    // one reusable host rect — no per-cell allocation
    const rect = Skia.XYWHRect(0, 0, cellPx, cellPx);
    const inset = Math.max(1, cellPx * 0.06);
    const insetRect = Skia.XYWHRect(0, 0, cellPx, cellPx);

    const cull = Skia.XYWHRect(-mx, -my, size.w + 2 * mx, size.h + 2 * my);

    return createPicture((canvas) => {
      // --- cells ---
      for (let r = row0; r <= row1; r++) {
        const y = offY + r * cellPx;
        const rowBase = r * grid.cols;
        for (let c = col0; c <= col1; c++) {
          const cell = grid.cells[rowBase + c];
          if (!cell) continue;
          const state = cellRenderStateFast(cell, filter, selected, progress);
          if (state === "hidden") continue;

          const x = offX + c * cellPx;
          rect.setXYWH(x, y, cellPx, cellPx);
          const sym = symbolRender.get(cell.symbol_id);

          // 1. base fill (dominant colour)
          if (sym) canvas.drawRect(rect, sym.fill);

          // 2. glyph when zoomed in enough
          if (drawGlyphs && sym?.glyph && font) {
            let gw = glyphWidths.get(cell.symbol_id);
            if (gw === undefined) {
              gw = font.measureText(sym.glyph).width;
              glyphWidths.set(cell.symbol_id, gw);
            }
            canvas.drawText(
              sym.glyph,
              x + (cellPx - gw) / 2,
              y + glyphBaseline,
              sym.glyphPaint,
              font,
            );
          }

          // 3. status overlay
          const status = progress[cellKey(r, c)]?.status;
          if (status === "completed") {
            canvas.drawRect(rect, p.completed);
          } else if (status === "skipped") {
            canvas.drawRect(rect, p.skipped);
          } else if (status === "needs_review") {
            insetRect.setXYWH(
              x + inset,
              y + inset,
              cellPx - 2 * inset,
              cellPx - 2 * inset,
            );
            canvas.drawRect(insetRect, p.needsReview);
          }

          // 4. filter overlay
          if (state === "dimmed") {
            canvas.drawRect(rect, p.dimmed);
          } else if (state === "highlighted") {
            canvas.drawRect(rect, p.highlightFill);
            insetRect.setXYWH(x + 1, y + 1, cellPx - 2, cellPx - 2);
            canvas.drawRect(insetRect, p.highlightStroke);
          }
        }
      }

      // --- grid lines (heavier every 10) ---
      if (cellPx >= GRIDLINE_MIN_CELL_PX) {
        const xStart = offX + col0 * cellPx;
        const xEnd = offX + (col1 + 1) * cellPx;
        const yStart = offY + row0 * cellPx;
        const yEnd = offY + (row1 + 1) * cellPx;
        for (let c = col0; c <= col1 + 1; c++) {
          const x = offX + c * cellPx;
          canvas.drawLine(
            x,
            yStart,
            x,
            yEnd,
            c % 10 === 0 ? p.gridLineMajor : p.gridLine,
          );
        }
        for (let r = row0; r <= row1 + 1; r++) {
          const y = offY + r * cellPx;
          canvas.drawLine(
            xStart,
            y,
            xEnd,
            y,
            r % 10 === 0 ? p.gridLineMajor : p.gridLine,
          );
        }
      }
    }, cull);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    project?.id,
    gridRevision,
    viewport,
    filter,
    a11y,
    size,
    symbolRender,
    staticPaints,
    getFont,
  ]);

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize({ w: width, h: height });
      }}
    >
      <GestureDetector gesture={composedGesture}>
        <Canvas style={styles.canvas}>
          <Group transform={transform}>
            {picture ? <Picture picture={picture} /> : null}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  canvas: {
    flex: 1,
  },
});
