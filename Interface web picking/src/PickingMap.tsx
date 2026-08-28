import { useEffect, useMemo, useRef, useState } from "react";
import { CELL, type PlacedShelf } from "./mapData";

// Dimensiones del cuadro de la bodega (celdas) — igual que en el admin
const GRID_COLS = 14;
const GRID_ROWS = 28;

interface Props {
  placed: PlacedShelf[];
  /** Ubicación del producto que se busca ahora: estantería + fila (titila en verde). */
  activeLocation: { shelfId: string; rowNumber: number } | null;
  /** Ubicaciones de otros productos del pedido (fragmentos en rojo). */
  orderLocations: { shelfId: string; rowNumber: number }[];
  orderCode: string;
  currentProductName: string;
  scanned: number;
  total: number;
  onScan: () => void;
  onBack: () => void;
}

function visualSize(s: PlacedShelf) {
  const w = s.width ?? 3;
  const h = s.height ?? Math.max(2, s.rows.length);
  return s.rotation === 90 ? { w: h, h: w } : { w, h };
}

// ─── Estantería (recuadro gris + fragmento titilando) ─────────────────────────

function MapShelf({
  shelf,
  activeRow,
  redRows,
}: {
  shelf: PlacedShelf;
  activeRow: number | null;
  redRows: number[];
}) {
  const { w, h } = visualSize(shelf);
  const rowsCount = shelf.rows.length;
  const band = rowsCount > 0 ? 100 / rowsCount : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: shelf.gridX * CELL,
        top: shelf.gridY * CELL,
        width: w * CELL,
        height: h * CELL,
        borderRadius: 6,
        backgroundColor: "rgba(255,255,255,0.05)",
        border: "1.5px solid rgba(255,255,255,0.16)",
        zIndex: activeRow != null ? 10 : redRows.length > 0 ? 5 : 1,
      }}
      className="flex items-center justify-center select-none"
    >
      <span
        className="font-800 truncate px-1"
        style={{
          fontSize: Math.min(14, Math.max(9, w * 3)),
          color: "rgba(255,255,255,0.6)",
          textShadow: "0 1px 3px rgba(0,0,0,0.9)",
          zIndex: 20,
        }}
      >
        {shelf.code}
      </span>

      {/* Fragmento verde titilando: donde está el producto a buscar */}
      {activeRow != null && rowsCount > 0 && (
        <div
          className="absolute inset-x-0 animate-blink-green"
          style={{ top: `${(activeRow - 1) * band}%`, height: `${band}%`, borderRadius: 4 }}
        />
      )}
      {/* Fragmentos rojos: otros productos del pedido */}
      {redRows.map((rn) => (
        <div
          key={rn}
          className="absolute inset-x-0 animate-blink-red"
          style={{ top: `${(rn - 1) * band}%`, height: `${band}%`, borderRadius: 4 }}
        />
      ))}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function PickingMap({
  placed,
  activeLocation,
  orderLocations,
  orderCode,
  currentProductName,
  scanned,
  total,
  onScan,
  onBack,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.85);

  const allDone = total > 0 && scanned >= total;

  const noLocation = useMemo(() => {
    // Si el producto actual no tiene estantería asignada (o no hay estanterías)
    return activeLocation == null && placed.length > 0;
  }, [activeLocation, placed.length]);

  // Ajustar el zoom inicial para que la bodega quepa en pantalla
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fit = () => {
      const w = GRID_COLS * CELL;
      const h = GRID_ROWS * CELL;
      const s = Math.max(0.3, Math.min(1, Math.min(el.clientWidth / w, el.clientHeight / h)));
      setScale(s);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div className="h-full bg-[#0C0C0D] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 shrink-0 border-b border-white/8">
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

      {/* Leyenda */}
      <div className="px-4 py-2 flex items-center gap-4 shrink-0 border-b border-white/5">
        <span className="flex items-center gap-1.5 text-white/45 text-[10px] font-600">
          <span className="w-3 h-3 rounded-sm bg-green-500/40 border border-green-400 animate-pulse" /> Producto actual
        </span>
        <span className="flex items-center gap-1.5 text-white/45 text-[10px] font-600">
          <span className="w-3 h-3 rounded-sm bg-red-500/25 border border-red-500/50" /> Otros del pedido
        </span>
        <span className="flex items-center gap-1.5 text-white/45 text-[10px] font-600">
          <span className="w-3 h-3 rounded-sm bg-white/10 border border-white/20" /> Resto
        </span>
      </div>

      {allDone ? (
        /* ── Todo recogido ── */
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center mb-5 shadow-[0_0_40px_rgba(34,197,94,0.4)] animate-success-bounce">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-white font-800 text-xl tracking-tight mb-1">Pedido completado</p>
          <p className="text-white/40 text-sm font-500 mb-8">Todos los productos han sido recogidos</p>
          <button
            onClick={onBack}
            className="w-full max-w-sm bg-amber-400 text-[#0C0C0D] font-800 text-base rounded-2xl py-4 active:scale-[0.98] transition-all"
          >
            Volver al pedido
          </button>
        </div>
      ) : noLocation ? (
        /* ── Sin ubicación asignada ── */
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
          <p className="text-white font-700 text-base mb-1">{currentProductName}</p>
          <p className="text-white/40 text-sm font-500 mb-8 leading-relaxed">
            Este producto no tiene estantería en el mapa. Ve directamente al escáner.
          </p>
          <button
            onClick={onScan}
            className="w-full max-w-sm bg-amber-400 text-[#0C0C0D] font-800 text-base rounded-2xl py-4 active:scale-[0.98] transition-all"
          >
            Ir al escáner →
          </button>
        </div>
      ) : (
        <>
          {/* ── Bodega ── */}
          <div
            ref={containerRef}
            className="flex-1 overflow-hidden relative"
            style={{ touchAction: "pan-x pan-y" }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ transform: `scale(${scale})` }}
            >
              <div
                className="relative bg-[#111113] border border-white/10 rounded-lg"
                style={{
                  width: GRID_COLS * CELL,
                  height: GRID_ROWS * CELL,
                  backgroundImage: `
                    linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)
                  `,
                  backgroundSize: `${CELL}px ${CELL}px`,
                }}
              >
                {/* Paredes */}
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-white/25" />
                <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-white/25" />
                <div className="absolute top-0 right-0 bottom-0 w-1.5 bg-white/25" />
                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/25" />

                <span className="absolute top-2 left-1/2 -translate-x-1/2 text-white/15 text-[10px] font-800 tracking-[0.3em] uppercase pointer-events-none select-none">
                  Bodega
                </span>

                {placed.map((shelf) => {
                  const sid = String(shelf.id);
                  const activeRow =
                    activeLocation && activeLocation.shelfId === sid ? activeLocation.rowNumber : null;
                  const redRows = orderLocations
                    .filter((l) => l.shelfId === sid)
                    .map((l) => l.rowNumber);
                  return <MapShelf key={shelf.id} shelf={shelf} activeRow={activeRow} redRows={redRows} />;
                })}
              </div>
            </div>
          </div>

          {/* ── Pie: producto actual + escanear ── */}
          <div className="shrink-0 bg-[#161618] border-t border-white/10 px-4 pt-3 pb-6">
            <p className="text-white/40 text-xs font-600 mb-1">Producto a buscar</p>
            <p className="text-white font-700 text-sm mb-3 truncate">{currentProductName}</p>
            <button
              onClick={onScan}
              className="w-full bg-amber-400 text-[#0C0C0D] font-800 text-base rounded-2xl py-4 active:scale-[0.98] transition-all"
            >
              Escanear producto
            </button>
          </div>
        </>
      )}
    </div>
  );
}
