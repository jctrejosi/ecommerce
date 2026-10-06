import { useEffect, useMemo, useRef, useState } from 'react'
import type { Shelf } from './types'

// Misma rejilla base que el editor del mapa (MapView).
const CELL = 36
const GRID_COLS = 14
const GRID_ROWS = 28

interface ThumbShelf {
  id: number
  code: string
  color: string
  width: number
  height: number
  posX: number
  posY: number
  rotation: 0 | 90
}

function visualSize(s: ThumbShelf) {
  return s.rotation === 90
    ? { w: s.height, h: s.width }
    : { w: s.width, h: s.height }
}

/**
 * Coloca en la primera celda libre las estanterías sin posición guardada
 * (posX=0 y posY=0), para que la miniatura no las apile en la esquina.
 * Mismo criterio que la pestaña Mapa.
 */
function seedShelves(shelves: Shelf[]): ThumbShelf[] {
  const used = new Set<string>()
  const occupy = (s: ThumbShelf) => {
    const { w, h } = visualSize(s)
    for (let x = s.posX; x < s.posX + w; x++)
      for (let y = s.posY; y < s.posY + h; y++) used.add(`${x},${y}`)
  }
  const result: ThumbShelf[] = []
  for (const s of shelves) {
    const m: ThumbShelf = {
      id: s.id,
      code: s.code,
      color: s.color,
      width: s.width,
      height: s.height,
      posX: s.posX,
      posY: s.posY,
      rotation: s.rotation,
    }
    if (m.posX === 0 && m.posY === 0) {
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
    occupy(m)
    result.push(m)
  }
  return result
}

/**
 * Miniatura de la bodega (solo lectura). Dibuja todas las estanterías de la
 * sucursal escaladas al contenedor y, opcionalmente, hace **titilar** las que se
 * pasen en `highlightIds` (p. ej. la estantería de un producto).
 */
export default function ShelfMapThumbnail({
  shelves,
  highlightIds = [],
  className = '',
}: {
  shelves: Shelf[]
  highlightIds?: number[]
  className?: string
}) {
  const items = useMemo(() => seedShelves(shelves), [shelves])
  const highlights = useMemo(() => new Set(highlightIds), [highlightIds])

  const cols = useMemo(
    () => Math.max(GRID_COLS, ...items.map((s) => s.posX + visualSize(s).w), 1),
    [items],
  )
  const rows = useMemo(
    () => Math.max(GRID_ROWS, ...items.map((s) => s.posY + visualSize(s).h), 1),
    [items],
  )

  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.3)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const fit = () => {
      const w = el.clientWidth - 24
      const h = el.clientHeight - 24
      if (w > 0 && h > 0) {
        setScale(Math.min(w / (cols * CELL), h / (rows * CELL)))
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
  }, [cols, rows])

  return (
    <div
      ref={boxRef}
      className={`relative w-full h-full flex items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-surface-alt ${className}`}
    >
      <div
        className="relative"
        style={{
          width: cols * CELL * scale,
          height: rows * CELL * scale,
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)
          `,
          backgroundSize: `${CELL * scale}px ${CELL * scale}px`,
        }}
      >
        {/* Paredes */}
        <span className="absolute top-0 left-0 right-0 bg-white/20" style={{ height: 2 }} />
        <span className="absolute top-0 left-0 bottom-0 bg-white/20" style={{ width: 2 }} />
        <span className="absolute top-0 right-0 bottom-0 bg-white/20" style={{ width: 2 }} />
        <span className="absolute bottom-0 left-0 right-0 bg-white/20" style={{ height: 2 }} />

        {items.map((s) => {
          const { w, h } = visualSize(s)
          const cw = w * CELL * scale
          const hot = highlights.has(s.id)
          return (
            <span
              key={s.id}
              className={`absolute rounded-[3px] flex items-center justify-center overflow-hidden ${
                hot ? 'shelf-blink' : ''
              }`}
              style={{
                left: s.posX * CELL * scale,
                top: s.posY * CELL * scale,
                width: cw,
                height: h * CELL * scale,
                backgroundColor: hot ? s.color + '99' : s.color + '2E',
                border: `${hot ? 2 : 1}px solid ${hot ? '#fbbf24' : s.color}`,
                zIndex: hot ? 2 : 1,
              }}
            >
              {cw > 30 && (
                <span
                  className={`truncate px-0.5 ${hot ? 'text-white font-extrabold' : 'text-white font-bold'}`}
                  style={{ fontSize: hot ? 9 : 8 }}
                >
                  {s.code}
                </span>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
