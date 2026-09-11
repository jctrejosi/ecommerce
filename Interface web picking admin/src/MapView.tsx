import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from './services/api'
import type { Shelf } from './types'

// ─── Constantes de la bodega ─────────────────────────────────────────────────

const CELL = 36 // px base por celda (luego se escala para llenar el espacio)
const GRID_COLS = 14 // ancho del cuadro de la bodega (celdas)
const GRID_ROWS = 28 // alto del cuadro de la bodega (celdas)
const BOX_W = GRID_COLS * CELL
const BOX_H = GRID_ROWS * CELL

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
      className="mt-1 w-24 bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
    />
  )
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function MapView({
  branchId,
  shelves,
  onRefresh,
  notify,
}: {
  branchId: number
  shelves: Shelf[]
  onRefresh: () => void
  notify: (m: string) => void
}) {
  const [items, setItems] = useState<MapShelf[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [autoSeeded, setAutoSeeded] = useState(false)
  const [scale, setScale] = useState(1)
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

  useEffect(() => {
    setItems(seedShelves(shelves))
    setSelectedId(null)
    setAutoSeeded(true)
  }, [shelves])

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
  }, [])

  const cellPx = CELL * scale

  const selected = items.find((s) => s.id === selectedId) ?? null

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
          Arrastra cada estantería para ubicarla dentro de la bodega ·{' '}
          {items.length} estantería(s)
          {unplacedCount > 0 && <span className="text-amber-400"> · {unplacedCount} sin ubicar</span>}
        </p>
        <div className="ml-auto flex gap-2">
          <button
            onClick={saveAll}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-amber-400 text-[#0C0C0D] text-sm font-extrabold disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Guardar mapa'}
          </button>
        </div>
      </div>

      {autoSeeded && (
        <p className="text-white/30 text-xs font-medium mb-3">
          Las estanterías sin posición se colocaron automáticamente. Muévelas y guarda.
        </p>
      )}

      {/* Cuadro de la bodega — ocupa el espacio disponible (escala automática) */}
      <div
        id="map-canvas"
        ref={containerRef}
        className="relative overflow-auto rounded-2xl border border-white/10 bg-[#111113]"
        style={{ height: 'calc(100dvh - 250px)', minHeight: 280 }}
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
                    <div
                      onPointerDown={(e) => onResizeStart(e, s.id, 'e')}
                      className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-6 rounded-sm bg-amber-400 border border-[#0C0C0D] cursor-ew-resize touch-none"
                      style={{ zIndex: 20 }}
                    />
                    <div
                      onPointerDown={(e) => onResizeStart(e, s.id, 's')}
                      className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-6 h-3 rounded-sm bg-amber-400 border border-[#0C0C0D] cursor-ns-resize touch-none"
                      style={{ zIndex: 20 }}
                    />
                    <div
                      onPointerDown={(e) => onResizeStart(e, s.id, 'se')}
                      className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-sm bg-amber-400 border border-[#0C0C0D] cursor-nwse-resize touch-none"
                      style={{ zIndex: 20 }}
                    />
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Panel de la estantería seleccionada */}
      {selected ? (
        <div className="mt-4 bg-[#161618] border border-white/10 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: selected.color }} />
            <span className="font-extrabold">{selected.code} · {selected.name}</span>
            <span className="text-white/40 text-xs font-medium ml-auto">
              Posición X {selected.posX} · Y {selected.posY}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="text-white/40 text-xs font-semibold">Ancho (celdas)</span>
              <DimInput value={selected.width} max={GRID_COLS} onCommit={(v) => setDim('width', v)} />
            </label>
            <label className="block">
              <span className="text-white/40 text-xs font-semibold">Alto (celdas)</span>
              <DimInput value={selected.height} max={GRID_ROWS} onCommit={(v) => setDim('height', v)} />
            </label>
            <button
              onClick={rotateSelected}
              className="px-4 py-2 rounded-xl bg-white/10 text-sm font-bold"
            >
              Girar {selected.rotation === 90 ? 'a 0°' : 'a 90°'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-white/30 text-sm mt-4">Toca una estantería para ajustar su tamaño o girarla.</p>
      )}
    </div>
  )
}
