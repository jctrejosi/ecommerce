import type { CatalogProduct, Shelf } from './types'
import ShelfMapThumbnail from './ShelfMapThumbnail'

/**
 * Detalle de un producto del catálogo (pestaña Productos).
 *
 * A la izquierda los datos del producto; a la derecha la miniatura del mapa de
 * la sucursal con la(s) estantería(s) del producto **titilando**. La ubicación
 * no se asigna al producto: viene de sus categorías.
 */
export default function ProductDetailModal({
  product,
  shelves,
  onClose,
}: {
  product: CatalogProduct
  shelves: Shelf[]
  onClose: () => void
}) {
  const highlightIds = product.shelves.map((s) => s.id)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-5xl bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[92dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="px-5 pt-4 pb-3 border-b border-white/10 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2 className="font-extrabold text-lg truncate">{product.productName}</h2>
            <p className="text-white/40 text-xs font-medium mt-0.5">
              Información de referencia · la ubicación la determina la categoría
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="w-8 h-8 shrink-0 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Cuerpo: detalles | miniatura del mapa */}
        <div className="flex-1 min-h-0 overflow-y-auto grid md:grid-cols-2 gap-0 md:gap-5 p-5">
          {/* Detalles */}
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <DetailField label="SKU" value={product.sku ?? '—'} />
              <DetailField label="Código de barras" value={product.barcode ?? 'sin código'} />
              <DetailField label="Stock" value={String(product.stock)} />
              <DetailField
                label="Estanterías"
                value={product.shelves.length > 0 ? String(product.shelves.length) : 'Ninguna'}
              />
            </div>

            <div>
              <p className="text-white/40 text-[11px] font-bold uppercase tracking-wider mb-2">
                Categorías del producto
              </p>
              <div className="flex flex-wrap gap-1.5">
                {product.categories.length > 0 ? (
                  product.categories.map((c) => (
                    <span
                      key={c.id}
                      className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/60 text-[11px] font-semibold"
                    >
                      {c.name}
                    </span>
                  ))
                ) : (
                  <span className="text-white/30 text-xs font-medium">Sin categoría</span>
                )}
              </div>
            </div>

            <div>
              <p className="text-white/40 text-[11px] font-bold uppercase tracking-wider mb-2">
                Ubicación en la bodega
              </p>
              <div className="flex flex-wrap gap-1.5">
                {product.shelves.length > 0 ? (
                  product.shelves.map((s) => (
                    <span
                      key={s.id}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-400/10 border border-amber-400/40 text-amber-300 text-[11px] font-bold"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                      {s.code} · {s.name}
                    </span>
                  ))
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-white/5 border border-dashed border-white/15 text-white/35 text-[11px] font-semibold">
                    Sin estantería asignada
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Miniatura del mapa */}
          <div className="mt-5 md:mt-0 flex flex-col">
            <p className="text-white/40 text-[11px] font-bold uppercase tracking-wider mb-2">
              Bodega de la sucursal
            </p>
            {product.shelves.length > 0 ? (
              <>
                <div className="h-[300px] md:h-[420px]">
                  <ShelfMapThumbnail shelves={shelves} highlightIds={highlightIds} />
                </div>
                <p className="text-white/35 text-[11px] font-medium mt-2 flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm shelf-blink" style={{ background: '#fbbf24' }} />
                  Estantería(s) del producto, titilando.
                </p>
              </>
            ) : (
              <div className="flex-1 min-h-[220px] flex items-center justify-center rounded-2xl border border-dashed border-white/15 text-center px-6">
                <p className="text-white/35 text-sm font-medium">
                  Este producto no tiene estantería: ninguna de sus categorías está
                  asociada a una estantería.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-app border border-white/10 rounded-xl px-3 py-2.5">
      <p className="text-white/40 text-[10px] font-bold uppercase tracking-wider">{label}</p>
      <p className="font-bold text-sm mt-0.5 truncate" title={value}>
        {value}
      </p>
    </div>
  )
}
