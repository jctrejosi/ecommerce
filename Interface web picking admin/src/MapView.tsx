import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from './services/api'
import { CategoryTree } from './categoryTree'
import { useCategoryChangeConfirm, CategoryChangeConfirm } from './shelfCategories'
import type { Category, Shelf } from './types'

// ─── Constantes de la bodega ─────────────────────────────────────────────────

const CELL = 36 // px base por celda (luego se escala para llenar el espacio)
const GRID_COLS = 14 // ancho del cuadro de la bodega (celdas)
const GRID_ROWS = 28 // alto del cuadro de la bodega (celdas)
const BOX_W = GRID_COLS * CELL
const BOX_H = GRID_ROWS * CELL
// Alto del recuadro de la miniatura que se muestra en la pestaña Mapa.
const PREVIEW_H = 'min(52vh, 480px)'

// ─── Estado local del mapa ────────────────────────────────────────────────────

interface MapShelf {
  id: number
  code: string
  name: string
  color: string
  width: number
  height: number
  posX: number
  posY: number
  rotation: 0 | 90
  autoPlaced: boolean // pos inicial asignada automáticamente (aún sin guardar)
}

function visualSize(s: MapShelf) {
  return s.rotation === 90
    ? { w: s.height, h: s.width }
    : { w: s.width, h: s.height }
}

/** Coloca automáticamente las estanterías en (0,0) en las primeras celdas libres. */
function seedShelves(shelves: Shelf[]): MapShelf[] {
  const used = new Set<string>()
  const occupied = (s: MapShelf) => {
    const { w, h } = visualSize(s)
    for (let x = s.posX; x < s.posX + w; x++)
      for (let y = s.posY; y < s.posY + h; y++) used.add(`${x},${y}`)
  }
  const result: MapShelf[] = []
  for (const s of shelves) {
    const m: MapShelf = {
      id: s.id,
      code: s.code,
      name: s.name,
      color: s.color,
      width: s.width,
      height: s.height,
      posX: s.posX,
      posY: s.posY,
      rotation: s.rotation,
      autoPlaced: s.posX === 0 && s.posY === 0,
    }
    if (m.posX === 0 && m.posY === 0) {
      // buscar primera celda libre
      outer: for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
          if (!used.has(`${x},${y}`)) {
            m.posX = x
            m.posY = y
            break outer
          }
        }
      }
    }
    occupied(m)
    result.push(m)
  }
  return result
}

// ─── Input numérico que permite vaciar el campo mientras se edita ─────────────

function DimInput({
  value,
  max,
  onCommit,
}: {
  value: number
  max: number
  onCommit: (v: number) => void
}) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)

  // Sincroniza si el valor cambia desde fuera (p. ej. manijas de redimensionado)
  useEffect(() => {
    if (!focused) setText(String(value))
  }, [value, focused])

  const commit = () => {
    setFocused(false)
    const n = parseInt(text, 10)
    onCommit(Number.isFinite(n) ? n : 1)
  }

  return (
    <input
      type="number"
      min={1}
      max={max}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
      }}
      className="mt-1 w-24 bg-app border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
    />
  )
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function MapView({
  branchId,
  shelves,
  categories,
  onRefresh,
  notify,
}: {
  branchId: number
  shelves: Shelf[]
  categories: Category[]
  onRefresh: () => void
  notify: (m: string) => void
}) {
  const [items, setItems] = useState<MapShelf[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [autoSeeded, setAutoSeeded] = useState(false)
  const [scale, setScale] = useState(1)
  // Vista en pantalla completa (solo el mapa) y estantería cuyo contenido se edita.
  const [fullscreen, setFullscreen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null)
  const resizeRef = useRef<{
    id: number
    edge: 'e' | 's' | 'se'
    startX: number
    startY: number
    startW: number
    startH: number
    rotation: 0 | 90
  } | null>(null)
  // Miniatura de la bodega (pestaña Mapa): escala para que quepa completa.
  const previewRef = useRef<HTMLButtonElement>(null)
  const [previewScale, setPreviewScale] = useState(0.3)

  // Se re-siembra el mapa sólo si cambia el CONJUNTO de estanterías (alta/baja).
  // Así, refrescar tras guardar categorías no descarta la selección ni los ajustes
  // de posición/tamaño todavía sin guardar.
  const shelfIdsKey = shelves
    .map((s) => s.id)
    .sort((a, b) => a - b)
    .join(',')
  useEffect(() => {
    setItems(seedShelves(shelves))
    setSelectedId(null)
    setAutoSeeded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelfIdsKey])

  // Escala: la bodega ocupa TODO el ancho disponible de la zona. Como la rejilla
  // es más alta que ancha (14×28), el alto crece y se recorre con scroll.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const fit = () => {
      const s = Math.max(0.3, el.clientWidth / BOX_W)
      setScale(s)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    window.addEventListener('resize', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fit)
    }
    // Al alternar pantalla completa cambia el contenedor; hay que re-medir.
  }, [fullscreen])

  // Esc cierra la vista de pantalla completa.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // Escala de la miniatura: encaja la bodega completa (rejilla ∪ estanterías).
  const previewCols = useMemo(
    () => Math.max(GRID_COLS, ...items.map((s) => s.posX + visualSize(s).w), 1),
    [items],
  )
  const previewRows = useMemo(
    () => Math.max(GRID_ROWS, ...items.map((s) => s.posY + visualSize(s).h), 1),
    [items],
  )
  useEffect(() => {
    if (fullscreen) return
    const el = previewRef.current
    if (!el) return
    const fit = () => {
      const w = el.clientWidth - 28
      const h = el.clientHeight - 28
      if (w > 0 && h > 0) {
        setPreviewScale(Math.min(w / (previewCols * CELL), h / (previewRows * CELL)))
      }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    window.addEventListener('resize', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [fullscreen, previewCols, previewRows])

  const cellPx = CELL * scale

  const selected = items.find((s) => s.id === selectedId) ?? null
  const editShelf = editingId !== null ? shelves.find((s) => s.id === editingId) ?? null : null
  // Estantería seleccionada con sus categorías (las trae `shelves`, no el mapa).
  const selectedShelf = selected ? shelves.find((s) => s.id === selected.id) ?? null : null

  const unplacedCount = useMemo(
    () => items.filter((s) => s.posX === 0 && s.posY === 0).length,
    [items],
  )

  // Coordenadas del puntero en el sistema del CONTENIDO (con scroll y escala)
  function contentPos(e: React.PointerEvent) {
    const canvas = containerRef.current
    if (!canvas) return { x: 0, y: 0 }
    const cr = canvas.getBoundingClientRect()
    return {
      x: e.clientX - cr.left + canvas.scrollLeft,
      y: e.clientY - cr.top + canvas.scrollTop,
    }
  }

  function onPointerDown(e: React.PointerEvent, id: number) {
    e.stopPropagation()
    const shelf = items.find((s) => s.id === id)
    if (!shelf) return
    const p = contentPos(e)
    // El offset se calcula en coordenadas del contenido (grid * cellPx),
    // para que la estantería quede pegada al cursor.
    dragRef.current = {
      id,
      dx: p.x - shelf.posX * cellPx,
      dy: p.y - shelf.posY * cellPx,
    }
    setSelectedId(id)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    // ¿Redimensionando?
    if (resizeRef.current) {
      onResizeMove(e)
      return
    }
    const drag = dragRef.current
    if (!drag) return
    const p = contentPos(e)
    setItems((prev) =>
      prev.map((s) => {
        if (s.id !== drag.id) return s
        const { w, h } = visualSize(s)
        const gx = Math.max(0, Math.min(GRID_COLS - w, Math.round((p.x - drag.dx) / cellPx)))
        const gy = Math.max(0, Math.min(GRID_ROWS - h, Math.round((p.y - drag.dy) / cellPx)))
        return { ...s, posX: gx, posY: gy, autoPlaced: false }
      }),
    )
  }

  function endDrag() {
    dragRef.current = null
    resizeRef.current = null
  }

  // ── Redimensionar ancho/alto arrastrando las manijas ────────────────────────

  function onResizeStart(e: React.PointerEvent, id: number, edge: 'e' | 's' | 'se') {
    e.stopPropagation()
    const shelf = items.find((s) => s.id === id)
    if (!shelf) return
    const p = contentPos(e)
    const { w, h } = visualSize(shelf)
    resizeRef.current = {
      id,
      edge,
      startX: p.x,
      startY: p.y,
      startW: w,
      startH: h,
      rotation: shelf.rotation,
    }
    setSelectedId(id)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onResizeMove(e: React.PointerEvent) {
    const rz = resizeRef.current
    if (!rz) return
    const p = contentPos(e)
    setItems((prev) =>
      prev.map((s) => {
        if (s.id !== rz.id) return s
        const dW = Math.round((p.x - rz.startX) / cellPx)
        const dH = Math.round((p.y - rz.startY) / cellPx)
        let nW = rz.startW
        let nH = rz.startH
        if (rz.edge === 'e' || rz.edge === 'se') nW = rz.startW + dW
        if (rz.edge === 's' || rz.edge === 'se') nH = rz.startH + dH
        // Máximo visual desde la esquina anclada (arriba-izquierda del rectángulo)
        const maxVW = GRID_COLS - s.posX
        const maxVH = GRID_ROWS - s.posY
        nW = Math.max(1, Math.min(maxVW, nW))
        nH = Math.max(1, Math.min(maxVH, nH))
        // Convertir dimensiones visuales → dimensiones de la estantería (rotación)
        return {
          ...s,
          width: rz.rotation === 90 ? nH : nW,
          height: rz.rotation === 90 ? nW : nH,
          autoPlaced: false,
        }
      }),
    )
  }

  function rotateSelected() {
    if (!selected) return
    setItems((prev) =>
      prev.map((s) => {
        if (s.id !== selected.id) return s
        const rot = s.rotation === 90 ? 0 : 90
        const { w, h } = visualSize({ ...s, rotation: rot })
        return {
          ...s,
          rotation: rot,
          posX: Math.min(s.posX, GRID_COLS - w),
          posY: Math.min(s.posY, GRID_ROWS - h),
          autoPlaced: false,
        }
      }),
    )
  }

  function setDim(key: 'width' | 'height', value: number) {
    if (!selected) return
    setItems((prev) =>
      prev.map((s) => {
        if (s.id !== selected.id) return s
        const next = { ...s, [key]: Math.max(1, Math.min(key === 'width' ? GRID_COLS : GRID_ROWS, value)) }
        const { w, h } = visualSize(next)
        return {
          ...next,
          posX: Math.min(next.posX, GRID_COLS - w),
          posY: Math.min(next.posY, GRID_ROWS - h),
          autoPlaced: false,
        }
      }),
    )
  }

  async function saveAll() {
    setSaving(true)
    let ok = 0
    try {
      for (const s of items) {
        await api.updateShelf(s.id, {
          width: s.width,
          height: s.height,
          posX: s.posX,
          posY: s.posY,
          rotation: s.rotation,
        })
        ok++
      }
      notify(`Mapa guardado (${ok} estanterías)`)
      onRefresh()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error guardando el mapa')
    } finally {
      setSaving(false)
      setAutoSeeded(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <p className="text-white/40 text-sm font-medium">
          Bodega de {items.length} estantería(s)
          {unplacedCount > 0 && <span className="text-amber-400"> · {unplacedCount} sin ubicar</span>}
        </p>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setFullscreen(true)}
            className="px-4 py-2 rounded-xl bg-amber-400 text-on-accent text-sm font-extrabold flex items-center gap-2"
            title="Abrir el editor del mapa"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Editar mapa
          </button>
        </div>
      </div>

      {autoSeeded && (
        <p className="text-white/30 text-xs font-medium mb-3">
          Las estanterías sin posición se colocaron automáticamente. Ábrelas en el editor y guarda.
        </p>
      )}

      {/* Miniatura: bodega completa; al hacer clic se abre el editor. */}
      {!fullscreen && (
        <button
          type="button"
          id="map-preview"
          ref={previewRef}
          onClick={() => setFullscreen(true)}
          title="Abrir el editor del mapa"
          className="group relative block w-full rounded-2xl border border-white/10 bg-surface-alt overflow-hidden cursor-pointer hover:border-amber-400/60 transition-colors"
          style={{ height: PREVIEW_H }}
        >
          <span className="absolute inset-0 flex items-center justify-center">
            <span
              className="relative block"
              style={{
                width: previewCols * CELL * previewScale,
                height: previewRows * CELL * previewScale,
                backgroundImage: `
                  linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)
                `,
                backgroundSize: `${CELL * previewScale}px ${CELL * previewScale}px`,
              }}
            >
              {/* Paredes */}
              <span className="absolute top-0 left-0 right-0 bg-white/20" style={{ height: 2 }} />
              <span className="absolute top-0 left-0 bottom-0 bg-white/20" style={{ width: 2 }} />
              <span className="absolute top-0 right-0 bottom-0 bg-white/20" style={{ width: 2 }} />
              <span className="absolute bottom-0 left-0 right-0 bg-white/20" style={{ height: 2 }} />

              {items.map((s) => {
                const { w, h } = visualSize(s)
                const cw = w * CELL * previewScale
                return (
                  <span
                    key={s.id}
                    className="absolute rounded-[3px] flex items-center justify-center overflow-hidden"
                    style={{
                      left: s.posX * CELL * previewScale,
                      top: s.posY * CELL * previewScale,
                      width: cw,
                      height: h * CELL * previewScale,
                      backgroundColor: s.color + '2E',
                      border: `1px solid ${s.color}`,
                    }}
                  >
                    {cw > 34 && (
                      <span className="text-white font-bold truncate px-0.5" style={{ fontSize: 8 }}>
                        {s.code}
                      </span>
                    )}
                  </span>
                )
              })}
            </span>
          </span>

          <span className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-black/55 text-white text-[11px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
            Editar
          </span>
        </button>
      )}

      {/* Barra flotante del editor (pantalla completa, sólo el mapa). */}
      {fullscreen && (
        <div className="fixed top-0 left-0 right-0 z-[55] h-14 flex items-center gap-3 px-4 bg-app border-b border-white/10">
          <span className="font-extrabold">Mapa de la bodega</span>
          <span className="text-white/40 text-xs font-medium hidden sm:inline">
            Arrastra y ajusta cada estantería; guarda al terminar
          </span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={saveAll}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-amber-400 text-on-accent text-sm font-extrabold disabled:opacity-40"
            >
              {saving ? 'Guardando…' : 'Guardar mapa'}
            </button>
            <button
              onClick={() => setFullscreen(false)}
              title="Cerrar (Esc)"
              className="px-3 py-2 rounded-xl bg-white/10 text-sm font-bold"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Cuadro de la bodega (editor): sólo existe a pantalla completa. */}
      {fullscreen && (
      <div
        id="map-canvas"
        ref={containerRef}
        className="fixed left-0 right-0 bottom-0 top-14 z-50 overflow-auto bg-surface-alt"
        style={{ minHeight: 280 }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <div
          className="relative"
          style={{
            width: GRID_COLS * cellPx,
            height: GRID_ROWS * cellPx,
            backgroundImage: `
              linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)
            `,
            backgroundSize: `${cellPx}px ${cellPx}px`,
          }}
        >
          {/* Paredes */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-white/20" />
          <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-white/20" />
          <div className="absolute top-0 right-0 bottom-0 w-1.5 bg-white/20" />
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20" />

          {/* Etiqueta de la bodega */}
          <span
            className="absolute top-3 left-1/2 -translate-x-1/2 text-white/20 font-extrabold tracking-[0.3em] uppercase pointer-events-none select-none"
            style={{ fontSize: Math.max(8, 10 * scale) }}
          >
            Bodega
          </span>

          {items.map((s) => {
            const { w, h } = visualSize(s)
            const isSelected = s.id === selectedId
            // El botón flotante del contenido se coloca arriba o abajo según el sitio.
            const placeAbove = s.posY * cellPx > 44
            return (
              <div
                key={s.id}
                onPointerDown={(e) => onPointerDown(e, s.id)}
                className={`absolute rounded-md flex items-center justify-center select-none touch-none cursor-grab active:cursor-grabbing transition-shadow ${
                  isSelected ? 'ring-2 ring-white' : ''
                }`}
                style={{
                  left: s.posX * cellPx,
                  top: s.posY * cellPx,
                  width: w * cellPx,
                  height: h * cellPx,
                  backgroundColor: s.color + '2E',
                  border: `1.5px solid ${s.color}`,
                  zIndex: isSelected ? 10 : 1,
                }}
              >
                <span
                  className="text-white font-extrabold truncate px-1 pointer-events-none"
                  style={{
                    fontSize: Math.min(13, Math.max(9, w * 3 * Math.max(0.8, scale))),
                    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                  }}
                >
                  {s.code}
                </span>
                {s.rotation === 90 && (
                  <span className="absolute top-0.5 right-1 text-white/40 text-[8px] font-bold pointer-events-none">90°</span>
                )}
                {/* Manijas de redimensionado (ancho/alto) — solo en la seleccionada */}
                {isSelected && (
                  <>
                    {/* Botón flotante para gestionar el contenido (categorías). */}
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingId(s.id)
                      }}
                      title="Editar el contenido (categorías)"
                      className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-1 rounded-lg bg-amber-400 text-on-accent text-[11px] font-extrabold shadow-lg flex items-center gap-1"
                      style={placeAbove ? { top: -34, zIndex: 30 } : { bottom: -34, zIndex: 30 }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                        <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                      Editar contenido
                    </button>
                    <div
                      onPointerDown={(e) => onResizeStart(e, s.id, 'e')}
                      className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-6 rounded-sm bg-amber-400 border border-app cursor-ew-resize touch-none"
                      style={{ zIndex: 20 }}
                    />
                    <div
                      onPointerDown={(e) => onResizeStart(e, s.id, 's')}
                      className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-6 h-3 rounded-sm bg-amber-400 border border-app cursor-ns-resize touch-none"
                      style={{ zIndex: 20 }}
                    />
                    <div
                      onPointerDown={(e) => onResizeStart(e, s.id, 'se')}
                      className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-sm bg-amber-400 border border-app cursor-nwse-resize touch-none"
                      style={{ zIndex: 20 }}
                    />
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
      )}

      {/* Controles de la estantería seleccionada (flotantes en el editor). */}
      {fullscreen && selected && (
        <div className="fixed bottom-4 left-4 z-[56] bg-surface border border-white/10 rounded-2xl p-3 shadow-xl max-w-[calc(100vw-2rem)]">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selected.color }} />
            <span className="font-extrabold text-sm">{selected.code} · {selected.name}</span>
            <span className="text-white/40 text-[11px] font-medium ml-auto">
              X {selected.posX} · Y {selected.posY}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-white/40 text-xs font-semibold">Ancho</span>
              <DimInput value={selected.width} max={GRID_COLS} onCommit={(v) => setDim('width', v)} />
            </label>
            <label className="block">
              <span className="text-white/40 text-xs font-semibold">Alto</span>
              <DimInput value={selected.height} max={GRID_ROWS} onCommit={(v) => setDim('height', v)} />
            </label>
            <button
              onClick={rotateSelected}
              className="px-4 py-2 rounded-xl bg-white/10 text-sm font-bold"
            >
              Girar {selected.rotation === 90 ? 'a 0°' : 'a 90°'}
            </button>
          </div>

          {/* Contenido de la estantería: categorías asociadas. */}
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-white/10">
            <span className="text-white/40 text-xs font-semibold">Categorías</span>
            {selectedShelf && selectedShelf.categories.length > 0 ? (
              selectedShelf.categories.map((c) => (
                <span
                  key={c.id}
                  className="px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-300 text-[10px] font-bold"
                >
                  {c.name}
                </span>
              ))
            ) : (
              <span className="text-white/30 text-[11px] font-medium">Sin categorías</span>
            )}
            <button
              onClick={() => setEditingId(selected.id)}
              className="ml-auto px-3 py-1.5 rounded-lg bg-amber-400 text-on-accent text-xs font-extrabold"
            >
              Asociar categorías
            </button>
          </div>
        </div>
      )}

      {editShelf && (
        <ShelfCategoriesModal
          shelf={editShelf}
          shelves={shelves}
          categories={categories}
          notify={notify}
          onClose={() => setEditingId(null)}
          onSaved={onRefresh}
        />
      )}
    </div>
  )
}

// ─── Modal: contenido (categorías) de una estantería ─────────────────────────

/**
 * Editor de una estantería desde el mapa: permite cambiar su nombre y asociarle
 * las categorías de productos que guarda (relación N:M).
 */
function ShelfCategoriesModal({
  shelf,
  shelves,
  categories,
  notify,
  onClose,
  onSaved,
}: {
  shelf: Shelf
  shelves: Shelf[]
  categories: Category[]
  notify: (m: string) => void
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(shelf.name)
  const [selectedIds, setSelectedIds] = useState<number[]>(shelf.categories.map((c) => c.id))
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Categorías ya guardadas en esta estantería: quitarlas pide confirmación,
  // y añadir una que ya vive en otra estantería también avisa (se permite).
  const savedIds = shelf.categories.map((c) => c.id)
  const { pending, requestCategoryChange, confirm, cancel } = useCategoryChangeConfirm({
    shelves,
    shelfId: shelf.id,
    savedIds,
    isSelected: (id) => selectedIds.includes(id),
    toggle: (id, next) =>
      setSelectedIds((prev) =>
        next ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id),
      ),
  })

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('El nombre de la estantería no puede estar vacío')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.updateShelf(shelf.id, { name: trimmed, categoryIds: selectedIds })
      notify(`${shelf.code} actualizada`)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la estantería')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[92dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-4 pb-3 border-b border-white/8 flex items-center justify-between">
          <div>
            <h2 className="font-extrabold text-lg">Editar {shelf.code}</h2>
            <p className="text-white/40 text-xs font-medium mt-0.5">
              Cambia el nombre y asocia las categorías de productos de la estantería.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"
            title="Cerrar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <label className="flex flex-col gap-1.5">
            <span className="text-white/40 text-[11px] font-bold uppercase tracking-wider">Nombre</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre de la estantería"
              className="w-full bg-app border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
          </label>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar categoría…"
            className="w-full bg-app border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
          />

          {selectedIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedIds.map((id) => {
                const c = categories.find((x) => x.id === id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => requestCategoryChange(id, c?.name ?? `#${id}`)}
                    title="Quitar"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-400/15 border border-amber-400/30 text-amber-300 text-[11px] font-bold"
                  >
                    {c?.name ?? `#${id}`}
                    <span className="text-amber-300/70">×</span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="max-h-64 overflow-y-auto rounded-xl border border-white/10 py-1 [scrollbar-gutter:stable]">
            <CategoryTree
              categories={categories}
              selectedIds={selectedIds}
              onToggle={(c) => requestCategoryChange(c.id, c.name)}
              query={search}
              emptyLabel="Sin categorías."
            />
          </div>

          {error && <p className="text-red-400 text-xs font-medium">{error}</p>}
        </div>

        <div className="shrink-0 border-t border-white/8 px-5 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-3 rounded-xl bg-amber-400 text-on-accent text-sm font-extrabold disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {pending && <CategoryChangeConfirm pending={pending} onConfirm={confirm} onCancel={cancel} />}
    </div>
  )
}
