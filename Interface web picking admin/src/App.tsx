import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, setUnauthorizedHandler } from './services/api'
import type { AuthUser, PickUser } from './services/api'
import type {
  CategoryOrganization,
  CategoryOrgProduct,
  CategoryOrgShelf,
} from './types'
import type { Branch, Category, ProductWithLocation, Shelf, ShelfRow, ShelfType } from './types'
import MapView from './MapView'
import MetricsView from './MetricsView'
import footerLogo from './assets/logo.png'
import headerLogo from './assets/logo.png'

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
  categoryId: null as number | null,
  rows: [] as { rowNumber: number; label: string }[],
})

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState<number | null>(null)
  const [tab, setTab] = useState<'shelves' | 'map' | 'products' | 'metrics' | 'users' | 'schedule' | 'categories'>('shelves')
  const [shelves, setShelves] = useState<Shelf[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<ProductWithLocation[]>([])
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authState, setAuthState] = useState<'checking' | 'out' | 'in'>('checking')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const notify = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }, [])

  // Sesión: se valida con la cookie httpOnly que deja el login.
  useEffect(() => {
    api
      .me()
      .then((u) => {
        setAuthUser(u)
        setAuthState('in')
      })
      .catch(() => setAuthState('out'))
  }, [])

  const handleLogout = useCallback(() => {
    api
      .logout()
      .catch(() => undefined)
      .finally(() => {
        setAuthUser(null)
        setAuthState('out')
      })
  }, [])

  // Si una petición responde 401 (token vencido en pleno uso), volver al login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthUser(null)
      setAuthState('out')
    })
    return () => setUnauthorizedHandler(null)
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

  // Categorías (para asociar a las estanterías)
  useEffect(() => {
    api
      .categories()
      .then(setCategories)
      .catch(() => undefined)
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

  if (authState === 'checking') {
    return (
      <div className="flex h-full items-center justify-center bg-[#0C0C0D] text-white/60 text-sm">
        Validando sesión…
      </div>
    )
  }

  if (authState === 'out') {
    return (
      <LoginScreen
        onSuccess={(u) => {
          setAuthUser(u)
          setAuthState('in')
        }}
      />
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0C0C0D] text-white">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
          <div className="bg-amber-400 text-[#0C0C0D] font-bold text-sm rounded-xl px-4 py-3 shadow-lg">
            {toast}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0C0C0D]/90 backdrop-blur border-b border-white/8 px-5 pt-4 pb-3">
        <div className="max-w-6xl mx-auto flex flex-col gap-3">
          {/* Fila superior: marca + usuario */}
          <div className="flex items-center gap-4">
            <div className="mr-auto flex items-center gap-3">
              <img src={headerLogo} alt="Mercaldas" className="h-8 w-auto object-contain" />
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">Picking <span className="text-amber-400">Admin</span></h1>
                <p className="text-white/40 text-xs font-medium mt-0.5">Estanterías y ubicaciones por sucursal</p>
              </div>
            </div>

            {/* Usuario y salir */}
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2.5 bg-white/5 border border-white/10 rounded-full pl-1 pr-3.5 py-1">
                <span className="w-8 h-8 rounded-full bg-amber-400 text-[#0C0C0D] flex items-center justify-center font-extrabold text-sm">
                  {(authUser?.fullName ?? authUser?.username ?? '?').charAt(0).toUpperCase()}
                </span>
                <div className="leading-tight">
                  <p className="text-white/90 text-xs font-bold truncate max-w-[160px]">
                    {authUser?.fullName ?? authUser?.username}
                  </p>
                  <p className="text-white/40 text-[10px] font-semibold">Administrador</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-full text-xs font-bold bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-all"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Salir
              </button>
            </div>
          </div>

          {/* Fila inferior: selector de sucursales */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-white/40 text-xs font-bold uppercase tracking-wider mr-1">Sucursales</span>
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => setBranchId(b.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border ${
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

      <main className="flex-1 flex flex-col min-h-0">
        {/* Tabs fijos (no scrolleables) */}
        <div className="w-full max-w-6xl mx-auto px-5 pt-4 pb-3 shrink-0">
          <div className="flex gap-2 flex-wrap">
            {(['shelves', 'categories', 'map', 'products', 'metrics', 'users', 'schedule'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                  tab === t ? 'bg-white text-[#0C0C0D]' : 'bg-white/5 text-white/50 hover:text-white/80'
                }`}
              >
                {t === 'shelves' ? 'Estanterías' : t === 'categories' ? 'Categorías' : t === 'map' ? 'Mapa' : t === 'products' ? 'Productos' : t === 'metrics' ? 'Informes' : t === 'users' ? 'Usuarios' : 'Horarios'}
              </button>
            ))}
          </div>
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto">
          <div className="w-full max-w-6xl mx-auto px-5 pb-16">

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm mb-5 flex items-center gap-3">
            <p className="flex-1">{error}</p>
            <button onClick={() => setError(null)} className="font-extrabold underline">Cerrar</button>
          </div>
        )}

        {tab === 'shelves' ? (
          <ShelvesView
            branchId={branchId}
            branchName={branch?.name ?? ''}
            shelves={shelves}
            categories={categories}
            loading={loading}
            onChanged={() => {
              if (branchId) api.shelves(branchId).then(setShelves).catch(() => undefined)
            }}
            notify={notify}
          />
        ) : tab === 'categories' ? (
          <CategoriesView
            branchId={branchId}
            shelves={shelves}
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
        ) : tab === 'users' ? (
          <PickUsersView notify={notify} />
        ) : tab === 'schedule' ? (
          <ScheduleView branchId={branchId} branches={branches} notify={notify} />
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
        </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="shrink-0" style={{ background: '#111827' }}>
        <div className="flex flex-col md:flex-row items-center justify-center gap-x-4 gap-y-1 px-3 py-2 text-center">
          <a href="https://dsi.com.co" target="_blank" rel="noopener noreferrer" className="flex items-center hover:opacity-80 transition-opacity">
            <img src={footerLogo} alt="Mercaldas" className="h-8 w-auto object-contain" />
          </a>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            © 2026 Desarrollado por <span className="font-bold text-white/70">DSI SA</span> · Todos los derechos reservados
          </p>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Manizales, Caldas, Colombia
          </p>
        </div>
      </footer>
    </div>
  )
}

// ─── Estanterías ──────────────────────────────────────────────────────────────

function ShelvesView({
  branchId,
  branchName,
  shelves,
  categories,
  loading,
  onChanged,
  notify,
}: {
  branchId: number | null
  branchName: string
  shelves: Shelf[]
  categories: Category[]
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
        <p className="text-white/40 text-sm font-medium">
          {loading ? 'Cargando…' : `${shelves.length} estanterías en ${branchName}`}
        </p>
        <button
          onClick={() => { setEditing(null); setCreating(true) }}
          className="px-4 py-2 rounded-xl bg-amber-400 text-[#0C0C0D] text-sm font-extrabold hover:bg-amber-300 transition-colors"
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
                  <h3 className="font-extrabold text-lg leading-tight">
                    <span className="text-white/40 font-bold mr-1.5">{s.code}</span>
                    {s.name}
                  </h3>
                  <p className="text-white/40 text-xs font-medium mt-0.5">
                    {s.type === 'wall' ? '🧱 Contra la pared' : '🏬 Isla central'} · {s.rows.length} fila(s) ·{' '}
                    {s.productCount} producto(s)
                  </p>
                  <p className="text-white/40 text-xs font-medium mt-0.5">
                    {s.categoryName ? `🏷️ ${s.categoryName}` : 'Sin categoría'}
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
                      <span className="w-6 h-6 rounded-md flex items-center justify-center font-extrabold shrink-0" style={{ backgroundColor: s.color + '22', color: s.color }}>
                        {r.rowNumber}
                      </span>
                      <span className="text-white/60 font-medium truncate">{r.label}</span>
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
          categories={categories}
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
  categories,
  onClose,
  onSave,
}: {
  branchName: string
  initial: Shelf | null
  categories: Category[]
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
    categoryId: (initial?.categoryId ?? null) as number | null,
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
          <h2 className="font-extrabold text-lg">
            {initial ? `Editar ${initial.code}` : 'Nueva estantería'}
            <span className="block text-white/40 text-xs font-medium">{branchName}</span>
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
              <span className="text-white/40 text-xs font-semibold">Código *</span>
              <input
                value={form.code}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
                placeholder="A1"
                className="mt-1 w-full bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-400"
              />
            </label>
            <label className="block">
              <span className="text-white/40 text-xs font-semibold">Nombre</span>
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
              <span className="text-white/40 text-xs font-semibold">Tipo</span>
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
              <span className="text-white/40 text-xs font-semibold">Rotación</span>
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

          <label className="block">
            <span className="text-white/40 text-xs font-semibold">Categoría</span>
            <select
              value={form.categoryId ?? ''}
              onChange={(e) => set('categoryId', e.target.value === '' ? null : Number(e.target.value))}
              className="mt-1 w-full bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
            >
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {'\u00A0'.repeat(Math.max(0, c.level) * 2)}
                  {c.name}
                </option>
              ))}
            </select>
            <span className="text-white/25 text-[11px] font-medium mt-1 block">
              Organiza la estantería por la categoría de sus productos.
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-white/40 text-xs font-semibold">Posición X (celdas)</span>
              <input
                type="number"
                value={form.posX}
                onChange={(e) => set('posX', Number(e.target.value) || 0)}
                className="mt-1 w-full bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              />
            </label>
            <label className="block">
              <span className="text-white/40 text-xs font-semibold">Posición Y (celdas)</span>
              <input
                type="number"
                value={form.posY}
                onChange={(e) => set('posY', Number(e.target.value) || 0)}
                className="mt-1 w-full bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              />
            </label>
          </div>

          <div>
            <span className="text-white/40 text-xs font-semibold">Color</span>
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
              <span className="text-white/40 text-xs font-semibold">Filas de la estantería</span>
              <button onClick={addRow} className="text-xs font-extrabold text-amber-400">+ Añadir fila</button>
            </div>
            <div className="space-y-2">
              {form.rows.map((r, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-xs font-extrabold shrink-0">
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
            className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            onClick={() => valid && onSave(form)}
            disabled={!valid}
            className="flex-1 py-3 rounded-xl bg-amber-400 text-[#0C0C0D] text-sm font-extrabold disabled:opacity-40"
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
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 210px)', minHeight: 320 }}>
      {/* Filtros y encabezados — fijos (no hacen scroll) */}
      <div className="shrink-0">
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
          <button onClick={onSearch} className="px-4 py-2.5 rounded-xl bg-white/10 text-sm font-bold hover:bg-white/15">
            Buscar
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm text-white/50 font-medium cursor-pointer">
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
        <p className="text-white/40 text-xs font-semibold mb-2">Asignación masiva — solo productos sin ubicación</p>
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
            onClick={() => doBulk(true)}
            disabled={bulkBusy}
            title="Asigna solo los productos que aún no tienen estantería (no toca los ya asignados)"
            className="px-4 py-2.5 rounded-xl bg-amber-400 text-[#0C0C0D] text-sm font-extrabold disabled:opacity-40"
          >
            {bulkBusy ? 'Asignando…' : 'Solo sin ubicación'}
          </button>
        </div>
        <p className="w-full text-white/30 text-xs font-medium mt-2 leading-relaxed">
          <span className="text-white/60 font-bold">Solo sin ubicación</span>: asigna únicamente los productos que
          aún no tienen estantería (no toca los ya asignados).
        </p>
      </div>

      <p className="text-white/40 text-xs font-medium mb-3">
        {loading ? 'Cargando…' : `${ordered.length} producto(s) · ${unassignedCount} sin estantería`}
        {appliedSearch ? ` para “${appliedSearch}”` : ''}
      </p>
      </div>

      {/* Lista — único elemento con scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 pb-4">
        {unassignedCount > 0 && (
          <div className="flex items-center gap-3 pt-2 pb-1">
            <span className="text-amber-400 text-xs font-extrabold uppercase tracking-wider">Sin estantería asignada ({unassignedCount})</span>
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
                  <span className="text-white/40 text-xs font-extrabold uppercase tracking-wider">Con estantería asignada ({ordered.length - unassignedCount})</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
              )}
              <div className="bg-[#161618] border border-white/10 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-bold text-sm truncate">{p.productName}</p>
                  <p className="text-white/35 text-xs font-medium truncate">
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
                    className="px-3 py-2 rounded-lg bg-amber-400 text-[#0C0C0D] text-xs font-extrabold disabled:opacity-40"
                  >
                    Guardar
                  </button>
                ) : p.shelfId != null ? (
                  <button
                    onClick={() => removeLocation(p)}
                    disabled={savingId === p.productVariantId}
                    className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold disabled:opacity-40"
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
            <span className="text-white/30 text-xs font-semibold">Cargando más…</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginScreen({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.login(identifier.trim(), password)
      if (!res.user.isSuperuser) {
        throw new Error('Se requiere un usuario administrador.')
      }
      onSuccess(res.user)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'No se pudo iniciar sesión',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[#0C0C0D] px-5">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-[#141416] border border-white/10 rounded-2xl p-6 flex flex-col gap-4"
      >
        <div className="text-center mb-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            Picking <span className="text-amber-400">Admin</span>
          </h1>
          <p className="text-white/40 text-xs font-medium mt-1">
            Inicia sesión con tu usuario administrador
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-white/40 text-[11px] font-bold uppercase tracking-wider">Usuario o email</span>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
            placeholder="admin"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-white/40 text-[11px] font-bold uppercase tracking-wider">Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
            placeholder="••••••••"
          />
        </label>

        {error && (
          <p className="text-red-400 text-xs font-semibold bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !identifier || !password}
          className="mt-1 bg-amber-400 text-[#0C0C0D] font-bold text-sm rounded-xl px-4 py-2.5 disabled:opacity-40 transition-all"
        >
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}

// ─── Usuarios de picking ──────────────────────────────────────────────────────

const emptyUserForm = () => ({ fullName: '', username: '', email: '', phone: '', password: '' })

function PickUsersView({ notify }: { notify: (msg: string) => void }) {
  const [users, setUsers] = useState<PickUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyUserForm())
  const [saving, setSaving] = useState(false)
  const [resetId, setResetId] = useState<number | null>(null)
  const [resetPwd, setResetPwd] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api
      .users()
      .then(setUsers)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudieron cargar los usuarios'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.createUser({
        fullName: form.fullName.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        password: form.password,
      })
      notify('Usuario creado')
      setForm(emptyUserForm())
      setShowForm(false)
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (u: PickUser) => {
    try {
      await api.updateUser(u.id, { isActive: !u.isActive })
      notify(u.isActive ? `${u.name} desactivado` : `${u.name} activado`)
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo actualizar el usuario')
    }
  }

  const togglePicker = async (u: PickUser) => {
    try {
      await api.updateUser(u.id, { isPicker: !u.isPicker })
      notify(u.isPicker ? `${u.name} ya no es picker` : `${u.name} ahora es picker`)
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo actualizar el usuario')
    }
  }

  const submitReset = async (u: PickUser) => {
    if (resetPwd.length < 8) {
      setResetError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    try {
      await api.resetUserPassword(u.id, resetPwd)
      notify(`Contraseña actualizada para ${u.name}`)
      setResetId(null)
      setResetPwd('')
      setResetError(null)
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : 'No se pudo cambiar la contraseña')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white">Usuarios de picking</h2>
          <p className="text-white/40 text-xs mt-0.5">
            Solo las cuentas marcadas como <span className="text-amber-400 font-semibold">picker</span> aparecen en
            el login de la app móvil. Un usuario nuevo se crea ya como picker.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 rounded-full text-sm font-bold bg-amber-400 text-[#0C0C0D]"
        >
          Nuevo usuario
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm flex items-center gap-3">
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} className="font-extrabold underline">Cerrar</button>
        </div>
      )}

      {/* Modal de nuevo usuario */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6"
          onClick={() => setShowForm(false)}
        >
          <form
            onSubmit={create}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg bg-[#161618] border border-white/10 rounded-t-3xl sm:rounded-2xl p-5 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-lg text-white">Nuevo usuario</h3>
                <p className="text-white/40 text-xs font-medium mt-0.5">
                  Se crea como picker: podrá entrar a la app móvil de picking.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {(
              [
                ['fullName', 'Nombre completo', 'text'],
                ['username', 'Usuario', 'text'],
                ['email', 'Email', 'email'],
                ['phone', 'Teléfono (opcional)', 'text'],
                ['password', 'Contraseña (mín. 8)', 'password'],
              ] as const
            ).map(([key, label, type]) => (
              <label key={key} className="flex flex-col gap-1.5">
                <span className="text-white/40 text-[11px] font-bold uppercase tracking-wider">{label}</span>
                <input
                  type={type}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  autoComplete="off"
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
                />
              </label>
            ))}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-bold bg-white/5 border border-white/10 text-white/70 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2.5 rounded-xl text-sm font-bold bg-white text-[#0C0C0D] disabled:opacity-40"
              >
                {saving ? 'Guardando…' : 'Crear usuario'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <p className="text-white/40 text-sm py-8 text-center">Cargando usuarios…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((u) => (
            <div key={u.id} className="bg-[#141416] border border-white/10 rounded-2xl p-3.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-amber-400 text-[#0C0C0D] font-extrabold flex items-center justify-center text-sm">
                  {u.name.charAt(0).toUpperCase() || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-bold truncate">{u.name}</p>
                  <p className="text-white/40 text-xs truncate">
                    @{u.username} · {u.email}
                  </p>
                </div>
                {u.isPicker && (
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-amber-400/15 text-amber-400">
                    Picker
                  </span>
                )}
                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                    u.isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/8 text-white/40'
                  }`}
                >
                  {u.isActive ? 'Activo' : 'Inactivo'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button
                  onClick={() => {
                    setResetId(resetId === u.id ? null : u.id)
                    setResetPwd('')
                    setResetError(null)
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/70 hover:text-white"
                >
                  {resetId === u.id ? 'Cancelar' : 'Cambiar contraseña'}
                </button>
                <button
                  onClick={() => toggleActive(u)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/70 hover:text-white"
                >
                  {u.isActive ? 'Desactivar' : 'Activar'}
                </button>
                <button
                  onClick={() => togglePicker(u)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    u.isPicker
                      ? 'bg-amber-400/15 border-amber-400/40 text-amber-400'
                      : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
                  }`}
                >
                  {u.isPicker ? 'Quitar de picking' : 'Habilitar picking'}
                </button>
              </div>

              {resetId === u.id && (
                <div className="flex flex-col sm:flex-row gap-2 mt-3">
                  <input
                    type="password"
                    value={resetPwd}
                    onChange={(e) => setResetPwd(e.target.value)}
                    placeholder="Nueva contraseña"
                    autoComplete="new-password"
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-400"
                  />
                  <button
                    onClick={() => submitReset(u)}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-400 text-[#0C0C0D]"
                  >
                    Guardar contraseña
                  </button>
                  {resetError && <p className="text-red-400 text-xs font-semibold self-center">{resetError}</p>}
                </div>
              )}
            </div>
          ))}
          {users.length === 0 && (
            <p className="text-white/30 text-sm text-center py-10">Aún no hay usuarios.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Horarios por sucursal ────────────────────────────────────────────────────

const DAYS: { key: string; label: string }[] = [
  { key: 'monday', label: 'Lunes' },
  { key: 'tuesday', label: 'Martes' },
  { key: 'wednesday', label: 'Miércoles' },
  { key: 'thursday', label: 'Jueves' },
  { key: 'friday', label: 'Viernes' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
]

function ScheduleView({
  branchId,
  branches,
  notify,
}: {
  branchId: number | null
  branches: Branch[]
  notify: (m: string) => void
}) {
  const [schedule, setSchedule] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const branch = branches.find((b) => b.id === branchId) ?? null

  useEffect(() => {
    if (!branchId) return
    setLoading(true)
    setError(null)
    api
      .schedule(branchId)
      .then((r) => setSchedule(r.schedule ?? {}))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el horario'))
      .finally(() => setLoading(false))
  }, [branchId])

  const setRange = (day: string, value: string) =>
    setSchedule((prev) => ({ ...prev, [day]: value }))

  const save = async () => {
    if (!branchId) return
    setSaving(true)
    setError(null)
    try {
      await api.saveSchedule(branchId, schedule)
      notify('Horario guardado')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el horario')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white">Horarios por sucursal</h2>
          <p className="text-white/40 text-xs mt-0.5">
            El cierre de turno define cuándo vence la sesión de los pickers en la app móvil.
          </p>
        </div>
        {branch ? (
          <span className="text-xs font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-3 py-1.5">
            {branch.name}
          </span>
        ) : null}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm flex items-center gap-3">
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} className="font-extrabold underline">Cerrar</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-white/35 text-xs font-semibold">
          La sucursal se elige arriba (selector de sucursales).
        </span>
      </div>

      {!branchId ? (
        <p className="text-white/40 text-sm">Selecciona una sucursal.</p>
      ) : loading ? (
        <p className="text-white/40 text-sm py-8 text-center">Cargando horario…</p>
      ) : (
        <div className="flex flex-col gap-2 max-w-2xl">
          {DAYS.map((d) => {
            const value = schedule[d.key] ?? ''
            const parts = value.split('-')
            return (
              <div
                key={d.key}
                className="flex items-center gap-3 bg-[#141416] border border-white/10 rounded-xl px-4 py-2.5"
              >
                <span className="w-24 text-sm font-bold text-white/80">{d.label}</span>
                <input
                  type="time"
                  value={parts[0] ?? ''}
                  onChange={(e) =>
                    setRange(d.key, `${e.target.value || '08:00'}-${parts[1] ?? '20:00'}`)
                  }
                  className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white outline-none focus:border-amber-400"
                />
                <span className="text-white/30 text-xs font-bold">a</span>
                <input
                  type="time"
                  value={parts[1] ?? ''}
                  onChange={(e) =>
                    setRange(d.key, `${parts[0] ?? '08:00'}-${e.target.value || '20:00'}`)
                  }
                  className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white outline-none focus:border-amber-400"
                />
                {value && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(value) && (
                  <span className="text-red-400 text-[10px] font-bold">formato HH:MM-HH:MM</span>
                )}
              </div>
            )
          })}

          <button
            onClick={() => void save()}
            disabled={saving}
            className="mt-3 self-start px-5 py-2.5 rounded-xl bg-amber-400 text-[#0C0C0D] text-sm font-bold disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Guardar horario'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Categorías: organizar estanterías y productos por categoría ─────────────

function OrgProductRow({
  product,
  org,
  branchId,
  onMoved,
  notify,
}: {
  product: CategoryOrgProduct
  org: CategoryOrganization
  branchId: number
  onMoved: () => void
  notify: (m: string) => void
}) {
  const [shelfId, setShelfId] = useState<number | null>(product.shelfId)
  const [rowNumber, setRowNumber] = useState<number | null>(product.rowNumber)
  const [busy, setBusy] = useState(false)

  const selectedShelf = org.shelves.find((s) => s.id === shelfId) ?? null
  const dirty =
    shelfId !== product.shelfId ||
    (shelfId !== null && rowNumber !== product.rowNumber)

  const save = async () => {
    setBusy(true)
    try {
      if (shelfId === null) {
        await api.removeLocation(product.productVariantId, branchId)
      } else if (rowNumber !== null) {
        await api.setLocation(
          product.productVariantId,
          branchId,
          shelfId,
          rowNumber,
        )
      }
      notify('Ubicación actualizada')
      onMoved()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'No se pudo mover el producto')
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr className="border-t border-white/5">
      <td className="py-2.5 pr-3">
        <p className="text-sm font-semibold truncate max-w-[220px]">{product.productName}</p>
        <p className="text-white/35 text-[10px] font-medium">
          SKU {product.sku ?? '—'} · stock {product.stock}
        </p>
      </td>
      <td className="py-2.5 pr-3 text-xs text-white/60">
        {product.shelfCode ? `${product.shelfCode}${product.rowNumber ? ` · Fila ${product.rowNumber}` : ''}` : 'Sin ubicación'}
      </td>
      <td className="py-2.5 pr-2">
        <select
          value={shelfId ?? ''}
          onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : null
            setShelfId(v)
            if (v === null) setRowNumber(null)
          }}
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-amber-400 max-w-[160px]"
        >
          <option value="">— Sin ubicación —</option>
          {org.shelves.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
        {shelfId !== null && (
          <select
            value={rowNumber ?? ''}
            onChange={(e) => setRowNumber(e.target.value ? Number(e.target.value) : null)}
            className="ml-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-amber-400"
          >
            <option value="">Fila…</option>
            {(selectedShelf?.rows ?? []).map((r) => (
              <option key={r.rowNumber} value={r.rowNumber}>
                {r.rowNumber} · {r.label}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="py-2.5 text-right">
        <button
          onClick={() => void save()}
          disabled={busy || !dirty || (shelfId !== null && rowNumber === null)}
          className="text-xs font-bold text-amber-400 hover:underline disabled:opacity-30"
        >
          {busy ? '…' : 'Mover'}
        </button>
      </td>
    </tr>
  )
}

function CategoriesView({
  branchId,
  shelves,
  onChanged,
  notify,
}: {
  branchId: number | null
  shelves: Shelf[]
  onChanged: () => void
  notify: (m: string) => void
}) {
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [org, setOrg] = useState<CategoryOrganization | null>(null)
  const [loading, setLoading] = useState(false)
  const [assignShelfId, setAssignShelfId] = useState<number | null>(null)

  useEffect(() => {
    api.categories().then(setCategories).catch(() => undefined)
  }, [])

  const loadOrg = useCallback(async (categoryId: number) => {
    if (!branchId) return
    setLoading(true)
    try {
      setOrg(await api.categoryOrganization(categoryId, branchId))
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'No se pudo cargar la categoría')
    } finally {
      setLoading(false)
    }
  }, [branchId, notify])

  useEffect(() => {
    if (selectedId) void loadOrg(selectedId)
  }, [selectedId, loadOrg])

  const filtered = categories.filter((c) =>
    c.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const assignShelf = async () => {
    if (!selectedId || !assignShelfId) return
    try {
      await api.updateShelf(assignShelfId, { categoryId: selectedId })
      notify('Estantería asignada a la categoría')
      setAssignShelfId(null)
      onChanged()
      void loadOrg(selectedId)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'No se pudo asignar la estantería')
    }
  }

  const detachShelf = async (shelfId: number) => {
    if (!selectedId) return
    try {
      await api.updateShelf(shelfId, { categoryId: null })
      notify('Estantería quitada de la categoría')
      onChanged()
      void loadOrg(selectedId)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'No se pudo quitar la estantería')
    }
  }

  const branchShelves = shelves.filter((s) => s.branchId === branchId)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      {/* Lista de categorías */}
      <div className="flex flex-col gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar categoría…"
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
        />
        <div className="max-h-[70vh] overflow-y-auto flex flex-col gap-1.5 pr-1">
          {filtered.map((c) => {
            const shelfCount = shelves.filter((s) => s.categoryId === c.id).length
            const active = c.id === selectedId
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                  active
                    ? 'bg-amber-400 text-[#0C0C0D] border-amber-400'
                    : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold truncate">{c.name}</span>
                  <span className={`text-[10px] font-extrabold ${active ? 'text-[#0C0C0D]/60' : 'text-white/40'}`}>
                    {c.productCount} prod
                  </span>
                </div>
                <span className={`text-[10px] font-semibold ${active ? 'text-[#0C0C0D]/60' : 'text-white/35'}`}>
                  {shelfCount} estantería(s) en esta sucursal
                </span>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <p className="text-white/30 text-sm text-center py-6">Sin resultados.</p>
          )}
        </div>
      </div>

      {/* Detalle de la categoría */}
      <div className="flex flex-col gap-4">
        {!selectedId ? (
          <p className="text-white/30 text-sm py-10 text-center">
            Selecciona una categoría para ver sus estanterías y productos.
          </p>
        ) : loading || !org || !branchId ? (
          <p className="text-white/40 text-sm py-10 text-center">Cargando…</p>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-extrabold text-white">{org.category.name}</h2>
              <p className="text-white/40 text-xs mt-0.5">
                {org.products.length} producto(s) en la categoría · {org.shelves.length} estantería(s)
              </p>
            </div>

            {/* Estanterías de la categoría */}
            <section className="flex flex-col gap-2">
              <h3 className="text-white/35 text-[10px] font-bold uppercase tracking-wider">
                Estanterías de esta categoría ({org.shelves.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {org.shelves.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 bg-[#141416] border border-white/10 rounded-xl px-3 py-2"
                  >
                    <span className="w-3 h-3 rounded-full" style={{ background: s.color }} />
                    <div>
                      <p className="text-sm font-bold text-white">{s.code}</p>
                      <p className="text-white/35 text-[10px] font-medium">{s.name} · {s.productCount} prod</p>
                    </div>
                    <button
                      onClick={() => void detachShelf(s.id)}
                      className="ml-2 text-[10px] font-bold text-red-400 hover:underline"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
                {org.shelves.length === 0 && (
                  <p className="text-white/30 text-xs">Ninguna estantería asignada aún.</p>
                )}
              </div>

              <div className="flex items-center gap-2 max-w-md">
                <select
                  value={assignShelfId ?? ''}
                  onChange={(e) => setAssignShelfId(e.target.value ? Number(e.target.value) : null)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white outline-none focus:border-amber-400"
                >
                  <option value="">Asignar estantería de la sucursal…</option>
                  {branchShelves
                    .filter((s) => s.categoryId !== org.category.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} · {s.name}
                      </option>
                    ))}
                </select>
                <button
                  onClick={() => void assignShelf()}
                  disabled={!assignShelfId}
                  className="px-3 py-2 rounded-lg bg-amber-400 text-[#0C0C0D] text-xs font-bold disabled:opacity-40"
                >
                  Asignar
                </button>
              </div>
            </section>

            {/* Productos de la categoría */}
            <section>
              <h3 className="text-white/35 text-[10px] font-bold uppercase tracking-wider mb-2">
                Productos de la categoría ({org.products.length})
              </h3>
              <div className="bg-[#141416] border border-white/10 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/35 text-[10px] font-bold uppercase tracking-wider text-left border-b border-white/5 bg-white/5">
                      <th className="px-4 py-2.5">Producto</th>
                      <th className="px-4 py-2.5">Ubicación actual</th>
                      <th className="px-4 py-2.5">Mover a</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {org.products.map((p) => (
                      <OrgProductRow
                        key={p.productVariantId}
                        product={p}
                        org={org}
                        branchId={branchId}
                        notify={notify}
                        onMoved={() => void loadOrg(selectedId)}
                      />
                    ))}
                    {org.products.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-white/30 text-sm">
                          Esta categoría no tiene productos asociados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
