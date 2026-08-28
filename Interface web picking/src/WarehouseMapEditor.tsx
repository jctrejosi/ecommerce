import { useState, useRef } from "react";
import {
  CELL, SHELF_COLS, CANVAS_W, CANVAS_H,
  SHELF_CODE_H, SHELF_ROW_H,
  PlacedShelf, ShelfDef, ShelfRowDef,
  INITIAL_PLACED, INITIAL_AVAILABLE,
  shelfPixelH,
} from "./mapData";

interface Props {
  initialPlaced?: PlacedShelf[];
  onBack: () => void;
  onSave: (shelves: PlacedShelf[]) => void;
}

const CATEGORY_COLORS = [
  "#3B82F6", "#EF4444", "#22C55E", "#F59E0B", "#A855F7",
  "#06B6D4", "#F97316", "#EC4899", "#10B981", "#6B7280",
];

export default function WarehouseMapEditor({ initialPlaced, onBack, onSave }: Props) {
  const [placed, setPlaced] = useState<PlacedShelf[]>(initialPlaced ?? INITIAL_PLACED);
  const [available, setAvailable] = useState<ShelfDef[]>(INITIAL_AVAILABLE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [saved, setSaved] = useState(false);
  // Ghost element for panel→canvas drag
  const [panelDrag, setPanelDrag] = useState<{ def: ShelfDef; x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const selected = placed.find(s => s.id === selectedId) ?? null;

  // ─── Drag on canvas ────────────────────────────────────────────────────────

  function startDrag(e: React.PointerEvent, shelfId: string) {
    e.stopPropagation();
    const shelf = placed.find(s => s.id === shelfId)!;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left + canvas.scrollLeft;
    const py = e.clientY - rect.top + canvas.scrollTop;
    setDragOffset({ x: px - shelf.gridX * CELL, y: py - shelf.gridY * CELL });
    setDraggingId(shelfId);
    setSelectedId(shelfId);
    canvas.setPointerCapture(e.pointerId);
  }

  function onCanvasMove(e: React.PointerEvent) {
    if (!draggingId) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left + canvas.scrollLeft;
    const py = e.clientY - rect.top + canvas.scrollTop;
    const gx = Math.max(0, Math.round((px - dragOffset.x) / CELL));
    const gy = Math.max(0, Math.round((py - dragOffset.y) / CELL));
    setPlaced(prev => prev.map(s => s.id === draggingId ? { ...s, gridX: gx, gridY: gy } : s));
  }

  function onCanvasUp() {
    setDraggingId(null);
  }

  // ─── Panel drag (panel → canvas) ──────────────────────────────────────────

  function startPanelDrag(e: React.PointerEvent, def: ShelfDef) {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setPanelDrag({ def, x: e.clientX, y: e.clientY });
  }

  function movePanelDrag(e: React.PointerEvent) {
    if (!panelDrag) return;
    setPanelDrag(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
  }

  function endPanelDrag(e: React.PointerEvent) {
    if (!panelDrag) return;
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      if (
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom
      ) {
        const px = e.clientX - rect.left + canvas.scrollLeft;
        const py = e.clientY - rect.top + canvas.scrollTop;
        const gx = Math.max(0, Math.round(px / CELL));
        const gy = Math.max(0, Math.round(py / CELL));
        const newShelf: PlacedShelf = {
          ...panelDrag.def,
          id: `placed-${panelDrag.def.id}-${Date.now()}`,
          gridX: gx, gridY: gy, rotation: 0,
        };
        setPlaced(prev => [...prev, newShelf]);
        setAvailable(prev => prev.filter(s => s.id !== panelDrag.def.id));
        setSelectedId(newShelf.id);
      }
    }
    setPanelDrag(null);
  }

  // ─── Panel actions ─────────────────────────────────────────────────────────

  function addToCanvas(def: ShelfDef) {
    const newShelf: PlacedShelf = {
      ...def,
      id: `placed-${def.id}-${Date.now()}`,
      gridX: 1, gridY: 1, rotation: 0,
    };
    setPlaced(prev => [...prev, newShelf]);
    setAvailable(prev => prev.filter(s => s.id !== def.id));
    setSelectedId(newShelf.id);
  }

  function deleteSelected() {
    setPlaced(prev => prev.filter(s => s.id !== selectedId));
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!selected) return;
    const dup: PlacedShelf = {
      ...selected,
      id: `dup-${Date.now()}`,
      gridX: selected.gridX + SHELF_COLS + 1,
      gridY: selected.gridY,
    };
    setPlaced(prev => [...prev, dup]);
    setSelectedId(dup.id);
  }

  function updateSelected(patch: Partial<PlacedShelf>) {
    setPlaced(prev => prev.map(s => s.id === selectedId ? { ...s, ...patch } : s));
  }

  function updateRow(ri: number, label: string) {
    if (!selected) return;
    const rows = selected.rows.map((r, i) => i === ri ? { label } : r);
    updateSelected({ rows });
  }

  function addRow() {
    if (!selected) return;
    updateSelected({ rows: [...selected.rows, { label: `Fila ${selected.rows.length + 1}` }] });
  }

  function removeRow(ri: number) {
    if (!selected || selected.rows.length <= 1) return;
    updateSelected({ rows: selected.rows.filter((_, i) => i !== ri) });
  }

  // ─── Import ────────────────────────────────────────────────────────────────

  function handleImport() {
    const newDefs: ShelfDef[] = importText
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line, i) => {
        const [code, name, rowsCount, content] = line.split("|");
        const count = Math.max(1, parseInt(rowsCount) || 4);
        const labels = (content || "").split(";");
        const rows: ShelfRowDef[] = Array.from({ length: count }, (_, j) => ({
          label: labels[j]?.trim() || `Fila ${j + 1}`,
        }));
        return {
          id: `import-${Date.now()}-${i}`,
          code: code?.trim() || `X${i}`,
          name: name?.trim() || "Sin nombre",
          type: count >= 5 ? ("wall" as const) : ("center" as const),
          rows,
          color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
        };
      });
    setAvailable(prev => [...prev, ...newDefs]);
    setImportText("");
    setShowImport(false);
  }

  function handleSave() {
    onSave(placed);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full bg-[#0C0C0D] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-14 pb-3 shrink-0 border-b border-white/8">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center active:bg-white/10 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 5l-7 7 7 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <h2 className="text-white font-800 text-base tracking-tight">Editor de mapa</h2>
            <p className="text-white/30 text-[11px] font-500">Sucursal Centro · Admin</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/60 text-xs font-600 active:bg-white/10 transition-colors"
          >
            Importar
          </button>
          <button
            onClick={handleSave}
            className={`px-3 py-1.5 rounded-lg text-xs font-700 transition-all ${saved ? "bg-green-500 text-white" : "bg-amber-400 text-[#0C0C0D]"}`}
          >
            {saved ? "✓ Guardado" : "Guardar"}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-[86px] shrink-0 border-r border-white/8 overflow-y-auto bg-[#111113] flex flex-col">
          <p className="text-white/25 text-[9px] font-700 uppercase tracking-widest px-2 pt-3 pb-1.5">
            Disponibles
          </p>
          {available.length === 0 ? (
            <p className="text-white/20 text-[10px] px-2 pt-1 leading-tight">
              Todas en el mapa
            </p>
          ) : (
            available.map(def => (
              <div
                key={def.id}
                onPointerDown={e => startPanelDrag(e, def)}
                onPointerMove={movePanelDrag}
                onPointerUp={endPanelDrag}
                onClick={() => addToCanvas(def)}
                className="mx-1.5 mb-1.5 rounded-lg overflow-hidden border border-white/8 bg-white/[0.03] active:bg-white/8 transition-colors cursor-grab active:cursor-grabbing touch-none"
              >
                <div className="h-1 w-full" style={{ backgroundColor: def.color }} />
                <div className="p-1.5">
                  <p className="text-white font-800 text-[11px]">{def.code}</p>
                  <p className="text-white/40 text-[9px] leading-tight mt-0.5">{def.name}</p>
                  <p className="text-white/25 text-[9px] mt-0.5">{def.rows.length} filas</p>
                  <div
                    className="mt-1.5 rounded-md text-center py-0.5 text-[9px] font-700"
                    style={{ color: def.color, background: def.color + "20" }}
                  >
                    ⠿ Arrastrar
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Divider + hint */}
          <div className="mt-auto p-2 border-t border-white/8">
            <p className="text-white/20 text-[9px] leading-tight text-center">
              Arrastra para mover
            </p>
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="flex-1 overflow-auto relative select-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)
            `,
            backgroundSize: `${CELL}px ${CELL}px`,
          }}
          onPointerMove={onCanvasMove}
          onPointerUp={onCanvasUp}
          onPointerLeave={onCanvasUp}
          onClick={() => setSelectedId(null)}
        >
          <div style={{ width: CANVAS_W, height: CANVAS_H, position: "relative" }}>
            {/* Walls */}
            <div className="absolute top-0 left-0 right-0 h-[5px] bg-white/15 rounded-b pointer-events-none" />
            <div className="absolute top-0 left-0 bottom-0 w-[5px] bg-white/15 rounded-r pointer-events-none" />
            <div className="absolute top-0 right-0 bottom-0 w-[5px] bg-white/15 rounded-l pointer-events-none" />

            {/* Aisle labels */}
            {[
              { y: 6 * CELL, label: "Pasillo 1" },
              { y: 12 * CELL, label: "Pasillo 2" },
              { y: 18 * CELL, label: "Pasillo 3" },
            ].map(({ y, label }) => (
              <div
                key={label}
                className="absolute left-0 right-0 flex items-center pointer-events-none"
                style={{ top: y, height: CELL }}
              >
                <span className="text-white/10 text-[9px] font-700 uppercase tracking-widest pl-3">
                  {label}
                </span>
              </div>
            ))}

            {/* Empty state */}
            {placed.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <p className="text-white/20 text-sm font-600">Arrastra estanterías aquí</p>
                  <p className="text-white/10 text-xs mt-1">o usa «+ Añadir» en el panel</p>
                </div>
              </div>
            )}

            {/* Placed shelves */}
            {placed.map(shelf => {
              const h = shelfPixelH(shelf);
              const isSelected = selectedId === shelf.id;
              const isDragging = draggingId === shelf.id;
              return (
                <div
                  key={shelf.id}
                  onPointerDown={e => startDrag(e, shelf.id)}
                  onClick={e => { e.stopPropagation(); setSelectedId(shelf.id); }}
                  className={`absolute rounded overflow-hidden ${isDragging ? "cursor-grabbing z-20" : "cursor-grab z-10"} transition-shadow`}
                  style={{
                    left: shelf.gridX * CELL,
                    top: shelf.gridY * CELL,
                    width: SHELF_COLS * CELL,
                    height: h,
                    boxShadow: isSelected
                      ? `0 0 0 2px ${shelf.color}, 0 4px 20px rgba(0,0,0,0.6)`
                      : "0 2px 8px rgba(0,0,0,0.5)",
                    opacity: isDragging ? 0.8 : 1,
                  }}
                >
                  {/* Color top bar */}
                  <div className="w-full" style={{ height: 4, backgroundColor: shelf.color }} />
                  {/* Code row */}
                  <div
                    className="flex items-center px-1.5"
                    style={{ height: SHELF_CODE_H - 4, backgroundColor: shelf.color + "40" }}
                  >
                    <span className="text-white font-800 text-[10px] leading-none">{shelf.code}</span>
                  </div>
                  {/* Band rows */}
                  {shelf.rows.map((row, ri) => (
                    <div
                      key={ri}
                      className="flex items-center px-1.5 border-t border-black/25"
                      style={{ height: SHELF_ROW_H, backgroundColor: shelf.color + "18" }}
                    >
                      <span
                        className="text-white/60 text-[8px] leading-tight truncate font-500"
                        title={row.label}
                      >
                        {row.label}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Properties bottom sheet */}
      {selected && (
        <div className="shrink-0 bg-[#161618] border-t border-white/10 px-4 pt-3 pb-6 animate-fade-in" style={{ maxHeight: 300 }}>
          <div className="w-8 h-1 bg-white/20 rounded-full mx-auto mb-3" />

          {/* Title row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2" style={{ borderColor: selected.color, backgroundColor: selected.color + "40" }} />
              <span className="text-white font-700 text-sm">{selected.code} · {selected.name}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={duplicateSelected}
                className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center active:bg-white/10 transition-colors"
                title="Duplicar"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="9" width="13" height="13" rx="2" stroke="white" strokeWidth="1.5" opacity="0.6" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="white" strokeWidth="1.5" opacity="0.6" />
                </svg>
              </button>
              <button
                onClick={deleteSelected}
                className="w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center active:bg-red-500/20 transition-colors"
                title="Eliminar"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {/* Fields row */}
          <div className="grid grid-cols-3 gap-2 mb-2.5">
            <div>
              <label className="text-white/30 text-[9px] font-700 uppercase tracking-wide block mb-1">Código</label>
              <input
                value={selected.code}
                onChange={e => updateSelected({ code: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-amber-400/50"
              />
            </div>
            <div>
              <label className="text-white/30 text-[9px] font-700 uppercase tracking-wide block mb-1">Nombre</label>
              <input
                value={selected.name}
                onChange={e => updateSelected({ name: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-amber-400/50"
              />
            </div>
            <div>
              <label className="text-white/30 text-[9px] font-700 uppercase tracking-wide block mb-1">Rotación</label>
              <div className="flex gap-1">
                {([0, 90] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => updateSelected({ rotation: r })}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-700 transition-all ${selected.rotation === r ? "bg-amber-400 text-[#0C0C0D]" : "bg-white/5 border border-white/10 text-white/50"}`}
                  >
                    {r}°
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Color chips */}
          <div className="flex items-center gap-1.5 mb-2.5">
            <span className="text-white/30 text-[9px] font-700 uppercase tracking-wide shrink-0">Color</span>
            <div className="flex gap-1.5 overflow-x-auto">
              {CATEGORY_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => updateSelected({ color: c })}
                  className="w-5 h-5 rounded-full shrink-0 transition-transform active:scale-90"
                  style={{
                    backgroundColor: c,
                    boxShadow: selected.color === c ? `0 0 0 2px #0C0C0D, 0 0 0 4px ${c}` : "none",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Row editor */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-white/30 text-[9px] font-700 uppercase tracking-wide">Filas ({selected.rows.length})</label>
              <button onClick={addRow} className="text-amber-400 text-[10px] font-700">+ Añadir fila</button>
            </div>
            <div className="space-y-1 max-h-[72px] overflow-y-auto">
              {selected.rows.map((row, ri) => (
                <div key={ri} className="flex items-center gap-1.5">
                  <span className="text-white/25 text-[9px] w-8 shrink-0">F{ri + 1}</span>
                  <input
                    value={row.label}
                    onChange={e => updateRow(ri, e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-md px-2 py-1 text-white text-[11px] focus:outline-none focus:border-amber-400/40"
                  />
                  <button
                    onClick={() => removeRow(ri)}
                    className="w-5 h-5 rounded flex items-center justify-center text-red-400/60 active:text-red-400 hover:text-red-400 transition-colors shrink-0"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Panel drag ghost */}
      {panelDrag && (
        <div
          className="fixed pointer-events-none z-[100] rounded-lg overflow-hidden opacity-85"
          style={{
            left: panelDrag.x - (SHELF_COLS * CELL) / 2,
            top: panelDrag.y - 12,
            width: SHELF_COLS * CELL,
            height: shelfPixelH(panelDrag.def),
            boxShadow: `0 8px 24px rgba(0,0,0,0.6), 0 0 0 2px ${panelDrag.def.color}`,
            transform: "rotate(-2deg) scale(0.95)",
          }}
        >
          <div style={{ height: 4, backgroundColor: panelDrag.def.color }} />
          <div
            style={{ height: SHELF_CODE_H - 4, backgroundColor: panelDrag.def.color + "50" }}
            className="flex items-center px-1.5"
          >
            <span className="text-white font-800 text-[10px]">{panelDrag.def.code}</span>
          </div>
          {panelDrag.def.rows.map((row, ri) => (
            <div
              key={ri}
              className="flex items-center px-1.5 border-t border-black/25"
              style={{ height: SHELF_ROW_H, backgroundColor: panelDrag.def.color + "25" }}
            >
              <span className="text-white/50 text-[8px] truncate font-500">{row.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex items-end justify-center pb-8 px-5 z-50">
          <div className="bg-[#1C1C1E] border border-white/10 rounded-3xl p-5 w-full animate-fade-in">
            <h3 className="text-white font-800 text-base mb-1">Importar estanterías</h3>
            <p className="text-white/40 text-xs mb-2 font-500 leading-relaxed">
              Formato por línea: <span className="text-white/60">código|nombre|nº_filas|fila1;fila2;…</span>
            </p>
            <div className="bg-amber-400/8 border border-amber-400/20 rounded-lg px-2.5 py-2 mb-3">
              <code className="text-amber-400 text-[10px] leading-relaxed block">
                F2|Carnes frescas|4|Pollo;Res;Cerdo;Embutidos{"\n"}
                G2|Snacks|3|Papas fritas;Maní;Chicles
              </code>
            </div>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={"A5|Cereales|4|Arroz inflado;Corn flakes;Granola;Avena"}
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs placeholder:text-white/20 focus:outline-none focus:border-amber-400/50 resize-none mb-3 font-mono"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowImport(false); setImportText(""); }}
                className="flex-1 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-600 text-sm active:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={!importText.trim()}
                className="flex-1 py-3 bg-amber-400 rounded-xl text-[#0C0C0D] font-800 text-sm active:scale-95 transition-all disabled:opacity-40"
              >
                Importar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
