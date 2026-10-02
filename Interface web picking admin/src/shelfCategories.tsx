import { useState } from 'react'
import type { Shelf } from './types'

/**
 * Reglas de asignación de categorías a estanterías (relación N:M).
 *
 * Una misma categoría puede vivir en varias estanterías, pero como eso casi
 * siempre es un descuido, la UI interpone una confirmación. Lo mismo al quitar
 * una categoría que ya estaba guardada, porque es un cambio destructivo.
 */

/** Otras estanterías (distintas de `excludeShelfId`) que ya contienen la categoría. */
export function shelvesWithCategory(
  shelves: Shelf[],
  categoryId: number,
  excludeShelfId: number | null,
): Shelf[] {
  return shelves.filter(
    (s) => s.id !== excludeShelfId && s.categories.some((c) => c.id === categoryId),
  )
}

export interface PendingCategoryChange {
  categoryId: number
  categoryName: string
  action: 'add' | 'remove'
  /** Estanterías donde la categoría ya está (sólo para `add`). */
  otherShelves: Shelf[]
}

/**
 * Interpone la confirmación antes de un cambio de categorías.
 * `toggle` aplica el cambio real; el hook sólo decide si hay que preguntar.
 */
export function useCategoryChangeConfirm({
  shelves,
  shelfId,
  savedIds,
  isSelected,
  toggle,
}: {
  shelves: Shelf[]
  /** Estantería que se está editando (null al crear una nueva). */
  shelfId: number | null
  /** Categorías ya persistidas en esta estantería. */
  savedIds: number[]
  isSelected: (id: number) => boolean
  toggle: (id: number, next: boolean) => void
}) {
  const [pending, setPending] = useState<PendingCategoryChange | null>(null)

  function requestCategoryChange(id: number, name: string) {
    if (isSelected(id)) {
      // Quitar una categoría recién marcada no necesita confirmación;
      // quitar una que ya estaba guardada sí.
      if (!savedIds.includes(id)) {
        toggle(id, false)
        return
      }
      setPending({ categoryId: id, categoryName: name, action: 'remove', otherShelves: [] })
      return
    }
    const otherShelves = shelvesWithCategory(shelves, id, shelfId)
    if (otherShelves.length > 0) {
      setPending({ categoryId: id, categoryName: name, action: 'add', otherShelves })
    } else {
      toggle(id, true)
    }
  }

  function confirm() {
    if (!pending) return
    toggle(pending.categoryId, pending.action === 'add')
    setPending(null)
  }

  return { pending, requestCategoryChange, confirm, cancel: () => setPending(null) }
}

/** Overlay de confirmación para los cambios anteriores. */
export function CategoryChangeConfirm({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingCategoryChange
  onConfirm: () => void
  onCancel: () => void
}) {
  const adding = pending.action === 'add'
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-surface border border-white/10 rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-extrabold text-base">
          {adding ? 'Categoría ya asignada' : 'Quitar categoría'}
        </h3>
        <p className="text-white/60 text-sm mt-2 leading-relaxed">
          {adding ? (
            <>
              <span className="font-bold text-white/80">«{pending.categoryName}»</span> ya tiene una
              estantería asignada
              {pending.otherShelves.length > 0
                ? ` (${pending.otherShelves.map((s) => s.code).join(', ')})`
                : ''}
              . ¿Deseas asignarla también a esta estantería?
            </>
          ) : (
            <>
              ¿Quitar <span className="font-bold text-white/80">«{pending.categoryName}»</span> de
              esta estantería?
            </>
          )}
        </p>
        <div className="flex gap-3 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-amber-400 text-on-accent text-sm font-extrabold"
          >
            {adding ? 'Asignar igualmente' : 'Quitar'}
          </button>
        </div>
      </div>
    </div>
  )
}
