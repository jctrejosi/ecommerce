import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from './services/api'
import type { PickUser } from './services/api'
import { ChatThread, onChatsChanged } from './PickerChat'
import { onPickingConnection, onPickingEvent } from './services/pickingSocket'
import { onOrderEvent } from './services/ordersSocket'
import type {
  Branch,
  PickerChatConversation,
  PickerHistory,
  PickerSummary,
  PickingOrderDetail,
} from './types'

const fmtTime = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Duración en mm:ss (o h:mm:ss) a partir de milisegundos. */
const fmtDuration = (ms: number) => {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  paid: { label: 'En cola', cls: 'bg-amber-400/15 text-amber-400 border-amber-400/30' },
  preparing: { label: 'Alistando', cls: 'bg-sky-400/15 text-sky-400 border-sky-400/30' },
  ready: { label: 'Listo', cls: 'bg-teal-400/15 text-teal-400 border-teal-400/30' },
  shipped: { label: 'En camino', cls: 'bg-purple-400/15 text-purple-400 border-purple-400/30' },
  delivered: { label: 'Entregado', cls: 'bg-green-400/15 text-green-400 border-green-400/30' },
}

const emptyUserForm = () => ({ fullName: '', username: '', email: '', phone: '', password: '', branchId: '', isSuperuser: false })

// Estilo de la lista de usuarios: tarjetas (kanban) o tabla compacta.
type ViewStyle = 'cards' | 'table'
const VIEW_KEY = 'picking-admin:users-view'
const getStoredView = (): ViewStyle => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards'
  } catch {
    return 'cards'
  }
}

// ─── Vista unificada: usuarios + estado en vivo de los pickers ────────────────

/**
 * Tab "Usuarios": antes había dos pestañas (Usuarios y Pickers). Aquí se juntan:
 * la misma lista sirve para gestionar la cuenta (contraseña, activo, picking) y
 * para ver el estado en vivo de cada picker (pedido en curso, avance, tiempos).
 * El buscador filtra por nombre, usuario, email, teléfono o código de pedido.
 */
export default function UsersView({
  notify,
  currentUserId,
  branchId,
}: {
  notify: (m: string) => void
  currentUserId: number | null
  branchId: number | null
}) {
  const [users, setUsers] = useState<PickUser[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [metrics, setMetrics] = useState<PickerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Estilo de visualización de la lista (se recuerda entre sesiones).
  const [view, setView] = useState<ViewStyle>(getStoredView)
  const changeView = (v: ViewStyle) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* almacenamiento no disponible: se ignora */
    }
  }

  // Gestión de la cuenta
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyUserForm())
  const [saving, setSaving] = useState(false)
  const [reset, setReset] = useState<PickUser | null>(null)
  const [confirm, setConfirm] = useState<{ user: PickUser; kind: UserConfirmKind } | null>(null)

  // Estado en vivo
  const [history, setHistory] = useState<PickerHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [order, setOrder] = useState<PickingOrderDetail | null>(null)
  const [orderLoading, setOrderLoading] = useState(false)
  const [chats, setChats] = useState<PickerChatConversation[]>([])
  const [chatPicker, setChatPicker] = useState<{ id: number; name: string } | null>(null)
  const [connected, setConnected] = useState(false)
  // Reloj para el tiempo transcurrido del pedido en curso.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await api.users(branchId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron cargar los usuarios')
    }
  }, [branchId])

  const loadMetrics = useCallback(async () => {
    try {
      setMetrics(await api.metrics())
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error cargando métricas')
    }
  }, [notify])

  // Sucursales disponibles para asignar a los pickers (una sola por picker).
  const loadBranches = useCallback(async () => {
    try {
      setBranches(await api.branches())
    } catch {
      /* la lista de sucursales no debe tumbar la vista */
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([loadUsers(), loadMetrics(), loadBranches()])
    } finally {
      setLoading(false)
    }
  }, [loadUsers, loadMetrics, loadBranches])

  useEffect(() => {
    void load()
  }, [load])

  // Bandeja de chats. Si el endpoint falla, se ignora: no debe tumbar la lista.
  const loadChats = useCallback(async () => {
    try {
      setChats(await api.chatConversations())
    } catch {
      /* noop */
    }
  }, [])

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  // Respaldo por polling; el evento `picking:chat` refresca al instante.
  useEffect(() => {
    const t = setInterval(() => void loadChats(), 5000)
    return () => clearInterval(t)
  }, [loadChats])

  // Refresco con debounce: un solo escaneo puede generar varios eventos.
  const reloadTimer = useRef<number | null>(null)
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null
      void loadMetrics()
    }, 400)
  }, [loadMetrics])

  // Eventos EN VIVO del picking (conexión compartida, ver `pickingSocket`).
  useEffect(() => onPickingConnection(setConnected), [])
  useEffect(() => onPickingEvent('picking:claim', scheduleReload), [scheduleReload])
  useEffect(() => onPickingEvent('picking:scan', scheduleReload), [scheduleReload])
  useEffect(
    () =>
      onPickingEvent<{ referenceCode?: string }>('picking:delivered', (payload) => {
        scheduleReload()
        notify(`📦 Pedido ${payload?.referenceCode ?? ''} entregado en caja`)
      }),
    [scheduleReload, notify],
  )
  useEffect(() => onChatsChanged(() => void loadChats()), [loadChats])
  useEffect(() => onOrderEvent('order:updated', scheduleReload), [scheduleReload])

  useEffect(() => {
    return () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current)
    }
  }, [])

  // ── Gestión de la cuenta ────────────────────────────────────────────────────

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
        branchId: form.branchId ? Number(form.branchId) : null,
        isSuperuser: form.isSuperuser,
      })
      notify('Usuario creado')
      setForm(emptyUserForm())
      setShowForm(false)
      await loadUsers()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el usuario')
    } finally {
      setSaving(false)
    }
  }

  const applyToggle = async (u: PickUser, kind: UserConfirmKind) => {
    await api.updateUser(u.id, kind === 'active' ? { isActive: !u.isActive } : { isPicker: !u.isPicker })
    notify(
      kind === 'active'
        ? u.isActive
          ? `${u.name} desactivado`
          : `${u.name} activado`
        : u.isPicker
          ? `${u.name} ya no es picker`
          : `${u.name} ahora es picker`,
    )
    await loadUsers()
    await loadMetrics()
  }

  const applyReset = async (u: PickUser, password: string) => {
    await api.resetUserPassword(u.id, password)
    notify(`Contraseña actualizada para ${u.name}`)
  }

  // Asigna (o quita) la sucursal única del picker desde la lista.
  const assignBranch = async (u: PickUser, branchId: number | null) => {
    try {
      await api.updateUser(u.id, { branchId })
      const b = branches.find((x) => x.id === branchId)
      notify(b ? `${u.name} → ${b.name}` : `Sucursal quitada a ${u.name}`)
      await loadUsers()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'No se pudo asignar la sucursal')
    }
  }

  // Un superusuario no puede desactivarse a sí mismo ni dejar el sistema sin
  // ningún superusuario activo (el backend también lo rechaza).
  const activeSuperusers = users.filter((u) => u.isSuperuser && u.isActive).length
  const deactivateBlockedReason = (u: PickUser): string | null => {
    if (!u.isActive) return null
    if (u.isSuperuser && activeSuperusers <= 1) return 'Es el último superusuario activo'
    if (currentUserId !== null && u.id === currentUserId) return 'Es tu propia cuenta'
    return null
  }

  // ── Estado en vivo ──────────────────────────────────────────────────────────

  async function openHistory(p: PickerSummary) {
    setHistoryLoading(true)
    try {
      setHistory(await api.pickerHistory(p.id))
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error cargando historial')
    } finally {
      setHistoryLoading(false)
    }
  }

  async function openOrder(id: number) {
    setOrderLoading(true)
    try {
      setOrder(await api.orderDetail(id))
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Error cargando el pedido')
    } finally {
      setOrderLoading(false)
    }
  }

  const unreadOf = (pickerId: number) => chats.find((c) => c.pickerId === pickerId)?.unread ?? 0

  // ── Filtro ──────────────────────────────────────────────────────────────────

  const metricsById = useMemo(() => new Map(metrics.map((m) => [m.id, m])), [metrics])
  const norm = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!norm) return users
    return users.filter((u) => {
      const m = metricsById.get(u.id)
      return (
        u.name.toLowerCase().includes(norm) ||
        u.username.toLowerCase().includes(norm) ||
        u.email.toLowerCase().includes(norm) ||
        (u.phone ?? '').toLowerCase().includes(norm) ||
        (m?.currentOrder?.referenceCode ?? '').toLowerCase().includes(norm)
      )
    })
  }, [users, metricsById, norm])

  return (
    <div className="flex flex-col gap-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white">Usuarios</h2>
          <p className="text-white/40 text-xs mt-0.5">
            Cuentas de acceso y estado en vivo de los pickers ·{' '}
            <span className={connected ? 'text-green-400' : 'text-amber-400'}>
              {connected ? 'conectado (tiempo real)' : 'reconectando…'}
            </span>
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Conmutador de estilo: tarjetas (kanban) ↔ tabla de lista */}
          <div
            role="group"
            aria-label="Estilo de visualización"
            className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10"
          >
            <button
              type="button"
              onClick={() => changeView('cards')}
              aria-pressed={view === 'cards'}
              title="Ver como tarjetas"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                view === 'cards' ? 'bg-amber-400 text-on-accent' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
                <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
                <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
                <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" stroke="currentColor" strokeWidth="2" />
              </svg>
              Tarjetas
            </button>
            <button
              type="button"
              onClick={() => changeView('table')}
              aria-pressed={view === 'table'}
              title="Ver como lista"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                view === 'table' ? 'bg-amber-400 text-on-accent' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Lista
            </button>
          </div>
          <button
            onClick={() => { void load() }}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-bold disabled:opacity-40"
          >
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button
            onClick={() => {
              // El nuevo usuario nace en la sucursal seleccionada (si hay).
              setForm({ ...emptyUserForm(), branchId: branchId ? String(branchId) : '' })
              setShowForm(true)
            }}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-amber-400 text-on-accent"
          >
            Nuevo usuario
          </button>
        </div>
      </div>

      {/* Buscador: nombre, usuario, email, teléfono o código de pedido */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35 pointer-events-none"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, usuario o código de pedido…"
          className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
        />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm flex items-center gap-3">
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} className="font-extrabold underline">Cerrar</button>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <p className="text-white/40 text-sm py-8 text-center">Cargando usuarios…</p>
      ) : (
        <>
          {view === 'cards' ? (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((u) => {
            const m = metricsById.get(u.id) ?? null
            const blocked = deactivateBlockedReason(u)
            return (
              <div key={u.id} className="bg-surface-alt border border-white/10 rounded-2xl p-3.5">
                {/* Identidad */}
                <div className="flex items-center gap-3">
                  {u.avatarUrl ? (
                    <img
                      src={u.avatarUrl}
                      alt={u.name}
                      className="w-10 h-10 rounded-full object-cover shrink-0 bg-white/5"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-amber-400 text-on-accent font-extrabold flex items-center justify-center text-sm shrink-0">
                      {u.name.charAt(0).toUpperCase() || '?'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-bold truncate">{u.name}</p>
                    <p className="text-white/40 text-xs truncate">@{u.username} · {u.email}</p>
                  </div>

                  {m && (
                    <span
                      className={`shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${
                        m.currentOrder
                          ? 'bg-sky-400/15 text-sky-400 border-sky-400/30'
                          : 'bg-emerald-400/15 text-emerald-400 border-emerald-400/30'
                      }`}
                    >
                      {m.currentOrder ? 'Alistando' : 'Disponible'}
                    </span>
                  )}

                  {m && (
                    <button
                      onClick={() => setChatPicker({ id: u.id, name: u.name })}
                      title="Conversación con el picker"
                      className="relative shrink-0 w-9 h-9 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                      </svg>
                      {unreadOf(u.id) > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-amber-400 text-on-accent text-[10px] font-extrabold flex items-center justify-center">
                          {unreadOf(u.id) > 9 ? '9+' : unreadOf(u.id)}
                        </span>
                      )}
                    </button>
                  )}
                </div>

                {/* Insignias */}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {u.isSuperuser && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-white/10 text-white/70">
                      Admin
                    </span>
                  )}
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

                {/* Sucursal única del picker */}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-white/35 text-[10px] font-bold uppercase tracking-wider shrink-0">
                    Sucursal
                  </span>
                  <select
                    value={u.branchId ?? ''}
                    onChange={(e) =>
                      void assignBranch(u, e.target.value ? Number(e.target.value) : null)
                    }
                    className="flex-1 bg-app border border-white/10 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-amber-400"
                  >
                    <option value="">Sin sucursal</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Estado en vivo del picker */}
                {m && (
                  <>
                    {m.currentOrder ? (
                      <div className="bg-app border border-white/10 rounded-xl p-3 mt-3">
                        <p className="text-white/35 text-[10px] font-bold uppercase tracking-wider mb-1">Alistando ahora</p>
                        <p className="font-extrabold text-sm">{m.currentOrder.referenceCode}</p>
                        <p className="text-white/45 text-xs font-medium truncate">{m.currentOrder.customerName}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${STATUS_LABEL[m.currentOrder.status]?.cls ?? 'bg-white/10 text-white/60 border-white/20'}`}>
                            {STATUS_LABEL[m.currentOrder.status]?.label ?? m.currentOrder.status}
                          </span>
                          <span className="text-white/35 text-[10px] font-medium">{fmtTime(m.currentOrder.pickedAt)}</span>
                          {m.currentOrder.pickedAt && (
                            <span className="ml-auto text-[11px] font-extrabold text-amber-400 tabular-nums">
                              ⏱ {fmtDuration(now - Date.parse(m.currentOrder.pickedAt))}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-400 rounded-full transition-all duration-500"
                            style={{
                              width: `${m.currentOrder.totalPieces > 0 ? Math.min(100, (m.currentOrder.scannedPieces / m.currentOrder.totalPieces) * 100) : 0}%`,
                            }}
                          />
                        </div>
                        <p className="text-white/35 text-[10px] font-medium mt-1">
                          {m.currentOrder.scannedPieces}/{m.currentOrder.totalPieces} piezas · faltan{' '}
                          <span className="text-amber-400 font-bold">
                            {m.currentOrder.remainingPieces} pieza(s) · {m.currentOrder.remainingItems} producto(s)
                          </span>
                        </p>
                        <button
                          onClick={() => void openOrder(m.currentOrder!.id)}
                          className="mt-2 w-full py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 transition-colors"
                        >
                          Abrir pedido (picker y productos)
                        </button>
                      </div>
                    ) : (
                      <div className="bg-app border border-dashed border-white/10 rounded-xl p-3 mt-3 text-center">
                        <p className="text-white/30 text-xs font-medium">Sin pedido en curso</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-center">
                        <p className="text-xl font-extrabold text-green-400">{m.completedToday}</p>
                        <p className="text-white/35 text-[10px] font-bold uppercase tracking-wider">Entregados hoy</p>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 text-center">
                        <p className="text-xl font-extrabold">{m.dispatchedTotal}</p>
                        <p className="text-white/35 text-[10px] font-bold uppercase tracking-wider">Total despachado</p>
                      </div>
                    </div>

                    <button
                      onClick={() => void openHistory(m)}
                      className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-bold hover:bg-white/10 transition-colors mt-2"
                    >
                      Ver historial completo →
                    </button>
                  </>
                )}

                {/* Gestión de la cuenta */}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button
                    onClick={() => setReset(u)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/70 hover:text-white"
                  >
                    Cambiar contraseña
                  </button>
                  <button
                    onClick={() => setConfirm({ user: u, kind: 'active' })}
                    disabled={blocked !== null}
                    title={blocked ?? 'Desactivar o activar el acceso'}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-white/70 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {u.isActive ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    onClick={() => setConfirm({ user: u, kind: 'picker' })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      u.isPicker
                        ? 'bg-amber-400/15 border-amber-400/40 text-amber-400'
                        : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
                    }`}
                  >
                    {u.isPicker ? 'Quitar de picking' : 'Habilitar picking'}
                  </button>
                </div>

                {blocked && (
                  <p className="text-white/40 text-[11px] font-semibold mt-2 flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {blocked === 'Es tu propia cuenta'
                      ? 'No puedes desactivar tu propia cuenta'
                      : 'No puedes desactivar al último superusuario activo'}
                  </p>
                )}
              </div>
            )
          })}
            </div>
          ) : (
            <UsersTable
              users={filtered}
              branches={branches}
              metricsById={metricsById}
              now={now}
              unreadOf={unreadOf}
              blockedReason={deactivateBlockedReason}
              onChat={(u) => setChatPicker({ id: u.id, name: u.name })}
              onOrder={openOrder}
              onHistory={(m) => void openHistory(m)}
              onReset={(u) => setReset(u)}
              onConfirm={(u, kind) => setConfirm({ user: u, kind })}
              onAssignBranch={(u, b) => void assignBranch(u, b)}
            />
          )}
          {filtered.length === 0 && (
            <p className="text-white/30 text-sm text-center py-10">
              {users.length === 0 ? 'Aún no hay usuarios.' : 'Ningún usuario coincide con la búsqueda.'}
            </p>
          )}
        </>
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
            className="w-full sm:max-w-lg bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl p-5 flex flex-col gap-4"
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
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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

            <label className="flex flex-col gap-1.5">
              <span className="text-white/40 text-[11px] font-bold uppercase tracking-wider">
                Sucursal (opcional)
              </span>
              <select
                value={form.branchId}
                onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
                className="bg-app border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
              >
                <option value="">Sin sucursal</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isSuperuser}
                onChange={(e) => setForm((f) => ({ ...f, isSuperuser: e.target.checked }))}
                className="w-4 h-4 accent-amber-400"
              />
              <span className="text-white/70 text-sm font-medium">
                Administrador (superusuario)
              </span>
            </label>

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
                className="px-4 py-2.5 rounded-xl text-sm font-bold bg-white text-app disabled:opacity-40"
              >
                {saving ? 'Guardando…' : 'Crear usuario'}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirm && (
        <ConfirmUserModal
          user={confirm.user}
          kind={confirm.kind}
          onClose={() => setConfirm(null)}
          onConfirm={() => applyToggle(confirm.user, confirm.kind)}
        />
      )}

      {reset && (
        <ResetPasswordModal
          user={reset}
          onClose={() => setReset(null)}
          onConfirm={(password) => applyReset(reset, password)}
        />
      )}

      {/* Modal de historial */}
      {history && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={() => setHistory(null)}>
          <div
            className="w-full sm:max-w-3xl bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[88dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-4 pb-3 border-b border-white/8 flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-extrabold text-lg">Historial de {history.picker.name}</h2>
                <p className="text-white/40 text-xs font-medium">{history.orders.length} pedido(s) despachado(s)</p>
              </div>
              <button
                onClick={() => setHistory(null)}
                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {historyLoading ? (
                <p className="text-white/40 text-sm text-center py-10">Cargando…</p>
              ) : history.orders.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-10">Aún no ha despachado pedidos.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/35 text-[10px] font-bold uppercase tracking-wider text-left">
                      <th className="pb-2 pr-3">Pedido</th>
                      <th className="pb-2 pr-3">Cliente</th>
                      <th className="pb-2 pr-3 text-right">Total</th>
                      <th className="pb-2 pr-3 text-center">Piezas</th>
                      <th className="pb-2 pr-3 text-right">Duración</th>
                      <th className="pb-2 pr-3">Entregado</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {history.orders.map((o) => (
                      <tr key={o.id} className="border-t border-white/5">
                        <td className="py-2.5 pr-3 font-bold">{o.referenceCode}</td>
                        <td className="py-2.5 pr-3 text-white/60 truncate max-w-[150px]">{o.customerName}</td>
                        <td className="py-2.5 pr-3 text-right font-bold">
                          {o.grandTotal.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 pr-3 text-center text-white/60">
                          {o.scannedPieces}/{o.totalPieces}
                        </td>
                        <td className="py-2.5 pr-3 text-right text-amber-400 font-bold tabular-nums">
                          {o.pickedAt && o.completedAt
                            ? fmtDuration(Date.parse(o.completedAt) - Date.parse(o.pickedAt))
                            : '—'}
                        </td>
                        <td className="py-2.5 pr-3 text-white/45 text-xs">{fmtTime(o.deliveredAt)}</td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => void openOrder(o.id)}
                            className="text-xs font-bold text-amber-400 hover:underline"
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chat con el picker (el mismo componente que usa la bandeja del header) */}
      {chatPicker && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6"
          onClick={() => setChatPicker(null)}
        >
          <div
            className="w-full sm:max-w-lg bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[88dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <ChatThread
              pickerId={chatPicker.id}
              name={chatPicker.name}
              onClose={() => setChatPicker(null)}
              onRead={loadChats}
            />
          </div>
        </div>
      )}

      {/* Modal del pedido: picker + productos */}
      {order && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={() => setOrder(null)}>
          <div
            className="w-full sm:max-w-2xl bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[88dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-4 pb-3 border-b border-white/8 flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-extrabold text-lg">{order.referenceCode}</h2>
                <p className="text-white/40 text-xs font-medium">{order.customerName}</p>
              </div>
              <button
                onClick={() => setOrder(null)}
                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {orderLoading ? (
                <p className="text-white/40 text-sm text-center py-10">Cargando…</p>
              ) : (
                <>
                  <div className="bg-app border border-white/10 rounded-xl p-3 mb-4 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full bg-amber-400 text-on-accent flex items-center justify-center font-extrabold">
                      {order.pickerName?.[0]?.toUpperCase() ?? '?'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-white/35 text-[10px] font-bold uppercase tracking-wider">Picker asociado</p>
                      <p className="font-extrabold truncate">{order.pickerName ?? 'Sin asignar'}</p>
                    </div>
                    <span className={`ml-auto text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${STATUS_LABEL[order.status]?.cls ?? 'bg-white/10 text-white/60 border-white/20'}`}>
                      {STATUS_LABEL[order.status]?.label ?? order.status}
                    </span>
                  </div>

                  <p className="text-white/35 text-[10px] font-bold uppercase tracking-wider mb-2">
                    Productos ({order.itemsCount}) · {order.scannedPieces}/{order.totalPieces} piezas
                  </p>
                  <div className="space-y-2">
                    {order.items.map((it) => (
                      <div key={it.id} className="bg-app border border-white/10 rounded-xl px-3 py-2.5 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold truncate">{it.name}</p>
                          <p className="text-white/35 text-[10px] font-medium truncate">
                            SKU {it.sku ?? '—'} · {it.barcode ?? 'sin código'}{it.plu ? ` · PLU ${it.plu}` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-extrabold ${it.pickedQty >= it.quantity ? 'text-green-400' : 'text-amber-400'}`}>
                            {it.pickedQty}/{it.quantity}
                          </p>
                          <p className="text-white/30 text-[10px] font-medium">piezas</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Vista de lista (tabla) ────────────────────────────────────────────────────

/**
 * Lista compacta de usuarios: una fila por cuenta con rol, estado en vivo,
 * avance del pedido en curso, conteos del día y las mismas acciones que la tarjeta.
 */
function UsersTable({
  users,
  branches,
  metricsById,
  now,
  unreadOf,
  blockedReason,
  onChat,
  onOrder,
  onHistory,
  onReset,
  onConfirm,
  onAssignBranch,
}: {
  users: PickUser[]
  branches: Branch[]
  metricsById: Map<number, PickerSummary>
  now: number
  unreadOf: (pickerId: number) => number
  blockedReason: (u: PickUser) => string | null
  onChat: (u: PickUser) => void
  onOrder: (id: number) => void
  onHistory: (m: PickerSummary) => void
  onReset: (u: PickUser) => void
  onConfirm: (u: PickUser, kind: UserConfirmKind) => void
  onAssignBranch: (u: PickUser, branchId: number | null) => void
}) {
  const iconBtn =
    'w-8 h-8 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center transition-colors'
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-surface-alt">
      <table className="w-full text-sm min-w-[1080px]">
        <thead>
          <tr className="text-left text-white/40 text-[10px] font-bold uppercase tracking-wider border-b border-white/10">
            <th className="px-3 py-3">Usuario</th>
            <th className="px-3 py-3">Sucursal</th>
            <th className="px-3 py-3">Rol</th>
            <th className="px-3 py-3">Estado</th>
            <th className="px-3 py-3">Pedido en curso</th>
            <th className="px-3 py-3">Avance</th>
            <th className="px-3 py-3 text-center">Hoy</th>
            <th className="px-3 py-3 text-center">Total</th>
            <th className="px-3 py-3 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const m = metricsById.get(u.id) ?? null
            const co = m?.currentOrder ?? null
            const blocked = blockedReason(u)
            const unread = unreadOf(u.id)
            const pct =
              co && co.totalPieces > 0
                ? Math.min(100, (co.scannedPieces / co.totalPieces) * 100)
                : 0
            return (
              <tr key={u.id} className="border-t border-white/5 align-top hover:bg-white/5 transition-colors">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    {u.avatarUrl ? (
                      <img
                        src={u.avatarUrl}
                        alt={u.name}
                        className="w-9 h-9 rounded-full object-cover shrink-0 bg-white/5"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-amber-400 text-on-accent font-extrabold flex items-center justify-center text-sm shrink-0">
                        {u.name.charAt(0).toUpperCase() || '?'}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-bold text-white truncate max-w-[170px]">{u.name}</p>
                      <p className="text-white/40 text-xs truncate max-w-[170px]">@{u.username}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <select
                    value={u.branchId ?? ''}
                    onChange={(e) =>
                      onAssignBranch(u, e.target.value ? Number(e.target.value) : null)
                    }
                    className="bg-app border border-white/10 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-amber-400 max-w-[170px]"
                  >
                    <option value="">Sin sucursal</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.isSuperuser && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-white/10 text-white/70">
                        Admin
                      </span>
                    )}
                    {u.isPicker && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-400/15 text-amber-400">
                        Picker
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        u.isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/8 text-white/40'
                      }`}
                    >
                      {u.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  {m ? (
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-extrabold ${
                        co
                          ? 'bg-sky-400/15 text-sky-400 border-sky-400/30'
                          : 'bg-emerald-400/15 text-emerald-400 border-emerald-400/30'
                      }`}
                    >
                      {co ? 'Alistando' : 'Disponible'}
                    </span>
                  ) : (
                    <span className="text-white/25 text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {co ? (
                    <div className="min-w-[150px]">
                      <button
                        onClick={() => onOrder(co.id)}
                        title="Abrir pedido (picker y productos)"
                        className="font-extrabold whitespace-nowrap hover:text-amber-400 transition-colors"
                      >
                        {co.referenceCode}
                      </button>
                      <p className="text-white/40 text-xs truncate max-w-[180px]">{co.customerName}</p>
                      {co.pickedAt && (
                        <p className="text-amber-400 text-[11px] font-extrabold tabular-nums">
                          ⏱ {fmtDuration(now - Date.parse(co.pickedAt))}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-white/25 text-xs">Sin pedido</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {co ? (
                    <div className="min-w-[130px]">
                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-400 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-white/40 text-[10px] font-medium mt-1">
                        {co.scannedPieces}/{co.totalPieces} · faltan{' '}
                        <span className="text-amber-400 font-bold">{co.remainingPieces}</span>
                      </p>
                    </div>
                  ) : (
                    <span className="text-white/25 text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-center font-extrabold text-green-400 tabular-nums">
                  {m ? m.completedToday : '—'}
                </td>
                <td className="px-3 py-3 text-center font-extrabold tabular-nums">
                  {m ? m.dispatchedTotal : '—'}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {m && (
                      <button onClick={() => onChat(u)} title="Conversación con el picker" className={`relative ${iconBtn}`}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                        {unread > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-amber-400 text-on-accent text-[10px] font-extrabold flex items-center justify-center">
                            {unread > 9 ? '9+' : unread}
                          </span>
                        )}
                      </button>
                    )}
                    {m && (
                      <button onClick={() => onHistory(m)} title="Historial de pedidos" className={iconBtn}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7v5l3 2" />
                        </svg>
                      </button>
                    )}
                    <button onClick={() => onReset(u)} title="Cambiar contraseña" className={iconBtn}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="8" cy="15" r="4" />
                        <path d="m11 12 8-8m-2 2 2 2m-4-4 2 2" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onConfirm(u, 'active')}
                      disabled={blocked !== null}
                      title={blocked ?? (u.isActive ? 'Desactivar acceso' : 'Activar acceso')}
                      className={`${iconBtn} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3v9" />
                        <path d="M7.5 6.5a8 8 0 1 0 9 0" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onConfirm(u, 'picker')}
                      title={u.isPicker ? 'Quitar de picking' : 'Habilitar picking'}
                      className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
                        u.isPicker
                          ? 'bg-amber-400/15 border-amber-400/40 text-amber-400'
                          : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                      }`}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7l9-4 9 4-9 4-9-4z" />
                        <path d="M3 7v10l9 4 9-4V7" />
                        <path d="M12 11v10" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Modal de confirmación para acciones sobre un usuario ─────────────────────

type UserConfirmKind = 'active' | 'picker'

/**
 * Confirmación de acciones sensibles sobre un usuario (activar/desactivar y
 * habilitar/quitar de picking). Como el borrado de estanterías, exige teclear
 * el nombre para habilitar el botón, así se evita cambiar accesos por un clic
 * accidental.
 */
function ConfirmUserModal({
  user,
  kind,
  onClose,
  onConfirm,
}: {
  user: PickUser
  kind: UserConfirmKind
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  // Si el usuario no tiene nombre, se usa el usuario como texto a teclear.
  const expected = user.name.trim() || user.username.trim()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matches = typed.trim().toLowerCase() === expected.toLowerCase()

  // Desactivar o quitar de picking quitan acceso; activar/habilitar lo dan.
  const destructive = kind === 'active' ? user.isActive : user.isPicker
  const title =
    kind === 'active'
      ? user.isActive
        ? 'Desactivar usuario'
        : 'Activar usuario'
      : user.isPicker
        ? 'Quitar de picking'
        : 'Habilitar picking'
  const confirmLabel =
    kind === 'active'
      ? user.isActive
        ? 'Desactivar'
        : 'Activar'
      : user.isPicker
        ? 'Quitar de picking'
        : 'Habilitar'
  const message =
    kind === 'active'
      ? user.isActive
        ? 'Se bloqueará el acceso al panel y a la app móvil de:'
        : 'Se restablecerá el acceso al panel y a la app móvil de:'
      : user.isPicker
        ? 'Dejará de aparecer en el login de la app móvil y no podrá recibir pedidos:'
        : 'Aparecerá en el login de la app móvil y podrá recibir pedidos:'

  async function confirm() {
    if (!matches || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo actualizar el usuario')
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
          <h2 className={`font-extrabold text-lg ${destructive ? 'text-red-400' : 'text-amber-400'}`}>{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center" title="Cerrar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-white/70 leading-relaxed">
            {message} <span className="font-bold text-white">{user.name || user.username}</span>
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
              className={`mt-1 w-full bg-app border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none ${destructive ? 'focus:border-red-400' : 'focus:border-amber-400'}`}
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
            className={`flex-1 py-3 rounded-xl text-sm font-extrabold disabled:opacity-40 ${
              destructive ? 'bg-red-500 text-white' : 'bg-amber-400 text-on-accent'
            }`}
          >
            {busy ? 'Guardando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal para cambiar la contraseña de un usuario ──────────────────────────

/**
 * Cambio de contraseña de un usuario desde un modal (antes era un input en
 * línea dentro de la tarjeta). Exige mínimo 8 caracteres, como el backend.
 */
function ResetPasswordModal({
  user,
  onClose,
  onConfirm,
}: {
  user: PickUser
  onClose: () => void
  onConfirm: (password: string) => Promise<void>
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tooShort = password.length < 8

  async function confirm() {
    if (tooShort || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(password)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cambiar la contraseña')
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
          <h2 className="font-extrabold text-lg text-amber-400">Cambiar contraseña</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center" title="Cerrar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-white/70 leading-relaxed">
            Nueva contraseña para <span className="font-bold text-white">{user.name || user.username}</span>.
          </p>

          <label className="block">
            <span className="text-white/50 text-xs font-semibold">Contraseña (mínimo 8 caracteres)</span>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirm() }}
              placeholder="Nueva contraseña"
              autoComplete="new-password"
              className="mt-1 w-full bg-app border border-white/10 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
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
            disabled={tooShort || busy}
            className="flex-1 py-3 rounded-xl bg-amber-400 text-on-accent text-sm font-extrabold disabled:opacity-40"
          >
            {busy ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </div>
      </div>
    </div>
  )
}
