/**
 * The pattern viewer. ONE <canvas>; renders only the cells intersecting the
 * visible viewport so 150x150+ grids stay smooth. Redraws are coalesced into
 * a single requestAnimationFrame per burst of store changes.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BACKGROUND_SYMBOL_ID,
  cellRenderStateFast,
  cellKey,
  colors,
  hiddenIdSet,
  highlightColor,
  selectedIdSet,
  useProjectStore,
  type GridCell,
  type PatternSymbol,
} from "@pattern-studio/core";
import { useA11y } from "../a11y";

const BASE_CELL = 24; // world px per cell at zoom 1
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 24;
const GLYPH_MIN_PX = 18; // cell screen size at which glyphs appear
const CLICK_SLOP_PX = 5;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Relative luminance (0..1) of a #rrggbb colour, for glyph contrast. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m || !m[1]) return 0;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

interface PointerPos {
  x: number;
  y: number;
}

export function PatternCanvas() {
  const { prefs } = useA11y();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef({ width: 0, height: 0 });

  // decoded symbol thumbnails, keyed by symbol id
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());

  // ---- drawing ------------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const state = useProjectStore.getState();
    const project = state.project;
    const viewport = state.viewport;
    const filter = state.filter;
    const a11y = prefsRef.current;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    if (!project) return;
    const grid = project.grid;
    const progress = project.progress;
    const selIds = selectedIdSet(filter);
    const hidIds = hiddenIdSet(filter);
    const hilite = highlightColor(a11y);

    const cellPx = BASE_CELL * viewport.zoom;
    const ox = viewport.offsetX;
    const oy = viewport.offsetY;

    // visible cell range — the key to large-grid performance
    const c0 = Math.max(0, Math.floor(-ox / cellPx));
    const r0 = Math.max(0, Math.floor(-oy / cellPx));
    const c1 = Math.min(grid.cols - 1, Math.ceil((width - ox) / cellPx));
    const r1 = Math.min(grid.rows - 1, Math.ceil((height - oy) / cellPx));
    if (c1 < c0 || r1 < r0) return;

    const symbolById = new Map<string, PatternSymbol>();
    for (const s of grid.symbols) symbolById.set(s.id, s);

    const drawGlyphs = cellPx >= GLYPH_MIN_PX;
    const glyphFontPx = Math.max(
      8,
      cellPx * 0.5 * Math.min(a11y.symbolScale, cellPx > 0 ? 2 : 1),
    );
    if (drawGlyphs) {
      ctx.font = `${glyphFontPx}px ${
        "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
      }`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    }

    const cache = imageCacheRef.current;

    for (let r = r0; r <= r1; r++) {
      const rowBase = r * grid.cols;
      const y = oy + r * cellPx;
      for (let c = c0; c <= c1; c++) {
        const cell: GridCell | undefined = grid.cells[rowBase + c];
        if (!cell) continue;
        // Empty/background cells draw as light canvas — matching the source
        // chart's white background — rather than vanishing into the dark
        // workspace. They stay untracked and unclickable.
        if (cell.symbol_id === BACKGROUND_SYMBOL_ID) {
          ctx.fillStyle = "#f0f0f0";
          ctx.fillRect(ox + c * cellPx, oy + r * cellPx, cellPx, cellPx);
          continue;
        }

        const renderState = cellRenderStateFast(
          cell,
          filter,
          selIds,
          progress,
          hidIds,
        );
        if (renderState === "hidden") {
          // hidden colours / hidden-completed cells show as empty canvas
          ctx.fillStyle = "#f0f0f0";
          ctx.fillRect(ox + c * cellPx, oy + r * cellPx, cellPx, cellPx);
          continue;
        }

        const x = ox + c * cellPx;
        const symbol = symbolById.get(cell.symbol_id);
        const baseColor = symbol?.dominant_color ?? colors.surfaceRaised;

        // Completed cells are drawn at 20% opacity — faded but still visible,
        // so the user can see at a glance which tiles are done.
        const status = progress[cellKey(cell.row, cell.col)]?.status;
        const cellAlpha = status === "completed" ? 0.2 : 1;
        ctx.globalAlpha = cellAlpha;

        // base fill
        ctx.fillStyle = baseColor;
        ctx.fillRect(x, y, cellPx, cellPx);

        if (renderState === "dimmed") {
          // desaturate: token gray carries its own alpha
          ctx.fillStyle = colors.dimmed;
          ctx.fillRect(x, y, cellPx, cellPx);
          ctx.fillStyle = "#00000066";
          ctx.fillRect(x, y, cellPx, cellPx);
        } else if (renderState === "highlighted") {
          ctx.globalAlpha = 0.45 * cellAlpha;
          ctx.fillStyle = hilite;
          ctx.fillRect(x, y, cellPx, cellPx);
          ctx.globalAlpha = cellAlpha;
          if (cellPx >= 6) {
            ctx.strokeStyle = hilite;
            ctx.lineWidth = Math.max(1, cellPx * 0.08);
            ctx.strokeRect(x + 0.5, y + 0.5, cellPx - 1, cellPx - 1);
          }
        }

        // remaining status overlays — must stay distinguishable at tiny zoom
        if (status === "skipped") {
          ctx.fillStyle = colors.statusSkipped;
          ctx.fillRect(x, y, cellPx, cellPx);
        } else if (status === "needs_review") {
          const lw = Math.max(1.5, cellPx * 0.14);
          ctx.strokeStyle = colors.statusNeedsReview;
          ctx.lineWidth = lw;
          ctx.strokeRect(x + lw / 2, y + lw / 2, cellPx - lw, cellPx - lw);
        }

        // symbol glyph, only when zoomed in enough & not obscured
        if (drawGlyphs && symbol && renderState !== "dimmed") {
          if (symbol.ocr_text) {
            ctx.fillStyle = luminance(baseColor) > 0.55 ? "#000000" : "#ffffff";
            ctx.fillText(
              symbol.ocr_text.charAt(0),
              x + cellPx / 2,
              y + cellPx / 2,
              cellPx,
            );
          } else if (symbol.thumbnail) {
            let img = cache.get(symbol.id);
            if (!img) {
              img = new Image();
              img.decoding = "async";
              img.onload = () => requestDraw();
              img.src = symbol.thumbnail;
              cache.set(symbol.id, img);
            }
            if (img.complete && img.naturalWidth > 0) {
              const pad = cellPx * 0.15;
              ctx.drawImage(img, x + pad, y + pad, cellPx - pad * 2, cellPx - pad * 2);
            }
            // else: colour-only fallback while the image decodes
          }
        }

        // completed check mark, drawn at full opacity over the faded tile
        if (status === "completed" && cellPx >= 12) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "#66bb6a";
          ctx.lineWidth = Math.max(1.5, cellPx * 0.1);
          ctx.beginPath();
          ctx.moveTo(x + cellPx * 0.22, y + cellPx * 0.55);
          ctx.lineTo(x + cellPx * 0.42, y + cellPx * 0.75);
          ctx.lineTo(x + cellPx * 0.78, y + cellPx * 0.28);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1; // don't let a trailing faded cell dim the grid lines

    // grid lines (heavier every 10 cells); high contrast strengthens them
    const minorColor = a11y.highContrast ? colors.gridLineMajor : colors.gridLine;
    const majorColor = a11y.highContrast ? "#aab3c5" : colors.gridLineMajor;
    const gx0 = ox + c0 * cellPx;
    const gy0 = oy + r0 * cellPx;
    const gx1 = ox + (c1 + 1) * cellPx;
    const gy1 = oy + (r1 + 1) * cellPx;

    const drawMinor = cellPx >= 5;
    // minor lines
    if (drawMinor) {
      ctx.strokeStyle = minorColor;
      ctx.lineWidth = a11y.highContrast ? 1.25 : 1;
      ctx.beginPath();
      for (let c = c0; c <= c1 + 1; c++) {
        if (c % 10 === 0) continue;
        const x = ox + c * cellPx;
        ctx.moveTo(x, gy0);
        ctx.lineTo(x, gy1);
      }
      for (let r = r0; r <= r1 + 1; r++) {
        if (r % 10 === 0) continue;
        const y = oy + r * cellPx;
        ctx.moveTo(gx0, y);
        ctx.lineTo(gx1, y);
      }
      ctx.stroke();
    }
    // major lines every 10 cells
    ctx.strokeStyle = majorColor;
    ctx.lineWidth = a11y.highContrast ? 2.5 : 2;
    ctx.beginPath();
    for (let c = Math.ceil(c0 / 10) * 10; c <= c1 + 1; c += 10) {
      const x = ox + c * cellPx;
      ctx.moveTo(x, gy0);
      ctx.lineTo(x, gy1);
    }
    for (let r = Math.ceil(r0 / 10) * 10; r <= r1 + 1; r += 10) {
      const y = oy + r * cellPx;
      ctx.moveTo(gx0, y);
      ctx.lineTo(gx1, y);
    }
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rAF coalescing: many store changes per frame → one redraw
  const requestDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);

  // ---- canvas sizing (devicePixelRatio aware) ------------------------------

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      requestDraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [requestDraw]);

  // redraw on any relevant store change
  useEffect(() => {
    const unsub = useProjectStore.subscribe(
      (s) => [s.gridRevision, s.viewport, s.filter, s.project] as const,
      () => requestDraw(),
      { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] },
    );
    return () => {
      unsub();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [requestDraw]);

  // redraw when a11y prefs change (highlight colour / contrast / scale)
  useEffect(() => {
    requestDraw();
  }, [prefs, requestDraw]);

  // fit-to-screen for freshly created projects (viewport still at default)
  const projectId = useProjectStore((s) => s.project?.id ?? null);
  useEffect(() => {
    if (!projectId) return;
    const s = useProjectStore.getState();
    const p = s.project;
    if (!p) return;
    const v = s.viewport;
    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;
    if (v.zoom === 1 && v.offsetX === 0 && v.offsetY === 0) {
      const worldW = p.grid.cols * BASE_CELL;
      const worldH = p.grid.rows * BASE_CELL;
      const zoom = clampZoom(Math.min(width / worldW, height / worldH) * 0.95);
      s.setViewport({
        zoom,
        offsetX: (width - worldW * zoom) / 2,
        offsetY: (height - worldH * zoom) / 2,
      });
    }
    requestDraw();
  }, [projectId, requestDraw]);

  // clear image cache when switching projects
  useEffect(() => {
    imageCacheRef.current = new Map();
  }, [projectId]);

  // ---- interactions --------------------------------------------------------

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    const s = useProjectStore.getState();
    const v = s.viewport;
    const zoom = clampZoom(v.zoom * factor);
    const k = zoom / v.zoom;
    if (k === 1) return;
    s.setViewport({
      zoom,
      offsetX: cx - (cx - v.offsetX) * k,
      offsetY: cy - (cy - v.offsetY) * k,
    });
  }, []);

  // wheel zoom centred on cursor (native listener: needs passive:false)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // pointer state: pan, click-to-cycle, two-finger pinch
  const pointersRef = useRef(new Map<number, PointerPos>());
  const gestureRef = useRef({
    downX: 0,
    downY: 0,
    lastX: 0,
    lastY: 0,
    moved: 0,
    pinchDist: 0,
    pinchMidX: 0,
    pinchMidY: 0,
  });

  const localPos = (e: ReactPointerEvent): PointerPos => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const beginPinch = () => {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return;
    const a = pts[0]!;
    const b = pts[1]!;
    const g = gestureRef.current;
    g.pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
    g.pinchMidX = (a.x + b.x) / 2;
    g.pinchMidY = (a.y + b.y) / 2;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = localPos(e);
    pointersRef.current.set(e.pointerId, pos);
    const g = gestureRef.current;
    if (pointersRef.current.size === 1) {
      g.downX = pos.x;
      g.downY = pos.y;
      g.lastX = pos.x;
      g.lastY = pos.y;
      g.moved = 0;
    } else if (pointersRef.current.size === 2) {
      beginPinch();
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    const pos = localPos(e);
    pointersRef.current.set(e.pointerId, pos);
    const g = gestureRef.current;
    const s = useProjectStore.getState();

    if (pointersRef.current.size >= 2) {
      // pinch zoom + two-finger pan
      const pts = [...pointersRef.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (g.pinchDist > 0 && dist > 0) {
        zoomAt(midX, midY, dist / g.pinchDist);
      }
      const v = useProjectStore.getState().viewport;
      s.setViewport({
        ...v,
        offsetX: v.offsetX + (midX - g.pinchMidX),
        offsetY: v.offsetY + (midY - g.pinchMidY),
      });
      g.pinchDist = dist;
      g.pinchMidX = midX;
      g.pinchMidY = midY;
      g.moved = CLICK_SLOP_PX + 1; // pinch never counts as a click
      return;
    }

    // single-pointer drag pan
    const dx = pos.x - g.lastX;
    const dy = pos.y - g.lastY;
    g.moved += Math.abs(dx) + Math.abs(dy);
    g.lastX = pos.x;
    g.lastY = pos.y;
    if (e.buttons !== 0 && (dx !== 0 || dy !== 0)) {
      const v = s.viewport;
      s.setViewport({ ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const wasSingle = pointersRef.current.size === 1;
    const g = gestureRef.current;
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size === 1) {
      // dropped from pinch to single pointer: restart pan from remaining point
      const rest = [...pointersRef.current.values()][0]!;
      g.lastX = rest.x;
      g.lastY = rest.y;
      return;
    }

    if (wasSingle && g.moved < CLICK_SLOP_PX) {
      // plain click → cycle the cell under the cursor
      const pos = localPos(e);
      const s = useProjectStore.getState();
      const p = s.project;
      if (!p) return;
      const cellPx = BASE_CELL * s.viewport.zoom;
      const col = Math.floor((pos.x - s.viewport.offsetX) / cellPx);
      const row = Math.floor((pos.y - s.viewport.offsetY) / cellPx);
      if (row >= 0 && row < p.grid.rows && col >= 0 && col < p.grid.cols) {
        const cell = p.grid.cells[row * p.grid.cols + col];
        // ignore clicks on empty/background cells and on hidden colours —
        // a hidden colour is locked until it's unhidden
        if (
          cell &&
          cell.symbol_id !== BACKGROUND_SYMBOL_ID &&
          !s.filter.hiddenSymbolIds.includes(cell.symbol_id)
        ) {
          s.cycleCell(row, col);
        }
      }
    }
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
  };

  return (
    <div ref={containerRef} className="pattern-canvas-container">
      <canvas
        ref={canvasRef}
        className="pattern-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        aria-label="Pattern grid viewer"
      />
    </div>
  );
}
