import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import {
  CELL, SHELF_COLS, CANVAS_W, CANVAS_H,
  SHELF_CODE_H, SHELF_ROW_H,
  PlacedShelf,
  shelfPixelH,
} from "./mapData";

interface PickingProduct {
  name: string;
  sku: string;
  aisle: string;
  shelf: string;
  level: string;
  quantity: number;
  scannedQty: number;
  imageHue: number;
}

interface Props {
  placed: PlacedShelf[];
  currentProduct: PickingProduct;
  nextProduct?: PickingProduct | null;
  orderCode: string;
  scanned: number;
  total: number;
  onScan: () => void;
  onBack: () => void;
}

// Shelf row index (0-based) from "Estante 2" → 1
function parseRowIdx(s: string): number {
  const m = s.match(/\d+/);
  return m ? parseInt(m[0]) - 1 : 0;
}

// ─── Shelf on map ─────────────────────────────────────────────────────────────

function MapShelf({
  shelf,
  isActive,
  isNext,
  activeRowIdx,
  dim,
}: {
  shelf: PlacedShelf;
  isActive: boolean;
  isNext: boolean;
  activeRowIdx: number;
  dim: boolean;
}) {
  const h = shelfPixelH(shelf);
  const opacity = isActive ? 1 : isNext ? 0.62 : dim ? 0.22 : 0.38;

  return (
    <div
      style={{
        position: "absolute",
        left: shelf.gridX * CELL,
        top: shelf.gridY * CELL,
        width: SHELF_COLS * CELL,
        height: h,
        opacity,
        zIndex: isActive ? 10 : isNext ? 5 : 1,
        boxShadow: isActive ? `0 0 0 2px ${shelf.color}` : "none",
        borderRadius: 5,
        overflow: "hidden",
      }}
    >
      {/* Top color bar */}
      <div style={{ height: 4, backgroundColor: shelf.color }} />
      {/* Code */}
      <div
        style={{ height: SHELF_CODE_H - 4, backgroundColor: shelf.color + "50" }}
        className="flex items-center px-1.5"
      >
        <span className="text-white font-800 text-[10px] leading-none">{shelf.code}</span>
        {isNext && <span className="text-white/40 text-[8px] ml-1 font-600">→</span>}
      </div>
      {/* Row bands */}
      {shelf.rows.map((row, ri) => {
        const isHot = isActive && ri === activeRowIdx;
        return (
          <div
            key={ri}
            className={`flex items-center px-1.5 border-t border-black/25 ${isHot ? "animate-row-glow" : ""}`}
            style={{
              height: SHELF_ROW_H,
              backgroundColor: isHot ? undefined : shelf.color + (isActive ? "22" : "12"),
            }}
          >
            <span className="text-white/60 text-[8px] truncate font-500 leading-none">
              {row.label}
            </span>
            {isHot && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PickingMap({
  placed,
  currentProduct,
  nextProduct,
  orderCode,
  scanned,
  total,
  onScan,
  onBack,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // Use a ref for the live transform so pointer handlers always see current values
  const tfmRef = useRef({ s: 0.68, x: 0, y: 0 });
  // React state drives rendering
  const [tfm, setTfmState] = useState({ s: 0.68, x: 0, y: 0 });

  const [animating, setAnimating] = useState(false);
  const [detailShelf, setDetailShelf] = useState<PlacedShelf | null>(null);

  // Pointer tracking refs
  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const panStart = useRef({ x: 0, y: 0 });
  const pinchRef = useRef<{ dist: number; s: number; mx: number; my: number } | null>(null);
  const didPan = useRef(false);

  const allDone = scanned >= total && total > 0;
  const activeShelf = placed.find(s => s.code === currentProduct.aisle) ?? null;
  const nextShelf = nextProduct ? placed.find(s => s.code === nextProduct.aisle) ?? null : null;
  const activeRowIdx = parseRowIdx(currentProduct.shelf);
  const noLocation = !activeShelf && !allDone;

  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of placed) {
      if (!seen.has(s.color)) seen.set(s.color, s.name);
    }
    return [...seen.entries()].map(([color, name]) => ({ color, name }));
  }, [placed]);

  // ─── Transform helpers ────────────────────────────────────────────────────

  function applyTfm(t: { s: number; x: number; y: number }, anim: boolean) {
    tfmRef.current = t;
    if (innerRef.current) {
      innerRef.current.style.transition = anim ? "transform 0.38s cubic-bezier(0.25,0.46,0.45,0.94)" : "none";
      innerRef.current.style.transform = `translate(${t.x}px,${t.y}px) scale(${t.s})`;
    }
    setTfmState(t);
  }

  function centerOn(shelf: PlacedShelf, animate: boolean) {
    const c = containerRef.current;
    if (!c) return;
    const W = c.clientWidth || 300;
    const H = c.clientHeight || 420;
    const cx = shelf.gridX * CELL + (SHELF_COLS * CELL) / 2;
    const cy = shelf.gridY * CELL + shelfPixelH(shelf) / 2;
    const s = tfmRef.current.s;
    applyTfm({ s, x: W / 2 - cx * s, y: H / 2 - cy * s }, animate);
  }

  useLayoutEffect(() => {
    if (activeShelf) centerOn(activeShelf, false);
  }, []);

  useEffect(() => {
    if (activeShelf) {
      setAnimating(true);
      centerOn(activeShelf, true);
      setTimeout(() => setAnimating(false), 400);
    }
  }, [activeShelf?.id]);

  // ─── Pointer handlers ─────────────────────────────────────────────────────

  function onPointerDown(e: React.PointerEvent) {
    containerRef.current?.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    didPan.current = false;

    if (ptrs.current.size === 1) {
      panStart.current = { x: e.clientX, y: e.clientY };
      pinchRef.current = null;
    } else if (ptrs.current.size === 2) {
      const [p1, p2] = [...ptrs.current.values()];
      pinchRef.current = {
        dist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
        s: tfmRef.current.s,
        mx: (p1.x + p2.x) / 2,
        my: (p1.y + p2.y) / 2,
      };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (ptrs.current.size === 1) {
      const totalD = Math.hypot(e.clientX - panStart.current.x, e.clientY - panStart.current.y);
      if (totalD > 4) didPan.current = true;
      const t = tfmRef.current;
      applyTfm({ s: t.s, x: t.x + dx, y: t.y + dy }, false);
    } else if (ptrs.current.size === 2 && pinchRef.current) {
      const pts = [...ptrs.current.values()];
      const newDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const newS = Math.min(2.5, Math.max(0.28, pinchRef.current.s * newDist / pinchRef.current.dist));
      const newMx = (pts[0].x + pts[1].x) / 2;
      const newMy = (pts[0].y + pts[1].y) / 2;
      const dmx = newMx - pinchRef.current.mx;
      const dmy = newMy - pinchRef.current.my;
      didPan.current = true;
      const t = tfmRef.current;
      applyTfm({ s: newS, x: t.x + dmx, y: t.y + dmy }, false);
      pinchRef.current.mx = newMx;
      pinchRef.current.my = newMy;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const wasLast = ptrs.current.size === 1;
    ptrs.current.delete(e.pointerId);

    if (ptrs.current.size === 1) {
      const [pt] = ptrs.current.values();
      panStart.current = { x: pt.x, y: pt.y };
      pinchRef.current = null;
    }

    if (wasLast && !didPan.current) {
      // Tap — find which shelf was hit in canvas coords
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const t = tfmRef.current;
      const cx = (e.clientX - rect.left - t.x) / t.s;
      const cy = (e.clientY - rect.top - t.y) / t.s;
      const hit = placed.find(s => {
        const sx = s.gridX * CELL, sy = s.gridY * CELL;
        return cx >= sx && cx <= sx + SHELF_COLS * CELL && cy >= sy && cy <= sy + shelfPixelH(s);
      });
      if (hit && hit.id === activeShelf?.id) setDetailShelf(hit);
    }
  }

  function zoom(delta: number) {
    const newS = Math.min(2.5, Math.max(0.28, tfmRef.current.s + delta));
    const c = containerRef.current;
    if (!c) return;
    const cx = c.clientWidth / 2;
    const cy = c.clientHeight / 2;
    // Zoom toward center: adjust pan so center stays fixed
    const t = tfmRef.current;
    const factor = newS / t.s;
    const newX = cx - (cx - t.x) * factor;
    const newY = cy - (cy - t.y) * factor;
    applyTfm({ s: newS, x: newX, y: newY }, true);
  }

  // ─── Route line path ──────────────────────────────────────────────────────

  const routeLine = useMemo(() => {
    if (!activeShelf || !nextShelf) return null;
    const ax = activeShelf.gridX * CELL + (SHELF_COLS * CELL) / 2;
    const ay = activeShelf.gridY * CELL + shelfPixelH(activeShelf) / 2;
    const bx = nextShelf.gridX * CELL + (SHELF_COLS * CELL) / 2;
    const by = nextShelf.gridY * CELL + shelfPixelH(nextShelf) / 2;
    return { ax, ay, bx, by };
  }, [activeShelf?.id, nextShelf?.id]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-full bg-[#0C0C0D] flex flex-col overflow-hidden">

      {/* Header */}
      <div className="px-4 pt-14 pb-3 shrink-0 border-b border-white/8">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center active:bg-white/10 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 5l-7 7 7 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-800 text-base tracking-tight">Mapa de bodega</h2>
            <p className="text-white/40 text-xs font-500 truncate">{orderCode} · Sucursal Centro</p>
          </div>
          <div className="shrink-0 flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-3 py-1">
            <div className={`w-1.5 h-1.5 rounded-full ${allDone ? "bg-green-400" : "bg-amber-400 animate-pulse"}`} />
            <span className="text-white font-700 text-xs">{scanned}/{total}</span>
          </div>
        </div>
      </div>

      {/* ── All done state ── */}
      {allDone ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          {/* Dimmed map preview behind */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10">
            <div
              className="relative"
              style={{ transform: "scale(0.38)", transformOrigin: "center" }}
            >
              {placed.map(s => (
                <div
                  key={s.id}
                  className="absolute rounded overflow-hidden"
                  style={{
                    left: s.gridX * CELL, top: s.gridY * CELL,
                    width: SHELF_COLS * CELL, height: shelfPixelH(s),
                    backgroundColor: s.color + "30",
                    border: `1px solid ${s.color}40`,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center mb-5 shadow-[0_0_40px_rgba(34,197,94,0.4)] animate-success-bounce">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-white font-800 text-xl tracking-tight mb-1">Pedido completado</p>
          <p className="text-white/40 text-sm font-500 mb-8">Todos los productos han sido recogidos</p>
          <button
            onClick={onBack}
            className="w-full bg-amber-400 text-[#0C0C0D] font-800 text-base rounded-2xl py-4 active:scale-[0.98] transition-all"
          >
            Volver al pedido
          </button>
        </div>
      ) : noLocation ? (
        /* ── No location state ── */
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="#F59E0B" strokeWidth="1.5" />
              <circle cx="12" cy="9" r="2.5" stroke="#F59E0B" strokeWidth="1.5" />
            </svg>
          </div>
          <span className="text-amber-400 text-xs font-700 bg-amber-400/10 border border-amber-400/30 px-3 py-1 rounded-full mb-4">
            Sin ubicación asignada
          </span>
          <p className="text-white font-700 text-base mb-1">{currentProduct.name}</p>
          <p className="text-white/40 text-sm font-500 mb-8 leading-relaxed">
            Este producto no tiene ubicación en el mapa. Ve directamente al escáner.
          </p>
          <button
            onClick={onScan}
            className="w-full bg-amber-400 text-[#0C0C0D] font-800 text-base rounded-2xl py-4 active:scale-[0.98] transition-all"
          >
            Ir al escáner →
          </button>
        </div>
      ) : (
        <>
          {/* ── Canvas ── */}
          <div
            ref={containerRef}
            className="flex-1 overflow-hidden relative select-none"
            style={{ touchAction: "none", cursor: "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {/* Transformed canvas */}
            <div
              ref={innerRef}
              style={{
                position: "absolute",
                width: CANVAS_W,
                height: CANVAS_H,
                transformOrigin: "0 0",
                transform: `translate(${tfm.x}px,${tfm.y}px) scale(${tfm.s})`,
                backgroundImage: `
                  linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)
                `,
                backgroundSize: `${CELL}px ${CELL}px`,
              }}
            >
              {/* Walls */}
              <div className="absolute top-0 left-0 right-0 h-[4px] bg-white/10 pointer-events-none" />
              <div className="absolute top-0 left-0 bottom-0 w-[4px] bg-white/10 pointer-events-none" />
              <div className="absolute top-0 right-0 bottom-0 w-[4px] bg-white/10 pointer-events-none" />

              {/* Pulse rings behind active shelf */}
              {activeShelf && (
                <>
                  <div
                    className="absolute rounded pointer-events-none animate-map-pulse-ring"
                    style={{
                      left: activeShelf.gridX * CELL - 8,
                      top: activeShelf.gridY * CELL - 8,
                      width: SHELF_COLS * CELL + 16,
                      height: shelfPixelH(activeShelf) + 16,
                      border: `3px solid ${activeShelf.color}`,
                      borderRadius: 10,
                      zIndex: 6,
                    }}
                  />
                  <div
                    className="absolute rounded pointer-events-none animate-map-pulse-ring"
                    style={{
                      left: activeShelf.gridX * CELL - 16,
                      top: activeShelf.gridY * CELL - 16,
                      width: SHELF_COLS * CELL + 32,
                      height: shelfPixelH(activeShelf) + 32,
                      border: `2px solid ${activeShelf.color}`,
                      borderRadius: 14,
                      zIndex: 5,
                      animationDelay: "0.3s",
                    }}
                  />
                </>
              )}

              {/* Route line: current → next shelf */}
              {routeLine && (
                <svg
                  style={{
                    position: "absolute", left: 0, top: 0,
                    width: CANVAS_W, height: CANVAS_H,
                    overflow: "visible",
                    pointerEvents: "none",
                    zIndex: 4,
                  }}
                >
                  <line
                    x1={routeLine.ax} y1={routeLine.ay}
                    x2={routeLine.bx} y2={routeLine.by}
                    stroke="rgba(245,158,11,0.35)"
                    strokeWidth="2.5"
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                  />
                  <circle cx={routeLine.bx} cy={routeLine.by} r="5" fill="rgba(245,158,11,0.4)" />
                  <circle cx={routeLine.bx} cy={routeLine.by} r="2.5" fill="rgba(245,158,11,0.9)" />
                </svg>
              )}

              {/* Shelves */}
              {placed.map(shelf => (
                <MapShelf
                  key={shelf.id}
                  shelf={shelf}
                  isActive={shelf.id === activeShelf?.id}
                  isNext={shelf.id === nextShelf?.id}
                  activeRowIdx={activeRowIdx}
                  dim={!allDone}
                />
              ))}

              {/* "Tú estás aquí" dot — placed near active shelf foot */}
              {activeShelf && (
                <div
                  style={{
                    position: "absolute",
                    left: activeShelf.gridX * CELL + SHELF_COLS * CELL + 6,
                    top: activeShelf.gridY * CELL + shelfPixelH(activeShelf) - 14,
                    zIndex: 12,
                    pointerEvents: "none",
                  }}
                  className="flex items-center gap-1"
                >
                  <div className="w-5 h-5 rounded-full bg-white border-2 border-[#0C0C0D] flex items-center justify-center shadow-md">
                    <div className="w-2 h-2 rounded-full bg-[#0C0C0D]" />
                  </div>
                </div>
              )}
            </div>

            {/* Tap hint */}
            {activeShelf && !animating && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
                <div className="bg-amber-400/15 border border-amber-400/30 rounded-full px-3 py-1 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-amber-400 text-[10px] font-700">Toca la estantería ámbar</span>
                </div>
              </div>
            )}

            {/* Zoom controls */}
            <div className="absolute top-3 right-3 flex flex-col gap-1 z-20">
              <button
                onClick={() => zoom(0.15)}
                className="w-8 h-8 rounded-xl bg-[#0C0C0D]/80 border border-white/15 text-white text-lg font-700 flex items-center justify-center active:bg-white/10 transition-colors"
                style={{ pointerEvents: "all" }}
              >
                +
              </button>
              <button
                onClick={() => zoom(-0.15)}
                className="w-8 h-8 rounded-xl bg-[#0C0C0D]/80 border border-white/15 text-white text-lg font-700 flex items-center justify-center active:bg-white/10 transition-colors"
                style={{ pointerEvents: "all" }}
              >
                −
              </button>
              {activeShelf && (
                <button
                  onClick={() => centerOn(activeShelf, true)}
                  className="w-8 h-8 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center active:bg-amber-400/30 transition-colors mt-0.5"
                  style={{ pointerEvents: "all" }}
                  title="Centrar en producto"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="3" stroke="#F59E0B" strokeWidth="2" />
                    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Legend strip */}
          <div className="shrink-0 border-t border-white/8 bg-[#111113] px-3 py-2">
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-white/25 text-[9px] font-700 uppercase tracking-wider shrink-0">Leyenda</span>
              {legend.map(({ color, name }) => (
                <div key={color} className="flex items-center gap-1 shrink-0">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-white/50 text-[10px] font-500 whitespace-nowrap">{name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom product card */}
          <div className="shrink-0 bg-[#161618] border-t border-white/8 px-4 pt-3 pb-6">
            <div className="flex items-start gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: (activeShelf?.color ?? "#F59E0B") + "25" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="7" width="20" height="14" rx="2" stroke={activeShelf?.color ?? "#F59E0B"} strokeWidth="1.5" />
                  <path d="M16 7V5a4 4 0 0 0-8 0v2" stroke={activeShelf?.color ?? "#F59E0B"} strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-700 text-sm leading-tight truncate">{currentProduct.name}</p>
                <p className="text-white/40 text-xs font-500 mt-0.5">{currentProduct.sku}</p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span
                    className="text-[11px] font-600 border px-2 py-0.5 rounded-lg"
                    style={{
                      color: activeShelf?.color ?? "#F59E0B",
                      borderColor: (activeShelf?.color ?? "#F59E0B") + "40",
                      background: (activeShelf?.color ?? "#F59E0B") + "15",
                    }}
                  >
                    {currentProduct.aisle} · {currentProduct.shelf} · {currentProduct.level}
                  </span>
                  <span className="text-white/30 text-xs font-700">×{currentProduct.quantity}</span>
                </div>
              </div>
            </div>

            <button
              onClick={onScan}
              className="w-full bg-amber-400 text-[#0C0C0D] font-800 text-sm rounded-2xl py-3.5 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 9V6a1 1 0 0 1 1-1h3M3 15v3a1 1 0 0 0 1 1h3M21 9V6a1 1 0 0 0-1-1h-3M21 15v3a1 1 0 0 1-1 1h-3" stroke="#0C0C0D" strokeWidth="2" strokeLinecap="round" />
                <rect x="8" y="8" width="8" height="8" rx="1" stroke="#0C0C0D" strokeWidth="2" />
              </svg>
              Confirmar ubicación → Escanear
            </button>

            {nextProduct && nextShelf && (
              <p className="text-white/25 text-xs text-center mt-2 font-500">
                Siguiente: <span className="text-white/40">{nextProduct.aisle}</span>
                {" · "}
                {nextProduct.name.length > 26 ? nextProduct.name.slice(0, 26) + "…" : nextProduct.name}
              </p>
            )}
          </div>
        </>
      )}

      {/* Shelf detail modal */}
      {detailShelf && (
        <div className="absolute inset-0 bg-black/78 backdrop-blur-sm flex items-end justify-center pb-8 px-5 z-50">
          <div className="bg-[#1C1C1E] border border-white/10 rounded-3xl p-5 w-full animate-fade-in">

            {/* Shelf mini-preview + row detail */}
            <div className="flex items-start gap-4 mb-4">
              {/* Shelf miniature */}
              <div
                className="rounded-xl overflow-hidden shrink-0"
                style={{ width: 60, border: `2px solid ${detailShelf.color}` }}
              >
                <div style={{ height: 4, backgroundColor: detailShelf.color }} />
                <div
                  style={{ height: SHELF_CODE_H - 4, backgroundColor: detailShelf.color + "50" }}
                  className="flex items-center justify-center"
                >
                  <span className="text-white font-800 text-[10px]">{detailShelf.code}</span>
                </div>
                {detailShelf.rows.map((_, ri) => (
                  <div
                    key={ri}
                    className={`border-t border-black/20 ${ri === activeRowIdx ? "animate-row-glow" : ""}`}
                    style={{
                      height: SHELF_ROW_H,
                      backgroundColor: ri === activeRowIdx ? undefined : detailShelf.color + "18",
                    }}
                  >
                    {ri === activeRowIdx && (
                      <div className="h-full flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Row list */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: detailShelf.color }} />
                  <span className="text-white font-800 text-base">{detailShelf.code}</span>
                  <span className="text-white/40 text-sm font-500">— {detailShelf.name}</span>
                </div>
                <div className="space-y-1.5">
                  {detailShelf.rows.map((row, ri) => {
                    const hot = ri === activeRowIdx;
                    return (
                      <div
                        key={ri}
                        className={`flex items-center gap-2 px-2 py-1 rounded-lg ${hot ? "border border-amber-400/30" : ""}`}
                        style={hot ? { background: "rgba(245,158,11,0.12)" } : {}}
                      >
                        <span className={`text-[11px] font-700 w-5 shrink-0 ${hot ? "text-amber-400" : "text-white/25"}`}>
                          F{ri + 1}
                        </span>
                        <span className={`text-[11px] font-500 truncate ${hot ? "text-white" : "text-white/40"}`}>
                          {row.label}
                        </span>
                        {hot && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Product in this location */}
            <div className="bg-amber-400/8 border border-amber-400/20 rounded-xl px-3 py-2.5 mb-4">
              <p className="text-amber-400 font-700 text-[11px] mb-0.5">Buscar en esta ubicación</p>
              <p className="text-white font-600 text-sm leading-tight">{currentProduct.name}</p>
              <p className="text-white/50 text-xs font-500 mt-0.5">
                {currentProduct.aisle} · {currentProduct.shelf} · {currentProduct.level} · ×{currentProduct.quantity}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDetailShelf(null)}
                className="flex-1 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white font-600 text-sm active:bg-white/10 transition-colors"
              >
                Ver mapa
              </button>
              <button
                onClick={() => { setDetailShelf(null); onScan(); }}
                className="flex-1 py-3.5 bg-amber-400 rounded-xl text-[#0C0C0D] font-800 text-sm active:scale-95 transition-all"
              >
                Escanear →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
