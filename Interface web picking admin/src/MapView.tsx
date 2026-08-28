import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from './services/api'
import type { Shelf } from './types'

// ─── Constantes de la bodega ─────────────────────────────────────────────────

const CELL = 36 // px por celda de la rejilla
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
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null)

  useEffect(() => {
    setItems(seedShelves(shelves))
    setSelectedId(null)
    setAutoSeeded(true)
  }, [shelves])

  const selected = items.find((s) => s.id === selectedId) ?? null

  const unplacedCount = useMemo(
    () => items.filter((s) => s.posX === 0 && s.posY === 0).length,
    [items],
  )

  function onPointerDown(e: React.PointerEvent, id: number) {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const canvas = document.getElementById('map-canvas')!
    const cr = canvas.getBoundingClientRect()
    const px = e.clientX - cr.left + canvas.scrollLeft
    const py = e.clientY - cr.top + canvas.scrollTop
    dragRef.current = {
      id,
      dx: px - rect.left,
      dy: py - rect.top,
    }
    setSelectedId(id)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const canvas = document.getElementById('map-canvas')!
    const cr = canvas.getBoundingClientRect()
    const px = e.clientX - cr.left + canvas.scrollLeft
    const py = e.clientY - cr.top + canvas.scrollTop
    setItems((prev) =>
      prev.map((s) => {
        if (s.id !== drag.id) return s
        const { w, h } = visualSize(s)
        const gx = Math.max(0, Math.min(GRID_COLS - w, Math.round((px - drag.dx) / CELL)))
        const gy = Math.max(0, Math.min(GRID_ROWS - h, Math.round((py - drag.dy) / CELL)))
        return { ...s, posX: gx, posY: gy, autoPlaced: false }
      }),
    )
  }

  function endDrag() {
    dragRef.current = null
  }

  function rotateSelected() {
    if (!selected) return
    setItems((prev) =>
      prev.map((s) => {
        if (s.id !== selected.id) return s
        const rot = s.rotation === 90 ? 0 : 90
        // al girar, mantener dentro del cuadro
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
        <p className="text-white/40 text-sm font-500">
          Arrastra cada estantería para ubicarla dentro de la bodega ·{' '}
          {items.length} estantería(s)
          {unplacedCount > 0 && <span className="text-amber-400"> · {unplacedCount} sin ubicar</span>}
        </p>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setItems(seedShelves(shelves.map((s) => ({ ...s, posX: 0, posY: 0 }))))}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-700"
          >
            Re-acomodar
          </button>
          <button
            onClick={saveAll}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-amber-400 text-[#0C0C0D] text-sm font-800 disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Guardar mapa'}
          </button>
        </div>
      </div>

      {autoSeeded && (
        <p className="text-white/30 text-xs font-500 mb-3">
          Las estanterías sin posición se colocaron automáticamente. Muévelas y guarda.
        </p>
      )}

      {/* Cuadro de la bodega */}
      <div
        id="map-canvas"
        className="relative overflow-auto rounded-2xl border border-white/10 bg-[#111113]"
        style={{ maxHeight: '70dvh' }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <div
          className="relative"
          style={{
            width: BOX_W,
            height: BOX_H,
            backgroundImage: `
              linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)
            `,
            backgroundSize: `${CELL}px ${CELL}px`,
          }}
        >
          {/* Paredes */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-white/20" />
          <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-white/20" />
          <div className="absolute top-0 right-0 bottom-0 w-1.5 bg-white/20" />
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20" />

          {/* Etiqueta de la bodega */}
          <span className="absolute top-3 left-1/2 -translate-x-1/2 text-white/20 text-[10px] font-800 tracking-[0.3em] uppercase pointer-events-none select-none">
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
                  left: s.posX * CELL,
                  top: s.posY * CELL,
                  width: w * CELL,
                  height: h * CELL,
                  backgroundColor: s.color + '2E',
                  border: `1.5px solid ${s.color}`,
                  zIndex: isSelected ? 10 : 1,
                }}
              >
                <span
                  className="text-white font-800 truncate px-1 pointer-events-none"
                  style={{ fontSize: Math.min(13, Math.max(9, w * 3)), textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                >
                  {s.code}
                </span>
                {s.rotation === 90 && (
                  <span className="absolute top-0.5 right-1 text-white/40 text-[8px] font-700 pointer-events-none">90°</span>
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
            <span className="font-800">{selected.code} · {selected.name}</span>
            <span className="text-white/40 text-xs font-500 ml-auto">
              Posición X {selected.posX} · Y {selected.posY}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="text-white/40 text-xs font-600">Ancho (celdas)</span>
              <input
                type="number"
                min={1}
                max={GRID_COLS}
                value={selected.width}
                onChange={(e) => setDim('width', Number(e.target.value) || 1)}
                className="mt-1 w-24 bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
              />
            </label>
            <label className="block">
              <span className="text-white/40 text-xs font-600">Alto (celdas)</span>
              <input
                type="number"
                min={1}
                max={GRID_ROWS}
                value={selected.height}
                onChange={(e) => setDim('height', Number(e.target.value) || 1)}
                className="mt-1 w-24 bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
              />
            </label>
            <button
              onClick={rotateSelected}
              className="px-4 py-2 rounded-xl bg-white/10 text-sm font-700"
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
