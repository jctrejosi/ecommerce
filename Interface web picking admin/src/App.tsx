import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from './services/api'
import type { Branch, ProductWithLocation, Shelf, ShelfRow, ShelfType } from './types'
import MapView from './MapView'
import MetricsView from './MetricsView'

// ─── Constantes ───────────────────────────────────────────────────────────────

const COLORS = [
  '#3B82F6', '#EF4444', '#22C55E', '#F59E0B', '#A855F7',
  '#06B6D4', '#F97316', '#EC4899', '#10B981', '#6B7280',
]

const INFINITE_STEP = 50 // lazy load: productos que se van agregando al hacer scroll

const emptyShelf = () => ({
  code: '',
  name: '',
  type: 'center' as ShelfType,
  color: COLORS[3],
  posX: 0,
  posY: 0,
  rotation: 0 as 0 | 90,
  rows: [] as { rowNumber: number; label: string }[],
})

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState<number | null>(null)
  const [tab, setTab] = useState<'shelves' | 'map' | 'products' | 'metrics'>('shelves')
  const [shelves, setShelves] = useState<Shelf[]>([])
  const [products, setProducts] = useState<ProductWithLocation[]>([])
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const notify = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }, [])

  // Sucursales
  useEffect(() => {
    api.branches()
      .then((bs) => {
        setBranches(bs)
        if (bs.length > 0) setBranchId((prev) => prev ?? bs[0].id)
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las sucursales'))
  }, [])

  // Estanterías de la sucursal seleccionada
  useEffect(() => {
    if (!branchId) return
    setLoading(true)
    api
      .shelves(branchId)
      .then(setShelves)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Error cargando estanterías'))
      .finally(() => setLoading(false))
  }, [branchId])

  const loadProducts = useCallback((branch: number, q: string) => {
    setLoading(true)
    api
      .products(branch, q)
      .then(setProducts)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Error cargando productos'))
      .finally(() => setLoading(false))
  }, [])

  // Productos al cambiar de sucursal
  useEffect(() => {
    if (!branchId) return
    setAppliedSearch('')
    setSearch('')
    loadProducts(branchId, '')
  }, [branchId, loadProducts])

  const branch = branches.find((b) => b.id === branchId) ?? null

  return (
    <div className="min-h-full bg-[#0C0C0D] text-white">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
          <div className="bg-amber-400 text-[#0C0C0D] font-700 text-sm rounded-xl px-4 py-3 shadow-lg">
            {toast}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0C0C0D]/90 backdrop-blur border-b border-white/8 px-5 pt-5 pb-4">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-4">
          <div className="mr-auto">
            <h1 className="text-2xl font-800 tracking-tight">Picking DSI <span className="text-amber-400">Admin</span></h1>
            <p className="text-white/40 text-xs font-500 mt-0.5">Estanterías y ubicaciones por sucursal</p>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => setBranchId(b.id)}
                className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-700 transition-all border ${
                  branchId === b.id
                    ? 'bg-amber-400 text-[#0C0C0D] border-amber-400'
                    : 'bg-white/5 text-white/50 border-white/10 hover:text-white/80'
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 pb-16">
        {/* Tabs */}
        <div className="flex gap-2 my-5">
          {(['shelves', 'map', 'products', 'metrics'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-full text-sm font-700 transition-all ${
                tab === t ? 'bg-white text-[#0C0C0D]' : 'bg-white/5 text-white/50 hover:text-white/80'
              }`}
            >
              {t === 'shelves' ? 'Estanterías' : t === 'map' ? 'Mapa' : t === 'products' ? 'Productos' : 'Métricas'}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm mb-5 flex items-center gap-3">
            <p className="flex-1">{error}</p>
            <button onClick={() => setError(null)} className="font-800 underline">Cerrar</button>
          </div>
        )}

        {tab === 'shelves' ? (
          <ShelvesView
            branchId={branchId}
            branchName={branch?.name ?? ''}
            shelves={shelves}
            loading={loading}
            onChanged={() => {
              if (branchId) api.shelves(branchId).then(setShelves).catch(() => undefined)
            }}
            notify={notify}
          />
        ) : tab === 'map' ? (
          branchId ? (
            <MapView
              branchId={branchId}
              shelves={shelves}
              onRefresh={() => {
                if (branchId) api.shelves(branchId).then(setShelves).catch(() => undefined)
              }}
              notify={notify}
            />
          ) : (
            <p className="text-white/40 text-sm">Selecciona una sucursal.</p>
          )
        ) : tab === 'metrics' ? (
          <MetricsView notify={notify} />
        ) : (
          <ProductsView
            branchId={branchId}
            shelves={shelves}
            products={products}
            loading={loading}
            search={search}
            setSearch={setSearch}
            appliedSearch={appliedSearch}
            setAppliedSearch={setAppliedSearch}
            onlyUnassigned={onlyUnassigned}
            setOnlyUnassigned={setOnlyUnassigned}
            onSearch={() => branchId && loadProducts(branchId, search)}
            onLocationChanged={(variantId, loc) => {
              setProducts((prev) =>
                prev.map((p) =>
                  p.productVariantId === variantId
                    ? {
                        ...p,
                        shelfId: loc ? loc.shelfId : null,
                        rowNumber: loc ? loc.rowNumber : null,
                        shelfCode: loc ? shelves.find((s) => s.id === loc.shelfId)?.code ?? null : null,
                        shelfName: loc ? shelves.find((s) => s.id === loc.shelfId)?.name ?? null : null,
                      }
                    : p,
                ),
              )
            }}
            notify={notify}
          />
        )}
      </main>
    </div>
  )
}

// ─── Estanterías ──────────────────────────────────────────────────────────────

function ShelvesView({
  branchId,
  branchName,
  shelves,
  loading,
  onChanged,
  notify,
}: {
  branchId: number | null
  branchName: string
  shelves: Shelf[]
  loading: boolean
  onChanged: () => void
  notify: (m: string) => void
}) {
  const [editing, setEditing] = useState<Shelf | null>(null)
  const [creating, setCreating] = useState(false)

  if (!branchId) {
    return <p className="text-white/40 text-sm">Selecciona una sucursal.</p>
  }

  async function handleSave(data: ReturnType<typeof emptyShelf>) {
    try {
      if (editing) {
        await api.updateShelf(editing.id, data)
        notify('Estantería actualizada')
      } else {
        await api.createShelf({ branchId, ...data })
        notify('Estantería creada')
      }
      setEditing(null)
      setCreating(false)
      onChanged()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error guardando la estantería')
    }
  }

  async function handleDelete(shelf: Shelf) {
    if (!confirm(`¿Eliminar la estantería ${shelf.code} (${shelf.name})? Se borran sus filas y ubicaciones.`)) return
    try {
      await api.deleteShelf(shelf.id)
      notify('Estantería eliminada')
      onChanged()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error eliminando')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-white/40 text-sm font-500">
          {loading ? 'Cargando…' : `${shelves.length} estanterías en ${branchName}`}
        </p>
        <button
          onClick={() => { setEditing(null); setCreating(true) }}
          className="px-4 py-2 rounded-xl bg-amber-400 text-[#0C0C0D] text-sm font-800 hover:bg-amber-300 transition-colors"
        >
          + Nueva estantería
        </button>
      </div>

      {shelves.length === 0 && !loading && (
        <div className="bg-white/5 border border-dashed border-white/15 rounded-2xl p-10 text-center">
          <p className="text-white/50 text-sm">Aún no hay estanterías para esta sucursal.</p>
          <p className="text-white/25 text-xs mt-1">Crea la primera para empezar a ubicar productos.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {shelves.map((s) => (
          <div key={s.id} className="bg-[#161618] border border-white/10 rounded-2xl overflow-hidden">
            <div className="h-1.5" style={{ backgroundColor: s.color }} />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-800 text-lg leading-tight">
                    <span className="text-white/40 font-700 mr-1.5">{s.code}</span>
                    {s.name}
                  </h3>
                  <p className="text-white/40 text-xs font-500 mt-0.5">
                    {s.type === 'wall' ? '🧱 Contra la pared' : '🏬 Isla central'} · {s.rows.length} fila(s) ·{' '}
                    {s.productCount} producto(s)
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => { setCreating(false); setEditing(s) }}
                    className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10"
                    title="Editar"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(s)}
                    className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center hover:bg-red-500/20"
                    title="Eliminar"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" stroke="#F87171" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
              {s.rows.length > 0 && (
                <div className="mt-3 space-y-1">
                  {s.rows.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-xs">
                      <span className="w-6 h-6 rounded-md flex items-center justify-center font-800 shrink-0" style={{ backgroundColor: s.color + '22', color: s.color }}>
                        {r.rowNumber}
                      </span>
                      <span className="text-white/60 font-500 truncate">{r.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <ShelfModal
          branchName={branchName}
          initial={editing ?? null}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ─── Modal editor de estantería ───────────────────────────────────────────────

function ShelfModal({
  branchName,
  initial,
  onClose,
  onSave,
}: {
  branchName: string
  initial: Shelf | null
  onClose: () => void
  onSave: (data: ReturnType<typeof emptyShelf>) => void
}) {
  const [form, setForm] = useState(() => ({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    type: (initial?.type ?? 'center') as ShelfType,
    color: initial?.color ?? COLORS[3],
    posX: initial?.posX ?? 0,
    posY: initial?.posY ?? 0,
    rotation: (initial?.rotation ?? 0) as 0 | 90,
    rows: initial ? initial.rows.map((r) => ({ rowNumber: r.rowNumber, label: r.label })) : [{ rowNumber: 1, label: '' }],
  }))

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function updateRow(idx: number, patch: Partial<{ rowNumber: number; label: string }>) {
    setForm((f) => ({
      ...f,
      rows: f.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }))
  }

  function addRow() {
    setForm((f) => ({
      ...f,
      rows: [...f.rows, { rowNumber: f.rows.length + 1, label: '' }],
    }))
  }

  function removeRow(idx: number) {
    setForm((f) => ({
      ...f,
      rows: f.rows.filter((_, i) => i !== idx).map((r, i) => ({ ...r, rowNumber: i + 1 })),
    }))
  }

  const valid = form.code.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg bg-[#161618] border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-[#161618] px-5 pt-4 pb-3 border-b border-white/8 flex items-center justify-between">
          <h2 className="font-800 text-lg">
            {initial ? `Editar ${initial.code}` : 'Nueva estantería'}
            <span className="block text-white/40 text-xs font-500">{branchName}</span>
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-white/40 text-xs font-600">Código *</span>
              <input
                value={form.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                placeholder="A1"
                className="mt-1 w-full bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm font-700 outline-none focus:border-amber-400"
              />
            </label>
            <label className="block">
              <span className="text-white/40 text-xs font-600">Nombre</span>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Lácteos"
                className="mt-1 w-full bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-white/40 text-xs font-600">Tipo</span>
              <select
                value={form.type}
                onChange={(e) => set('type', e.target.value as ShelfType)}
                className="mt-1 w-full bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              >
                <option value="wall">🧱 Contra la pared</option>
                <option value="center">🏬 Isla central</option>
              </select>
            </label>
            <label className="block">
              <span className="text-white/40 text-xs font-600">Rotación</span>
              <select
                value={form.rotation}
                onChange={(e) => set('rotation', Number(e.target.value) as 0 | 90)}
                className="mt-1 w-full bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              >
                <option value={0}>0° (horizontal)</option>
                <option value={90}>90° (vertical)</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-white/40 text-xs font-600">Posición X (celdas)</span>
              <input
                type="number"
                value={form.posX}
                onChange={(e) => set('posX', Number(e.target.value) || 0)}
                className="mt-1 w-full bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              />
            </label>
            <label className="block">
              <span className="text-white/40 text-xs font-600">Posición Y (celdas)</span>
              <input
                type="number"
                value={form.posY}
                onChange={(e) => set('posY', Number(e.target.value) || 0)}
                className="mt-1 w-full bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              />
            </label>
          </div>

          <div>
            <span className="text-white/40 text-xs font-600">Color</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => set('color', c)}
                  className="w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: form.color === c ? '#fff' : 'transparent',
                  }}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-white/40 text-xs font-600">Filas de la estantería</span>
              <button onClick={addRow} className="text-xs font-800 text-amber-400">+ Añadir fila</button>
            </div>
            <div className="space-y-2">
              {form.rows.map((r, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-xs font-800 shrink-0">
                    {r.rowNumber}
                  </span>
                  <input
                    value={r.label}
                    onChange={(e) => updateRow(idx, { label: e.target.value })}
                    placeholder={`Fila ${r.rowNumber}`}
                    className="flex-1 bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
                  />
                  <button
                    onClick={() => removeRow(idx)}
                    className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="#F87171" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-[#161618] border-t border-white/8 px-5 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-700"
          >
            Cancelar
          </button>
          <button
            onClick={() => valid && onSave(form)}
            disabled={!valid}
            className="flex-1 py-3 rounded-xl bg-amber-400 text-[#0C0C0D] text-sm font-800 disabled:opacity-40"
          >
            {initial ? 'Guardar cambios' : 'Crear estantería'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Productos / ubicaciones ──────────────────────────────────────────────────

function ProductsView({
  branchId,
  shelves,
  products,
  loading,
  search,
  setSearch,
  appliedSearch,
  setAppliedSearch,
  onlyUnassigned,
  setOnlyUnassigned,
  onSearch,
  onLocationChanged,
  notify,
}: {
  branchId: number | null
  shelves: Shelf[]
  products: ProductWithLocation[]
  loading: boolean
  search: string
  setSearch: (s: string) => void
  appliedSearch: string
  setAppliedSearch: (s: string) => void
  onlyUnassigned: boolean
  setOnlyUnassigned: (b: boolean) => void
  onSearch: () => void
  onLocationChanged: (variantId: number, loc: { shelfId: number; rowNumber: number } | null) => void
  notify: (m: string) => void
}) {
  const [visibleCount, setVisibleCount] = useState(INFINITE_STEP)
  const [bulkShelfId, setBulkShelfId] = useState<number | ''>('')
  const [bulkRow, setBulkRow] = useState<number | ''>('')
  const [bulkBusy, setBulkBusy] = useState(false)
  // Borradores de ubicación por variante
  const [drafts, setDrafts] = useState<Record<number, { shelfId: number; rowNumber: number }>>({})
  const [savingId, setSavingId] = useState<number | null>(null)
  // Listado local para refrescar tras una asignación masiva sin perder la búsqueda
  const [localProducts, setLocalProducts] = useState<ProductWithLocation[] | null>(null)
  const shownProducts = localProducts ?? products
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLocalProducts(null)
    setVisibleCount(INFINITE_STEP)
  }, [branchId, appliedSearch])

  useEffect(() => {
    setVisibleCount(INFINITE_STEP)
  }, [onlyUnassigned])

  // Sin estantería primero, luego el resto (con separador)
  const ordered = useMemo(() => {
    const list = onlyUnassigned ? shownProducts.filter((p) => p.shelfId == null) : shownProducts
    return [...list.filter((p) => p.shelfId == null), ...list.filter((p) => p.shelfId != null)]
  }, [shownProducts, onlyUnassigned])
  const unassignedCount = useMemo(
    () => ordered.filter((p) => p.shelfId == null).length,
    [ordered],
  )
  const visible = ordered.slice(0, visibleCount)

  // Lazy load infinito: cuando el sentinel entra en pantalla, cargar más
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || visible.length >= ordered.length) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((v) => Math.min(ordered.length, v + INFINITE_STEP))
        }
      },
      { rootMargin: '400px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [ordered.length, visible.length])

  function rowsOf(shelfId: number | null | undefined): ShelfRow[] {
    const s = shelves.find((x) => x.id === shelfId)
    return s ? s.rows : []
  }

  async function saveLocation(p: ProductWithLocation) {
    if (!branchId) return
    const draft = drafts[p.productVariantId]
    if (!draft) return
    setSavingId(p.productVariantId)
    try {
      await api.setLocation(p.productVariantId, branchId, draft.shelfId, draft.rowNumber)
      onLocationChanged(p.productVariantId, draft)
      setDrafts((d) => { const { [p.productVariantId]: _, ...rest } = d; return rest })
      notify('Ubicación guardada')
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error guardando la ubicación')
    } finally {
      setSavingId(null)
    }
  }

  async function removeLocation(p: ProductWithLocation) {
    if (!branchId) return
    setSavingId(p.productVariantId)
    try {
      await api.removeLocation(p.productVariantId, branchId)
      onLocationChanged(p.productVariantId, null)
      setDrafts((d) => { const { [p.productVariantId]: _, ...rest } = d; return rest })
      notify('Ubicación quitada')
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error quitando la ubicación')
    } finally {
      setSavingId(null)
    }
  }

  async function doBulk(onlyUnassigned: boolean) {
    if (!branchId || bulkShelfId === '' || bulkRow === '') {
      notify('Selecciona estantería y fila para la asignación masiva')
      return
    }
    setBulkBusy(true)
    try {
      const r = await api.bulkAssign(branchId, Number(bulkShelfId), Number(bulkRow), onlyUnassigned)
      notify(`Asignados ${r.assigned} producto(s)${onlyUnassigned ? ' sin ubicación' : ''} de ${r.total}`)
      const list = await api.products(branchId, appliedSearch)
      setLocalProducts(list)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error en la asignación masiva')
    } finally {
      setBulkBusy(false)
    }
  }

  if (!branchId) {
    return <p className="text-white/40 text-sm">Selecciona una sucursal.</p>
  }

  return (
    <div>
      {/* Barra de búsqueda */}
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="flex-1 min-w-[220px] flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="Buscar producto, SKU o código de barras…"
            className="flex-1 bg-[#161618] border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-amber-400"
          />
          <button onClick={onSearch} className="px-4 py-2.5 rounded-xl bg-white/10 text-sm font-700 hover:bg-white/15">
            Buscar
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-white/50 font-500 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyUnassigned}
            onChange={(e) => setOnlyUnassigned(e.target.checked)}
            className="accent-amber-400 w-4 h-4"
          />
          Solo sin ubicación
        </label>
      </div>

      {/* Asignación masiva */}
      <div className="bg-[#161618] border border-white/10 rounded-2xl p-4 mb-5">
        <p className="text-white/40 text-xs font-600 mb-2">Asignación masiva — todos los productos de la sucursal</p>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={bulkShelfId}
            onChange={(e) => { setBulkShelfId(e.target.value ? Number(e.target.value) : ''); setBulkRow('') }}
            className="bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
          >
            <option value="">Estantería…</option>
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
            ))}
          </select>
          <select
            value={bulkRow}
            onChange={(e) => setBulkRow(e.target.value ? Number(e.target.value) : '')}
            disabled={bulkShelfId === ''}
            className="bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400 disabled:opacity-40"
          >
            <option value="">Fila…</option>
            {rowsOf(bulkShelfId === '' ? null : Number(bulkShelfId)).map((r) => (
              <option key={r.id} value={r.rowNumber}>Fila {r.rowNumber} · {r.label}</option>
            ))}
          </select>
          <button
            onClick={() => doBulk(false)}
            disabled={bulkBusy}
            title="Reemplaza la ubicación de TODOS los productos de la sucursal con la estantería y fila seleccionadas"
            className="px-4 py-2.5 rounded-xl bg-amber-400 text-[#0C0C0D] text-sm font-800 disabled:opacity-40"
          >
            {bulkBusy ? 'Asignando…' : 'Asignar todos'}
          </button>
          <button
            onClick={() => doBulk(true)}
            disabled={bulkBusy}
            title="Asigna solo los productos que aún no tienen estantería (no toca los ya asignados)"
            className="px-4 py-2.5 rounded-xl bg-white/10 text-sm font-700 disabled:opacity-40"
          >
            Solo sin ubicación
          </button>
        </div>
        <p className="w-full text-white/30 text-xs font-500 mt-2 leading-relaxed">
          <span className="text-white/60 font-700">Asignar todos</span>: reemplaza la ubicación de TODOS los
          productos de la sucursal con la estantería y fila seleccionadas.{' '}
          <span className="text-white/60 font-700">Solo sin ubicación</span>: asigna únicamente los que aún no
          tienen estantería (no toca los ya asignados).
        </p>
      </div>

      <p className="text-white/40 text-xs font-500 mb-3">
        {loading ? 'Cargando…' : `${ordered.length} producto(s) · ${unassignedCount} sin estantería`}
        {appliedSearch ? ` para “${appliedSearch}”` : ''}
      </p>

      {/* Lista */}
      <div className="space-y-2">
        {unassignedCount > 0 && (
          <div className="flex items-center gap-3 pt-2 pb-1">
            <span className="text-amber-400 text-xs font-800 uppercase tracking-wider">Sin estantería asignada ({unassignedCount})</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>
        )}
        {visible.map((p, i) => {
          const showAssignedHeader = !onlyUnassigned && unassignedCount > 0 && i === unassignedCount
          const draft = drafts[p.productVariantId]
          const shelfId = draft ? draft.shelfId : p.shelfId
          const rowNumber = draft ? draft.rowNumber : p.rowNumber
          const dirty = !!draft
          const shelfRows = rowsOf(shelfId)
          return (
            <Fragment key={p.productVariantId}>
              {showAssignedHeader && (
                <div className="flex items-center gap-3 pt-3 pb-1">
                  <span className="text-white/40 text-xs font-800 uppercase tracking-wider">Con estantería asignada ({ordered.length - unassignedCount})</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
              )}
              <div className="bg-[#161618] border border-white/10 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-700 text-sm truncate">{p.productName}</p>
                  <p className="text-white/35 text-xs font-500 truncate">
                    SKU {p.sku ?? '—'} · {p.barcode ?? 'sin código'} · stock {p.stock}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                <select
                  value={shelfId ?? ''}
                  onChange={(e) => {
                    const sid = e.target.value ? Number(e.target.value) : null
                    setDrafts((d) => {
                      if (sid == null) return d
                      const firstRow = rowsOf(sid)[0]
                      return { ...d, [p.productVariantId]: { shelfId: sid, rowNumber: firstRow?.rowNumber ?? 1 } }
                    })
                  }}
                  className="bg-[#0C0C0D] border border-white/10 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-amber-400 max-w-[180px]"
                >
                  <option value="">Sin estantería</option>
                  {shelves.map((s) => (
                    <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                  ))}
                </select>
                <select
                  value={rowNumber ?? ''}
                  onChange={(e) => {
                    const rn = e.target.value ? Number(e.target.value) : 1
                    setDrafts((d) => ({
                      ...d,
                      [p.productVariantId]: { shelfId: shelfId ?? shelves[0]?.id ?? 0, rowNumber: rn },
                    }))
                  }}
                  disabled={shelfId == null}
                  className="bg-[#0C0C0D] border border-white/10 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-amber-400 disabled:opacity-40 max-w-[160px]"
                >
                  <option value="">Fila…</option>
                  {shelfRows.map((r) => (
                    <option key={r.id} value={r.rowNumber}>Fila {r.rowNumber} · {r.label}</option>
                  ))}
                </select>
                {dirty ? (
                  <button
                    onClick={() => saveLocation(p)}
                    disabled={savingId === p.productVariantId}
                    className="px-3 py-2 rounded-lg bg-amber-400 text-[#0C0C0D] text-xs font-800 disabled:opacity-40"
                  >
                    Guardar
                  </button>
                ) : p.shelfId != null ? (
                  <button
                    onClick={() => removeLocation(p)}
                    disabled={savingId === p.productVariantId}
                    className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-700 disabled:opacity-40"
                  >
                    Quitar
                  </button>
                ) : null}
                </div>
              </div>
            </Fragment>
          )
        })}
        {visible.length === 0 && !loading && (
          <p className="text-white/30 text-sm text-center py-10">Sin resultados.</p>
        )}
        {/* Sentinel del lazy load infinito */}
        {visible.length < ordered.length && (
          <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-4">
            <div className="w-4 h-4 rounded-full border-2 border-white/15 border-t-amber-400 animate-spin" />
            <span className="text-white/30 text-xs font-600">Cargando más…</span>
          </div>
        )}
      </div>
    </div>
  )
}
