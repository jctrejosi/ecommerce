import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { api, ApiError, resolveAssetUrl, setUnauthorizedHandler } from './services/api'
import type { AuthUser } from './services/api'
import type {
  CategoryOrganization,
  CategoryOrgProduct,
  CategoryOrgShelf,
} from './types'
import type { Branch, CatalogProduct, Category, Shelf, ShelfType } from './types'
import MapView from './MapView'
import ProductDetailModal from './ProductDetailModal'
import { CategoryTree } from './categoryTree'
import { useCategoryChangeConfirm, CategoryChangeConfirm } from './shelfCategories'
import UsersView from './UsersView'
import OrdersView from './OrdersView'
import { PickerChatDrawer } from './PickerChat'
import { BreakSettingsModal } from './BreakSettingsModal'
import { useChatAlerts } from './useChatAlerts'
import { NotificationsBell } from './NotificationsBell'
import { requestNotificationPermission } from './services/browserNotifications'
import { getStoredTheme, setStoredTheme, THEME_COLORS, THEME_MODES, type ThemeState } from './theme'
// Logo corporativo (DSI): lo comparten el header del panel y el pie de copyright.
import logo from './assets/logo.png'
// Marca de la app de picking: se conserva al pie de la pantalla de login.
import pickingLogo from './assets/picking.png'

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
  categoryIds: [] as number[],
})

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState<number | null>(null)
  const [tab, setTab] = useState<'shelves' | 'map' | 'products' | 'orders' | 'users' | 'schedule' | 'categories'>('shelves')
  const [shelves, setShelves] = useState<Shelf[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [productsTotal, setProductsTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authState, setAuthState] = useState<'checking' | 'out' | 'in'>('checking')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Bandeja de chat del header (un hilo por picker).
  const [chatOpen, setChatOpen] = useState(false)
  // Configuración de descansos y metas (dropdown del usuario).
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Tema activo (color + modo) y el menú desplegable de opciones del usuario.
  const [theme, setTheme] = useState<ThemeState>(() => getStoredTheme())
  const [userMenu, setUserMenu] = useState(false)
  const changeTheme = (next: ThemeState) => {
    setStoredTheme(next)
    setTheme(next)
  }
  // Logo de la tienda configurado en el admin general (endpoint público).
  const [storeLogo, setStoreLogo] = useState<string | null>(null)

  const notify = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }, [])

  // Logo de la tienda que se configura en el admin general.
  useEffect(() => {
    let cancelled = false
    api
      .storeInfo()
      .then((d) => {
        if (!cancelled) setStoreLogo(resolveAssetUrl(d.url))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // No leídos del chat + aviso (punto en el botón y notificación del navegador)
  // cuando llega un mensaje nuevo, en cualquier pestaña del panel.
  const { unread } = useChatAlerts(authState === 'in')

  const openChat = useCallback(() => {
    setChatOpen(true)
    // El permiso de notificaciones exige un gesto del usuario: se pide al abrir.
    void requestNotificationPermission()
  }, [])

  // Sesión: se valida con la cookie httpOnly que deja el login.
  useEffect(() => {
    api
      .me()
      .then((u) => {
        setAuthUser(u)
        setAuthState('in')
        // El admin de sucursal queda fijado a su sucursal.
        if (u.branchId != null) setBranchId(u.branchId)
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

  // Categorías (para asociar a las estanterías) — del surtido de la sucursal.
  useEffect(() => {
    api
      .categories(branchId ?? undefined)
      .then(setCategories)
      .catch(() => undefined)
  }, [branchId])

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
      .products(branch, q, 0, INFINITE_STEP)
      .then((res) => {
        setProducts(res.products)
        setProductsTotal(res.total)
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Error cargando productos'))
      .finally(() => setLoading(false))
  }, [])

  // Siguiente página de productos (lazy load).
  const loadMoreProducts = useCallback(() => {
    if (!branchId || loadingMore) return
    if (products.length >= productsTotal) return
    setLoadingMore(true)
    api
      .products(branchId, appliedSearch, products.length, INFINITE_STEP)
      .then((res) => {
        setProducts((cur) => [...cur, ...res.products])
        setProductsTotal(res.total)
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Error cargando productos'))
      .finally(() => setLoadingMore(false))
  }, [branchId, appliedSearch, products.length, productsTotal, loadingMore])

  // Productos al cambiar de sucursal
  useEffect(() => {
    if (!branchId) return
    setAppliedSearch('')
    setSearch('')
    loadProducts(branchId, '')
  }, [branchId, loadProducts])

  const branch = branches.find((b) => b.id === branchId) ?? null
  // Alcance del admin: si tiene sucursal asignada, no puede cambiarla.
  const scopedBranchId = authUser?.branchId ?? null

  if (authState === 'checking') {
    return (
      <div className="flex h-full items-center justify-center bg-app text-white/60 text-sm">
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
    <div className="flex h-full flex-col overflow-hidden bg-app text-white">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
          <div className="bg-amber-400 text-on-accent font-bold text-sm rounded-xl px-4 py-3 shadow-lg">
            {toast}
          </div>
        </div>
      )}

      {/* Header. El `pr` reserva el ancho del scrollbar del contenido, para que
          el header quede en la misma columna que tabs y contenido. */}
      <header className="sticky top-0 z-40 bg-app/90 backdrop-blur border-b border-white/8 pt-4 pb-3 pr-[var(--app-scrollbar)]">
        <div className="max-w-6xl mx-auto px-5 flex flex-col gap-3">
          {/* Fila superior: marca + usuario */}
          <div className="flex items-center gap-4">
            {/* Marca: los dos logos arriba (el de DSI y el de la tienda que se
                configura en el admin general) y el título debajo. */}
            <div className="mr-auto flex flex-col gap-1.5">
              <div className="flex items-center gap-3">
                <img src={logo} alt="DSI" className="h-8 w-auto object-contain" />
                {storeLogo ? (
                  <img
                    src={storeLogo}
                    alt="Tienda"
                    className="h-8 w-auto max-w-[160px] object-contain"
                  />
                ) : null}
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight leading-tight">
                Picking <span className="text-amber-400">Admin</span>
              </h1>
            </div>

            {/* Usuario, avisos, chat y salir */}
            <div className="flex items-center gap-2.5">
              {/* Campanita: avisos de cada acción sobre los pedidos. */}
              <NotificationsBell enabled={authState === 'in'} />

              {/* Chat con los pickers: bandeja con un hilo por picker. */}
              <button
                onClick={openChat}
                title="Chat con los pickers"
                aria-label="Chat con los pickers"
                className="relative shrink-0 w-11 h-11 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-all flex items-center justify-center"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M21 11.5a8 8 0 0 1-8 8H8l-5 3 1.4-4.3A8 8 0 1 1 21 11.5Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {unread > 0 ? (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[19px] h-[19px] px-1 rounded-full bg-red-500 text-white text-[10px] font-extrabold flex items-center justify-center border-2 border-app">
                    {unread > 9 ? '9+' : unread}
                  </span>
                ) : null}
              </button>

              {/* Opciones del usuario: menú desplegable con tema (color + modo). */}
              <div className="relative">
                <button
                  onClick={() => setUserMenu((v) => !v)}
                  title="Opciones del usuario"
                  aria-label="Opciones del usuario"
                  aria-expanded={userMenu}
                  className="flex items-center gap-2.5 bg-white/5 border border-white/10 rounded-full pl-1 pr-3 py-1 hover:bg-white/10 transition-all"
                >
                  <span className="w-8 h-8 rounded-full bg-amber-400 text-on-accent flex items-center justify-center font-extrabold text-sm">
                    {(authUser?.fullName ?? authUser?.username ?? '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="leading-tight text-left">
                    <span className="block text-white/90 text-xs font-bold truncate max-w-[160px]">
                      {authUser?.fullName ?? authUser?.username}
                    </span>
                    <span className="block text-white/40 text-[10px] font-semibold">Administrador</span>
                  </span>
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    className={`text-white/40 transition-transform ${userMenu ? 'rotate-180' : ''}`}
                  >
                    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {userMenu ? (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenu(false)} />
                    <div className="absolute right-0 top-full mt-2 z-50 w-60 bg-surface border border-white/10 rounded-xl p-3 shadow-xl">
                      {/* Color del tema: swatches circulares. */}
                      <p className="px-1 pb-1.5 text-white/40 text-[10px] font-bold uppercase tracking-wider">
                        Color
                      </p>
                      <div className="flex items-center gap-2 px-1 pb-3">
                        {THEME_COLORS.map((c) => {
                          const active = c.id === theme.color
                          return (
                            <button
                              key={c.id}
                              onClick={() => changeTheme({ ...theme, color: c.id })}
                              title={c.label}
                              aria-label={`Color ${c.label}`}
                              aria-pressed={active}
                              className={`w-7 h-7 rounded-full border-2 transition-transform ${
                                active ? 'border-white scale-110' : 'border-white/20 hover:scale-105'
                              }`}
                              style={{ background: c.swatch }}
                            />
                          )
                        })}
                      </div>

                      {/* Modo claro/oscuro: botones circulares con ícono (sol / luna). */}
                      <p className="px-1 pb-1.5 text-white/40 text-[10px] font-bold uppercase tracking-wider">
                        Modo
                      </p>
                      <div className="flex items-center gap-2 px-1">
                        {THEME_MODES.map((m) => {
                          const active = m.id === theme.mode
                          return (
                            <button
                              key={m.id}
                              onClick={() => changeTheme({ ...theme, mode: m.id })}
                              title={m.label}
                              aria-label={`Modo ${m.label}`}
                              aria-pressed={active}
                              className={`w-9 h-9 rounded-full border flex items-center justify-center transition-all ${
                                active
                                  ? 'bg-amber-400 text-on-accent border-amber-400'
                                  : 'bg-white/5 text-white/60 border-white/10 hover:text-white hover:bg-white/10'
                              }`}
                            >
                              {m.id === 'dark' ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ) : m.id === 'light' ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
                                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                              ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                  <rect x="2.5" y="4" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
                                  <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                              )}
                            </button>
                          )
                        })}
                      </div>

                      {/* Abre el panel de configuración de descansos y metas. */}
                      <div className="border-t border-white/10 mt-3 pt-2">
                        <button
                          onClick={() => {
                            setUserMenu(false)
                            setSettingsOpen(true)
                          }}
                          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-white/80 hover:bg-white/10 transition-colors text-xs font-bold"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                            <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                          Configuración
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
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
            {scopedBranchId != null ? (
              // Admin de sucursal: sucursal fija, sin selector.
              <>
                <span className="text-white/40 text-xs font-bold uppercase tracking-wider mr-1">
                  Sucursal
                </span>
                <span className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-400/15 text-amber-400 border border-amber-400/40">
                  {branch?.name ?? authUser?.branchName ?? `Sucursal ${scopedBranchId}`}
                </span>
              </>
            ) : (
              <>
                <span className="text-white/40 text-xs font-bold uppercase tracking-wider mr-1">Sucursales</span>
                {/* "Todas": solo lo aprovechan las vistas que no dependen de una
                    sucursal (Pedidos); las de estantería piden elegir una. */}
                <button
                  onClick={() => setBranchId(null)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border ${
                    branchId === null
                      ? 'bg-amber-400 text-on-accent border-amber-400'
                      : 'bg-white/5 text-white/50 border-white/10 hover:text-white/80'
                  }`}
                >
                  Todas
                </button>
                {branches.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setBranchId(b.id)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border ${
                      branchId === b.id
                        ? 'bg-amber-400 text-on-accent border-amber-400'
                        : 'bg-white/5 text-white/50 border-white/10 hover:text-white/80'
                    }`}
                  >
                    {b.name}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col min-h-0">
        {/* Tabs fijos (no scrolleables). Igual que el header, reservan el ancho
            del scrollbar para quedar alineados con el contenido. */}
        <div className="shrink-0 pr-[var(--app-scrollbar)]">
          <div className="w-full max-w-6xl mx-auto px-5 pt-4 pb-3">
            <div className="flex gap-2 flex-wrap">
              {(['map', 'shelves', 'categories', 'products', 'orders', 'users', 'schedule'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                    tab === t ? 'bg-white text-app' : 'bg-white/5 text-white/50 hover:text-white/80'
                  }`}
                >
                  {t === 'shelves' ? 'Estanterías' : t === 'categories' ? 'Categorías' : t === 'map' ? 'Mapa' : t === 'products' ? 'Productos' : t === 'orders' ? 'Pedidos' : t === 'users' ? 'Usuarios' : 'Horarios'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Contenido scrolleable. Reserva el gutter del scrollbar para que el
            ancho no cambie (ni el contenido salte) cuando aparece. */}
        <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
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
              categories={categories}
              onRefresh={() => {
                if (branchId) api.shelves(branchId).then(setShelves).catch(() => undefined)
              }}
              notify={notify}
            />
          ) : (
            <p className="text-white/40 text-sm">Selecciona una sucursal.</p>
          )
        ) : tab === 'orders' ? (
          <OrdersView branchId={branchId} branchName={branch?.name ?? ''} notify={notify} />
        ) : tab === 'users' ? (
          <UsersView notify={notify} currentUserId={authUser?.id ?? null} branchId={branchId} />
        ) : tab === 'schedule' ? (
          <ScheduleView branchId={branchId} branches={branches} notify={notify} />
        ) : (
          <ProductsView
            branchId={branchId}
            shelves={shelves}
            products={products}
            total={productsTotal}
            loading={loading}
            loadingMore={loadingMore}
            onLoadMore={loadMoreProducts}
            search={search}
            setSearch={setSearch}
            appliedSearch={appliedSearch}
            onSearch={() => branchId && loadProducts(branchId, search)}
          />
        )}
        </div>
        </div>
      </main>

      {/* Footer */}
      <CopyrightFooter />

      {/* Bandeja de chat (bandeja de pickers + hilo) */}
      <PickerChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        branches={branches}
        lockedBranchId={scopedBranchId}
      />

      <BreakSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        notify={notify}
      />
    </div>
  )
}

// ─── Footer de copyright ──────────────────────────────────────────────────────

/** Pie de copyright, compartido por el panel y la pantalla de login. */
function CopyrightFooter() {
  // La banda sigue el tema (oscura en oscuro, clara en claro) y el texto usa la
  // tinta del tema (`white/NN` → `--ink`), así contrasta en ambos modos.
  return (
    <footer className="shrink-0" style={{ background: 'var(--footer-bg)' }}>
      <div className="flex flex-col md:flex-row items-center justify-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-center">
        <a href="https://dsi.com.co" target="_blank" rel="noopener noreferrer" className="flex items-center hover:opacity-80 transition-opacity">
          {/* Mismo logo (y tamaño) que el footer del admin general. */}
          <img src={logo} alt="Mercaldas" className="h-[26px] w-auto object-contain" />
        </a>
        <p className="text-[11px] text-white/40">
          © 2026 Desarrollado por <span className="font-bold text-white/70">DSI SA</span> · Todos los derechos reservados
        </p>
        <p className="text-[11px] text-white/30">
          Manizales, Caldas, Colombia
        </p>
      </div>
    </footer>
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
  const [deleting, setDeleting] = useState<Shelf | null>(null)

  if (!branchId) {
    return <p className="text-white/40 text-sm">Selecciona una sucursal.</p>
  }

  async function handleSave(data: ReturnType<typeof emptyShelf>) {
    // El early return de arriba no estrecha el tipo dentro del closure: lo
    // capturamos en una const para crear siempre con una sucursal definida.
    const branch = branchId
    if (!branch) return
    try {
      if (editing) {
        await api.updateShelf(editing.id, data)
        notify('Estantería actualizada')
      } else {
        await api.createShelf({ branchId: branch, ...data })
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
    // Los errores los muestra el modal de confirmación para que el usuario
    // no pierda el contexto de lo que estaba eliminando.
    await api.deleteShelf(shelf.id)
    notify('Estantería eliminada')
    onChanged()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-white/40 text-sm font-medium">
          {loading ? 'Cargando…' : `${shelves.length} estanterías en ${branchName}`}
        </p>
        <button
          onClick={() => { setEditing(null); setCreating(true) }}
          className="px-4 py-2 rounded-xl bg-amber-400 text-on-accent text-sm font-extrabold hover:bg-amber-300 transition-colors"
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
          <div key={s.id} className="bg-surface border border-white/10 rounded-2xl overflow-hidden">
            <div className="h-1.5" style={{ backgroundColor: s.color }} />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-extrabold text-lg leading-tight truncate">
                    <span className="text-white/40 font-bold mr-1.5">{s.code}</span>
                    {s.name}
                  </h3>
                  <p className="text-white/40 text-xs font-medium mt-1">
                    {s.type === 'wall' ? '🧱 Contra la pared' : '🏬 Isla central'}
                  </p>
                  <p className="text-white/40 text-xs font-medium mt-0.5">
                    📍 X {s.posX} · Y {s.posY} · {s.productCount} producto(s)
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {s.categories.length > 0 ? (
                      s.categories.map((c) => (
                        <span
                          key={c.id}
                          className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/60 text-[10px] font-semibold"
                        >
                          {c.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-white/25 text-[11px] font-medium">Sin categorías</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => { setCreating(false); setEditing(s) }}
                    className="h-8 px-2.5 rounded-lg bg-white/5 border border-white/10 flex items-center gap-1.5 text-xs font-bold text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                    title="Editar"
                    aria-label={`Editar ${s.code}`}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Editar
                  </button>
                  <button
                    onClick={() => setDeleting(s)}
                    className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/20"
                    title="Eliminar"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <ShelfModal
          branchName={branchName}
          initial={editing ?? null}
          shelves={shelves}
          categories={categories}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}

      {deleting && (
        <DeleteShelfModal
          shelf={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={() => handleDelete(deleting)}
        />
      )}
    </div>
  )
}

// ─── Modal editor de estantería ───────────────────────────────────────────────

function ShelfModal({
  branchName,
  initial,
  shelves,
  categories,
  onClose,
  onSave,
}: {
  branchName: string
  initial: Shelf | null
  shelves: Shelf[]
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
    categoryIds: (initial?.categories ?? []).map((c) => c.id),
  }))
  const [catSearch, setCatSearch] = useState('')
  // El cambio de código se confirma aparte (ver `submit`).
  const [confirmCode, setConfirmCode] = useState(false)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Quitar una categoría ya guardada pide confirmación; añadir una que ya vive
  // en otra estantería avisa de que se duplicará (está permitido).
  const savedIds = (initial?.categories ?? []).map((c) => c.id)
  const { pending, requestCategoryChange, confirm, cancel } = useCategoryChangeConfirm({
    shelves,
    shelfId: initial?.id ?? null,
    savedIds,
    isSelected: (id) => form.categoryIds.includes(id),
    toggle: (id, next) =>
      setForm((f) => ({
        ...f,
        categoryIds: next
          ? f.categoryIds.includes(id)
            ? f.categoryIds
            : [...f.categoryIds, id]
          : f.categoryIds.filter((x) => x !== id),
      })),
  })



  const valid = form.code.trim().length > 0
  // El código es el identificador de la estantería: al editarlo se pide confirmación.
  const codeChanged = initial != null && form.code.trim() !== initial.code
  function submit() {
    if (!valid) return
    if (codeChanged) {
      setConfirmCode(true)
      return
    }
    onSave(form)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface px-5 pt-4 pb-3 border-b border-white/8 flex items-center justify-between">
          <h2 className="font-extrabold text-lg">
            {initial ? `Editar ${initial.code}` : 'Nueva estantería'}
            <span className="block text-white/40 text-xs font-medium">{branchName}</span>
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
                className="mt-1 w-full bg-app border border-white/10 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-400"
              />
            </label>
            <label className="block">
              <span className="text-white/40 text-xs font-semibold">Nombre</span>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Lácteos"
                className="mt-1 w-full bg-app border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-white/40 text-xs font-semibold">Tipo</span>
              <select
                value={form.type}
                onChange={(e) => set('type', e.target.value as ShelfType)}
                className="mt-1 w-full bg-app border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
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
                className="mt-1 w-full bg-app border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              >
                <option value={0}>0° (horizontal)</option>
                <option value={90}>90° (vertical)</option>
              </select>
            </label>
          </div>

          <div>
            <span className="text-white/40 text-xs font-semibold">Categorías</span>
            <input
              value={catSearch}
              onChange={(e) => setCatSearch(e.target.value)}
              placeholder="Buscar categoría…"
              className="mt-1 w-full bg-app border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-amber-400"
            />
            {form.categoryIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {form.categoryIds.map((id) => {
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
            <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-white/10 py-1 [scrollbar-gutter:stable]">
              <CategoryTree
                categories={categories}
                selectedIds={form.categoryIds}
                onToggle={(c) => requestCategoryChange(c.id, c.name)}
                query={catSearch}
              />
            </div>
            <span className="text-white/25 text-[11px] font-medium mt-1 block">
              Una estantería puede agrupar varias categorías.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-white/40 text-xs font-semibold">Posición X (celdas)</span>
              <input
                type="number"
                value={form.posX}
                onChange={(e) => set('posX', Number(e.target.value) || 0)}
                className="mt-1 w-full bg-app border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              />
            </label>
            <label className="block">
              <span className="text-white/40 text-xs font-semibold">Posición Y (celdas)</span>
              <input
                type="number"
                value={form.posY}
                onChange={(e) => set('posY', Number(e.target.value) || 0)}
                className="mt-1 w-full bg-app border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
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

        </div>

        <div className="sticky bottom-0 bg-surface border-t border-white/8 px-5 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="flex-1 py-3 rounded-xl bg-amber-400 text-on-accent text-sm font-extrabold disabled:opacity-40"
          >
            {initial ? 'Guardar cambios' : 'Crear estantería'}
          </button>
        </div>
      </div>

      {pending && <CategoryChangeConfirm pending={pending} onConfirm={confirm} onCancel={cancel} />}
      {confirmCode && initial && (
        <ShelfCodeChangeConfirm
          oldCode={initial.code}
          newCode={form.code.trim()}
          onCancel={() => setConfirmCode(false)}
          onConfirm={() => onSave(form)}
        />
      )}
    </div>
  )
}

/**
 * Confirmación al cambiar el código de una estantería: es su identificador en el
 * panel y en la app, así que se evita cambiarlo por un descuido.
 */
function ShelfCodeChangeConfirm({
  oldCode,
  newCode,
  onCancel,
  onConfirm,
}: {
  oldCode: string
  newCode: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6" onClick={onCancel}>
      <div
        className="w-full max-w-sm bg-surface border border-white/10 rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-extrabold text-base">Cambiar código</h3>
        <p className="text-white/60 text-sm mt-2 leading-relaxed">
          Vas a cambiar el código de <span className="font-bold text-white/80">«{oldCode}»</span> a{' '}
          <span className="font-bold text-white/80">«{newCode}»</span>. Es su identificador en el panel y
          en la app móvil. ¿Deseas continuar?
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
            Cambiar código
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal de confirmación para eliminar estantería ───────────────────────────

/**
 * Confirmación destructiva: exige teclear el nombre de la estantería para
 * habilitar el botón, así se evita borrar por un clic accidental.
 */
function DeleteShelfModal({
  shelf,
  onClose,
  onConfirm,
}: {
  shelf: Shelf
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  // Si la estantería no tiene nombre, se usa el código como texto a teclear.
  const expected = shelf.name.trim() || shelf.code.trim()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matches = typed.trim().toLowerCase() === expected.toLowerCase()

  async function confirm() {
    if (!matches || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error eliminando la estantería')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-white/8 flex items-center justify-between">
          <h2 className="font-extrabold text-lg text-red-400">Eliminar estantería</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center" title="Cerrar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-white/70 leading-relaxed">
            Se eliminará la estantería{' '}
            <span className="font-bold text-white">{shelf.code}</span>{' '}
            <span className="font-bold text-white">{shelf.name}</span> y las ubicaciones de
            productos que tenga asociadas. Esta acción no se puede deshacer.
          </p>

          <label className="block">
            <span className="text-white/50 text-xs font-semibold">
              Escribe <span className="font-bold text-amber-300">{expected}</span> para confirmar
            </span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirm() }}
              placeholder={expected}
              className="mt-1 w-full bg-app border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-red-400"
            />
          </label>

          {error && <p className="text-red-400 text-xs font-medium">{error}</p>}
        </div>

        <div className="border-t border-white/8 px-5 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={!matches || busy}
            className="flex-1 py-3 rounded-xl bg-red-500 text-white text-sm font-extrabold disabled:opacity-40"
          >
            {busy ? 'Eliminando…' : 'Eliminar'}
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
  total,
  loading,
  loadingMore,
  onLoadMore,
  search,
  setSearch,
  appliedSearch,
  onSearch,
}: {
  branchId: number | null
  shelves: Shelf[]
  products: CatalogProduct[]
  total: number
  loading: boolean
  loadingMore: boolean
  onLoadMore: () => void
  search: string
  setSearch: (s: string) => void
  appliedSearch: string
  onSearch: () => void
}) {
  // Producto abierto en el detalle (con la miniatura del mapa).
  const [selected, setSelected] = useState<CatalogProduct | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const withoutShelf = useMemo(
    () => products.filter((p) => p.shelves.length === 0).length,
    [products],
  )
  const hasMore = products.length < total

  // Lazy load: cuando el sentinel entra en pantalla, pedir la siguiente página.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore()
      },
      { rootMargin: '400px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, onLoadMore, products.length])

  if (!branchId) {
    return <p className="text-white/40 text-sm">Selecciona una sucursal.</p>
  }

  return (
    <>
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 210px)', minHeight: 320 }}>
      {/* Filtros y encabezados — fijos (no hacen scroll) */}
      <div className="shrink-0">
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <div className="flex-1 min-w-[220px] flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
              placeholder="Buscar producto, SKU o código de barras…"
              className="flex-1 bg-surface border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-amber-400"
            />
            <button onClick={onSearch} className="px-4 py-2.5 rounded-xl bg-white/10 text-sm font-bold hover:bg-white/15">
              Buscar
            </button>
          </div>
        </div>

        <p className="text-white/40 text-xs font-medium mb-1">
          {loading
            ? 'Cargando…'
            : `${products.length} de ${total} producto(s) de esta sucursal`}
          {appliedSearch ? ` para “${appliedSearch}”` : ''}
        </p>
        <p className="text-white/30 text-[11px] font-medium mb-3 leading-relaxed">
          Información de referencia: la ubicación de un producto es la de su categoría.
          {withoutShelf > 0 ? ` ${withoutShelf} producto(s) sin estantería.` : ''}
        </p>
      </div>

      {/* Lista — único elemento con scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 pb-4">
        {products.map((p) => (
          <button
            key={p.productVariantId}
            type="button"
            onClick={() => setSelected(p)}
            title="Ver detalle y ubicación en el mapa"
            className="w-full text-left bg-surface border border-white/10 rounded-xl px-4 py-3 hover:border-amber-400/60 hover:bg-white/5 transition-colors"
          >
            <p className="font-bold text-sm truncate">{p.productName}</p>
            <p className="text-white/35 text-xs font-medium truncate">
              SKU {p.sku ?? '—'} · {p.barcode ?? 'sin código'} · stock {p.stock}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {/* Categorías del producto */}
              {p.categories.length > 0 ? (
                p.categories.map((c) => (
                  <span
                    key={c.id}
                    className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/60 text-[10px] font-semibold"
                  >
                    {c.name}
                  </span>
                ))
              ) : (
                <span className="text-white/25 text-[11px] font-medium">Sin categoría</span>
              )}
              {/* Estanterías derivadas de la categoría */}
              <span className="mx-1 text-white/15">·</span>
              {p.shelves.length > 0 ? (
                p.shelves.map((s) => (
                  <span
                    key={s.id}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-400/10 border border-amber-400/30 text-amber-300 text-[10px] font-bold"
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                    {s.code} · {s.name}
                  </span>
                ))
              ) : (
                <span className="px-2 py-0.5 rounded-md bg-white/5 border border-dashed border-white/15 text-white/35 text-[10px] font-semibold">
                  Sin estantería
                </span>
              )}
            </div>
          </button>
        ))}
        {products.length === 0 && !loading && (
          <p className="text-white/30 text-sm text-center py-10">Sin resultados.</p>
        )}
        {/* Sentinel del lazy load infinito */}
        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-4">
            <div className="w-4 h-4 rounded-full border-2 border-white/15 border-t-amber-400 animate-spin" />
            <span className="text-white/30 text-xs font-semibold">
              {loadingMore ? 'Cargando más…' : 'Desplázate para ver más'}
            </span>
          </div>
        )}
      </div>
    </div>

    {selected && (
      <ProductDetailModal
        product={selected}
        shelves={shelves}
        onClose={() => setSelected(null)}
      />
    )}
    </>
  )
}

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginScreen({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Logo y nombre de la tienda configurados en el admin general (endpoint público).
  const [storeLogo, setStoreLogo] = useState<string | null>(null)
  const [storeName, setStoreName] = useState('Mercaldas')
  const passwordRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .storeInfo()
      .then((d) => {
        if (cancelled) return
        setStoreLogo(resolveAssetUrl(d.url))
        setStoreName(d.title?.trim() || 'Mercaldas')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const doLogin = async () => {
    // Mismo criterio que el botón: sin los dos campos no hay nada que enviar.
    if (busy || !identifier.trim() || !password) return
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

  /**
   * Enter encadena el formulario: en el usuario pasa a la contraseña y en la
   * contraseña envía. Sin esto, Enter sobre el usuario dispara el submit del
   * formulario y, con la contraseña vacía, no pasaba nada.
   */
  const onEnter = (action: 'next' | 'submit') => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (action === 'next') passwordRef.current?.focus()
    else void doLogin()
  }

  return (
    <div className="flex h-full flex-col bg-app">
      {/* En pantallas bajas el contenido scrollea y el pie queda visible. */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto px-5">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          {/* Logo de la tienda (el que se configura en el admin general). */}
          {storeLogo && (
            <img
              src={storeLogo}
              alt="Tienda"
              className="h-12 w-auto max-w-[220px] object-contain"
            />
          )}

          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              void doLogin()
            }}
            className="w-full bg-surface-alt border border-white/10 rounded-2xl p-6 flex flex-col gap-4"
          >
            <div className="text-center mb-1">
              <h1 className="text-2xl font-extrabold tracking-tight text-white">
                {storeName} <span className="text-amber-400">Picking</span>
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
                onKeyDown={onEnter('next')}
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
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={onEnter('submit')}
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
              className="mt-1 bg-amber-400 text-on-accent font-bold text-sm rounded-xl px-4 py-2.5 disabled:opacity-40 transition-all"
            >
              {busy ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>

          {/* Marca de la app, al pie del contenido. */}
          <img src={pickingLogo} alt="Picking" className="h-14 w-auto object-contain opacity-90" />
        </div>
      </div>

      <CopyrightFooter />
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
                className="flex items-center gap-3 bg-surface-alt border border-white/10 rounded-xl px-4 py-2.5"
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
            className="mt-3 self-start px-5 py-2.5 rounded-xl bg-amber-400 text-on-accent text-sm font-bold disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Guardar horario'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Categorías: organizar estanterías y productos por categoría ─────────────

function OrgProductRow({ product }: { product: CategoryOrgProduct }) {
  return (
    <tr className="border-t border-white/5">
      <td className="py-2.5 pr-3">
        <p className="text-sm font-semibold truncate max-w-[320px]">{product.productName}</p>
        <p className="text-white/35 text-[10px] font-medium">
          SKU {product.sku ?? '—'} · {product.barcode ?? 'sin código'} · stock {product.stock}
        </p>
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
    api
      .categories(branchId ?? undefined)
      .then(setCategories)
      .catch(() => undefined)
    setSelectedId(null)
    setOrg(null)
  }, [branchId])

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
      const ids = [...new Set([...categoryIdsOf(assignShelfId), selectedId])]
      await api.updateShelf(assignShelfId, { categoryIds: ids })
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
      const ids = categoryIdsOf(shelfId).filter((id) => id !== selectedId)
      await api.updateShelf(shelfId, { categoryIds: ids })
      notify('Estantería quitada de la categoría')
      onChanged()
      void loadOrg(selectedId)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'No se pudo quitar la estantería')
    }
  }

  /** Ids de las categorías de una estantería (según el listado cargado). */
  const categoryIdsOf = (shelfId: number): number[] =>
    shelves.find((s) => s.id === shelfId)?.categories.map((c) => c.id) ?? []

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
            const shelfCount = shelves.filter((s) => s.categories.some((x) => x.id === c.id)).length
            const active = c.id === selectedId
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                  active
                    ? 'bg-amber-400 text-on-accent border-amber-400'
                    : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold truncate">{c.name}</span>
                  <span className={`text-[10px] font-extrabold ${active ? 'text-on-accent/60' : 'text-white/40'}`}>
                    {c.productCount} prod
                  </span>
                </div>
                <span className={`text-[10px] font-semibold ${active ? 'text-on-accent/60' : 'text-white/35'}`}>
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
                    className="flex items-center gap-2 bg-surface-alt border border-white/10 rounded-xl px-3 py-2"
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
                    .filter((s) => !s.categories.some((x) => x.id === org.category.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} · {s.name}
                      </option>
                    ))}
                </select>
                <button
                  onClick={() => void assignShelf()}
                  disabled={!assignShelfId}
                  className="px-3 py-2 rounded-lg bg-amber-400 text-on-accent text-xs font-bold disabled:opacity-40"
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
              <div className="bg-surface-alt border border-white/10 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/35 text-[10px] font-bold uppercase tracking-wider text-left border-b border-white/5 bg-white/5">
                      <th className="px-4 py-2.5">Producto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.products.map((p) => (
                      <OrgProductRow key={p.productVariantId} product={p} />
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
