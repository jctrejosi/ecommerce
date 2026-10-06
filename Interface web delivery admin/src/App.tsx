import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  ChevronDown,
  Loader2,
  LogOut,
  LocateFixed,
  MessageCircle,
  Monitor,
  Moon,
  Package,
  RefreshCw,
  Store,
  Sun,
  Truck,
  User,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  AuthUser,
  Branch,
  DriverConversation,
  DriverFilter,
  FleetDriver,
} from './types';
import { api, ApiError, getToken, setToken } from './services/api';
import {
  connectFleetSocket,
  connectOrdersSocket,
  type FleetChatEvent,
  type FleetLocationEvent,
  type FleetStatusEvent,
} from './services/socket';
import { filterDrivers, isDriverOnline } from './lib/status';
import { useAccent, useTheme, type Accent, type Theme } from './lib/theme';
import { initials } from './lib/format';
import {
  notificationPermission,
  notificationsSupported,
  notify,
  requestNotificationPermission,
  type NotificationPermissionState,
} from './services/browserNotifications';
import LoginScreen from './components/LoginScreen';
import AppFooter from './components/AppFooter';
import ProfileModal from './components/ProfileModal';
// El logo del header es el de DSI; el del icono de las notificaciones sigue
// siendo delivery.png.
import headerLogo from './assets/logo.png';
import FleetMap, { type FleetMapHandle } from './components/FleetMap';
import DriversSidebar from './components/DriversSidebar';
import DriversPanel from './components/DriversPanel';
import OrdersPanel from './components/OrdersPanel';
import DriverFormModal from './components/DriverFormModal';
import DriverChatModal from './components/DriverChatModal';

type Tab = 'map' | 'drivers' | 'orders';

const TABS: { key: Tab; label: string; icon: typeof Truck }[] = [
  { key: 'map', label: 'Mapa', icon: Truck },
  { key: 'drivers', label: 'Repartidores', icon: Users },
  { key: 'orders', label: 'Pedidos', icon: Package },
];

/** Temas del menú de usuario: botón circular con el color de cada uno. */
const THEMES: {
  key: Theme;
  label: string;
  icon: typeof Sun;
  bg: string;
  fg: string;
}[] = [
  { key: 'light', label: 'Claro', icon: Sun, bg: '#ffffff', fg: '#0f172a' },
  { key: 'dark', label: 'Oscuro', icon: Moon, bg: '#0f172a', fg: '#e2e8f0' },
  {
    key: 'system',
    label: 'Sistema',
    icon: Monitor,
    bg: 'linear-gradient(135deg, #ffffff 50%, #0f172a 50%)',
    fg: '#ffffff',
  },
];

/** Colores de acento del menú de usuario (botones, focos y selección). */
const ACCENTS: { key: Accent; label: string; color: string; on: string }[] = [
  { key: 'ambar', label: 'Ámbar', color: '#fbbf24', on: '#451a03' },
  { key: 'azul', label: 'Azul', color: '#60a5fa', on: '#0b1e46' },
  { key: 'verde', label: 'Verde', color: '#34d399', on: '#022c22' },
  { key: 'bosque', label: 'Verde bosque', color: '#22c55e', on: '#052e16' },
  { key: 'violeta', label: 'Violeta', color: '#a78bfa', on: '#2e1065' },
  { key: 'rosa', label: 'Rosa', color: '#fb7185', on: '#4c0519' },
];

/** Explicación (título del botón) según el estado de las notificaciones. */
const NOTIF_HINTS: Record<NotificationPermissionState, string> = {
  granted: 'Notificaciones del navegador activadas · clic para probar',
  default: 'Activar notificaciones del navegador',
  denied: 'Notificaciones bloqueadas: actívalas en los permisos del sitio',
  insecure: 'Las notificaciones necesitan https:// o localhost',
  unsupported: 'Este navegador no soporta notificaciones',
};

export default function App() {
  const [booting, setBooting] = useState(() => Boolean(getToken()));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tab, setTab] = useState<Tab>('map');
  /** Menú del usuario (avatar): cambiador de temas. */
  const [userMenu, setUserMenu] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const [accent, setAccent] = useAccent();

  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // ── Sucursal: filtro transversal (mapa, repartidores y pedidos) ──
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<DriverFilter>('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; driver: FleetDriver; focusReset?: boolean }
    | null
  >(null);

  // ── Chat repartidor ↔ admin ──
  const [chats, setChats] = useState<DriverConversation[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDriverId, setChatDriverId] = useState<number | null>(null);
  // Se incrementa con cada mensaje recibido por socket: fuerza refrescar el hilo.
  const [chatTick, setChatTick] = useState(0);

  // ── Notificaciones del navegador (avisos del sistema con el panel abierto) ──
  const [notifPermission, setNotifPermission] = useState<NotificationPermissionState>(
    () => notificationPermission(),
  );

  const mapRef = useRef<FleetMapHandle | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * El socket se conecta una sola vez (no debe reconectarse con cada refresco de
   * flota), así que el nombre del repartidor que avisa se lee de este ref.
   */
  const driversRef = useRef<FleetDriver[]>([]);

  // ── Boot: validar sesión guardada ──
  useEffect(() => {
    if (!getToken()) {
      setBooting(false);
      return;
    }
    api
      .me()
      .then((profile) => {
        setUser(profile);
        // El admin de sucursal queda fijado a su sucursal.
        if (profile.branchId != null) setBranchId(profile.branchId);
        setBooting(false);
      })
      .catch(() => {
        setToken(null);
        setBooting(false);
      });
  }, []);

  // ── Sucursales del selector (el backend ya aplica el alcance del admin) ──
  useEffect(() => {
    if (!user) return;
    api
      .branches()
      .then((bs) => {
        setBranches(bs);
        if (user.branchId != null) setBranchId(user.branchId);
      })
      .catch(() => undefined);
  }, [user]);

  // Al cambiar de sucursal se limpia la selección (puede quedar fuera del filtro).
  useEffect(() => {
    setSelectedId(null);
    setHiddenIds(new Set());
  }, [branchId]);

  // ── Carga de datos ──
  // Los pedidos los carga la propia pestaña "Pedidos" (paginados, de a 20);
  // aquí solo se refresca la flota. Los sockets avisan al panel vía `lastSync`.
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await api.drivers(branchId);
      setDrivers(d);
      setLastSync(new Date());
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setToken(null);
        setUser(null);
      } else {
        setError(err instanceof ApiError ? err.message : 'No se pudo actualizar la flota.');
      }
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    if (!user) return;
    void refresh();
    const interval = setInterval(() => void refresh(true), 30_000);
    return () => clearInterval(interval);
  }, [user, refresh]);

  // ── Bandeja de chat (no leídos por repartidor) ──
  const refreshChats = useCallback(async () => {
    try {
      setChats(await api.chats());
    } catch {
      /* el chat no debe tumbar el panel: se reintenta en el siguiente ciclo */
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshChats();
    // Respaldo del socket (que avisa al instante de cada mensaje).
    const interval = setInterval(() => void refreshChats(), 30_000);
    return () => clearInterval(interval);
  }, [user, refreshChats]);

  /** Abre la bandeja (sin id) o el hilo de un repartidor concreto. */
  const openChat = useCallback((driverId: number | null) => {
    setChatDriverId(driverId);
    setChatOpen(true);
  }, []);

  /**
   * Botón del header: pide permiso en el primer clic y, con las notificaciones
   * ya activas, manda una de prueba para poder comprobarlas.
   */
  const handleNotificationsClick = useCallback(async () => {
    if (!notificationsSupported()) {
      setNotifPermission(notificationPermission());
      return;
    }
    if (notificationPermission() === 'granted') {
      notify({
        title: 'Delivery Admin',
        body: 'Así te avisaremos cuando un repartidor te escriba.',
      });
      return;
    }
    setNotifPermission(await requestNotificationPermission());
  }, []);

  // ── Socket en tiempo real ──
  // La notificación del navegador necesita el nombre del repartidor: el socket
  // no puede depender de `drivers` (se reconectaría en cada refresco de flota),
  // así que la lista se lee de este ref.
  useEffect(() => {
    driversRef.current = drivers;
  }, [drivers]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refresh(true);
    }, 1500);
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const disconnect = connectFleetSocket({
      onConnect: () => {
        setConnected(true);
        scheduleRefresh();
      },
      onDisconnect: () => setConnected(false),
      onLocation: (p: FleetLocationEvent) => {
        setDrivers((prev) =>
          prev.map((d) =>
            d.id === p.driverId
              ? {
                  ...d,
                  location: { lat: p.lat, lng: p.lng },
                  lastLocationAt: p.at ?? new Date().toISOString(),
                }
              : d,
          ),
        );
      },
      onStatus: (_p: FleetStatusEvent) => scheduleRefresh(),
      onChat: (p: FleetChatEvent) => {
        // Llega un mensaje (en cualquier sentido): refresca badges e hilo.
        setChatTick((t) => t + 1);
        void refreshChats();
        // Solo avisan los del repartidor: los del admin los escribió él mismo.
        if (p.message?.senderType === 'driver') {
          const nombre =
            driversRef.current.find((d) => d.id === p.driverId)?.fullName ?? 'Repartidor';
          notify({
            title: `Mensaje de ${nombre}`,
            body: p.message.body,
            tag: `delivery-chat-${p.driverId}`,
            onClick: () => openChat(p.driverId),
          });
        }
      },
    });
    // Y el canal general de pedidos: pagos, picking y cambios del propio panel
    // no pasan por `/delivery`, así que sin esto la lista quedaría congelada.
    const disconnectOrders = connectOrdersSocket({
      onConnect: () => scheduleRefresh(),
      onOrderUpdated: () => scheduleRefresh(),
    });
    return () => {
      disconnectOrders();
      disconnect();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [user, scheduleRefresh, refreshChats, openChat]);

  // ── Acciones ──
  const handleLogin = useCallback((token: string, u: AuthUser) => {
    setToken(token);
    setUser(u);
    if (u.branchId != null) setBranchId(u.branchId);
  }, []);

  const handleLogout = useCallback(() => {
    setUserMenu(false);
    setToken(null);
    setUser(null);
    setDrivers([]);
    setSelectedId(null);
    setBranchId(null);
  }, []);

  const changeDriverColor = useCallback(
    (driver: FleetDriver, color: string) => {
      setDrivers((prev) =>
        prev.map((d) => (d.id === driver.id ? { ...d, routeColor: color } : d)),
      );
      void api
        .updateDriver(driver.id, { routeColor: color })
        .catch(() => scheduleRefresh());
    },
    [scheduleRefresh],
  );

  const handleSaved = useCallback(
    (saved: FleetDriver) => {
      setModal(null);
      setDrivers((prev) => {
        const exists = prev.some((d) => d.id === saved.id);
        return exists ? prev.map((d) => (d.id === saved.id ? saved : d)) : [...prev, saved];
      });
      setSelectedId(saved.id);
    },
    [],
  );

  const locateDriver = useCallback((driverId: number) => {
    setSelectedId(driverId);
    setStatusFilter('all');
    setHiddenIds(new Set());
    setTab('map');
  }, []);

  const visibleDrivers = useMemo(
    () => filterDrivers(drivers, statusFilter),
    [drivers, statusFilter],
  );

  const stats = useMemo(() => {
    const active = drivers.filter((d) => d.isActive);
    return {
      total: drivers.length,
      active: active.length,
      available: active.filter((d) => isDriverOnline(d) && d.isAvailable && !d.activeAssignment)
        .length,
      withOrder: active.filter((d) => d.activeAssignment).length,
      inDelivery: active.filter((d) => d.activeAssignment?.status === 'IN_DELIVERY').length,
      offline: active.filter((d) => !isDriverOnline(d)).length,
    };
  }, [drivers]);

  /** Mensajes del chat sin leer (badge del header). */
  const unreadTotal = useMemo(
    () => chats.reduce((n, c) => n + c.unread, 0),
    [chats],
  );

  const unreadByDriver = useMemo(
    () => new Map(chats.map((c) => [c.driverId, c.unread])),
    [chats],
  );
  const unreadOf = useCallback(
    (driverId: number) => unreadByDriver.get(driverId) ?? 0,
    [unreadByDriver],
  );

  // Alcance del admin: si tiene sucursal asignada, el selector queda fijado.
  const scopedBranchId = user?.branchId ?? null;

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-3">
        <Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Topbar ──
          El header es un flex item y por tanto crea su propio contexto de
          apilamiento (z-index aplica aunque position sea static). Debe quedar
          POR ENCIMA del contenido (los encabezados sticky de las tablas usan
          z-10 y los overlays del mapa z-500/600) pero por DEBAJO de los modales
          (z-1000); si no, el dropdown del usuario queda tapado por las tablas. */}
      <header className="z-900 flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2">
        {/* Marca: el logo ocupa el ancho del título (w-full sobre el texto) */}
        <div className="flex shrink-0 flex-col items-center justify-center gap-1">
          <img
            src={headerLogo}
            alt="Mercaldas"
            className="h-auto w-0 min-w-full object-contain"
          />
          <p className="whitespace-nowrap text-[11px] font-extrabold uppercase leading-none tracking-[0.16em] text-ink">
            Delivery
          </p>
        </div>

        <nav className="ml-2 flex shrink-0 gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
                  tab === t.key
                    ? 'bg-invert text-invert-ink'
                    : 'text-ink-faint hover:bg-surface-3'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Filtro por sucursal: aplica al mapa, a los repartidores y a los pedidos. */}
        {branches.length > 0 && (
          <label
            className="flex shrink-0 items-center gap-1.5"
            title={
              scopedBranchId != null
                ? 'Solo puedes ver tu sucursal'
                : 'Filtrar por sucursal'
            }
          >
            <Store className="h-4 w-4 text-ink-faint" />
            <select
              value={branchId ?? ''}
              onChange={(e) =>
                setBranchId(e.target.value ? Number(e.target.value) : null)
              }
              disabled={scopedBranchId != null}
              className="cursor-pointer rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-ink-soft outline-none transition hover:bg-surface-3 focus:border-accent disabled:cursor-default disabled:opacity-70"
            >
              {scopedBranchId == null && (
                <option value="">Todas las sucursales</option>
              )}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Las cifras de la flota (entregas / pedidos / desconectados) se
              movieron sobre el mapa, en la esquina superior derecha. */}
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
              connected ? 'bg-surface-3 text-ink-soft' : 'bg-rose-50 text-rose-600'
            }`}
            title={connected ? 'Conectado en tiempo real' : 'Sin conexión en vivo · polling cada 30 s'}
          >
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? 'En vivo' : 'Sin señal'}
          </span>
          {lastSync && (
            <span className="hidden text-[11px] text-ink-faint sm:block">
              Sincronizado {lastSync.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => void refresh()}
            disabled={loading}
            title="Actualizar ahora"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-3 hover:text-ink-soft"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => void handleNotificationsClick()}
            title={NOTIF_HINTS[notifPermission]}
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-3 hover:text-ink-soft"
          >
            {notifPermission === 'granted' ? (
              <BellRing className="h-4 w-4 text-emerald-600" />
            ) : notifPermission === 'default' || notifPermission === 'denied' ? (
              <Bell className="h-4 w-4" />
            ) : (
              <BellOff className="h-4 w-4" />
            )}
            {notifPermission === 'default' && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[8px] font-bold text-white">
                !
              </span>
            )}
          </button>

          <button
            onClick={() => openChat(null)}
            title="Chat con repartidores"
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-3 hover:text-ink-soft"
          >
            <MessageCircle className="h-4 w-4" />
            {unreadTotal > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {unreadTotal > 99 ? '99+' : unreadTotal}
              </span>
            )}
          </button>

          <div className="relative ml-1 flex items-center border-l border-line pl-3">
            <button
              onClick={() => setUserMenu((v) => !v)}
              title="Cuenta y tema"
              aria-haspopup="menu"
              aria-expanded={userMenu}
              className="flex items-center gap-2 rounded-xl px-1.5 py-1 text-left transition-colors hover:bg-surface-3"
            >
              <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-invert text-xs font-bold text-invert-ink">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(user.fullName || user.username)
                )}
              </div>
              <div className="hidden leading-tight md:block">
                <p className="text-xs font-semibold text-ink">
                  {user.fullName || user.username}
                </p>
                <p className="text-[10px] text-ink-faint">Administrador</p>
              </div>
              <ChevronDown
                className={`hidden h-3.5 w-3.5 text-ink-faint transition-transform md:block ${
                  userMenu ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Menú de cuenta: perfil, sesión y tema del panel. */}
            {userMenu && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setUserMenu(false)}
                  aria-hidden
                />
                <div className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
                  <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-invert text-xs font-bold text-invert-ink">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initials(user.fullName || user.username)
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-ink">
                        {user.fullName || user.username}
                      </p>
                      <p className="truncate text-[11px] text-ink-faint">{user.email}</p>
                    </div>
                  </div>

                  <div className="p-1.5">
                    <button
                      onClick={() => {
                        setUserMenu(false);
                        setProfileOpen(true);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface-2"
                    >
                      <User className="h-4 w-4 text-ink-faint" /> Mi perfil
                    </button>
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-500/10"
                    >
                      <LogOut className="h-4 w-4" /> Cerrar sesión
                    </button>
                  </div>

                  <div className="border-t border-line p-3">
                    <p className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                      Tema
                    </p>
                    <div className="flex items-center gap-2 px-1 pb-2 pt-0.5">
                      {THEMES.map((t) => {
                        const Icon = t.icon;
                        const active = theme === t.key;
                        return (
                          <button
                            key={t.key}
                            onClick={() => {
                              setTheme(t.key);
                              setUserMenu(false);
                            }}
                            title={t.label}
                            aria-label={t.label}
                            role="menuitemradio"
                            aria-checked={active}
                            className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                              active
                                ? 'ring-2 ring-ink'
                                : 'ring-1 ring-line hover:ring-ink-faint'
                            }`}
                            style={{ background: t.bg }}
                          >
                            <Icon
                              className="h-3.5 w-3.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
                              style={{ color: t.fg }}
                            />
                          </button>
                        );
                      })}
                    </div>
                    <p className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                      Color
                    </p>
                    <div className="flex items-center gap-2 px-1 pt-0.5">
                      {ACCENTS.map((a) => {
                        const active = accent === a.key;
                        return (
                          <button
                            key={a.key}
                            onClick={() => {
                              setAccent(a.key);
                              setUserMenu(false);
                            }}
                            title={a.label}
                            aria-label={a.label}
                            role="menuitemradio"
                            aria-checked={active}
                            className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                              active
                                ? 'ring-2 ring-ink'
                                : 'ring-1 ring-line hover:ring-ink-faint'
                            }`}
                            style={{ background: a.color }}
                          >
                            {active && (
                              <Check className="h-3.5 w-3.5" style={{ color: a.on }} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="flex items-center justify-between bg-rose-50 px-4 py-1.5 text-xs font-semibold text-rose-600">
          <span>{error}</span>
          <button onClick={() => void refresh()} className="underline">
            Reintentar
          </button>
        </div>
      )}

      {/* ── Contenido ── */}
      {/*
        El mapa se queda MONTADO y solo se oculta al cambiar de pestaña: así no
        se recrea la instancia de MapLibre, no se vuelve a resolver el estilo ni
        se re-descargan los tiles (quedan en la caché HTTP del navegador). Los
        marcadores y las rutas siguen actualizándose igual, porque llegan por
        props desde el estado del panel.
      */}
      <main className={tab === 'map' ? 'relative flex min-h-0 flex-1' : 'hidden'}>
        <div className="relative min-w-0 flex-1">
          <FleetMap
            ref={mapRef}
            active={tab === 'map'}
            drivers={visibleDrivers}
            hiddenIds={hiddenIds}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          {/* Cifras de la flota sobre el mapa (esquina superior derecha).
              `pointer-events-none` para no bloquear el arrastre del mapa. */}
          <div className="pointer-events-none absolute right-4 top-4 z-500 flex max-w-[calc(100%-2rem)] flex-wrap justify-end gap-2">
            <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface/95 px-2.5 py-1 text-[11px] font-bold text-emerald-700 shadow-md ring-1 ring-emerald-100">
              <Truck className="h-3 w-3" /> {stats.inDelivery} en entrega
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface/95 px-2.5 py-1 text-[11px] font-bold text-sky-700 shadow-md ring-1 ring-sky-100">
              <Package className="h-3 w-3" /> {stats.withOrder} con pedido
            </span>
            {stats.offline > 0 && (
              <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface/95 px-2.5 py-1 text-[11px] font-bold text-ink-faint shadow-md ring-1 ring-line">
                <WifiOff className="h-3 w-3" /> {stats.offline} desconectados
              </span>
            )}
          </div>

          {/* Botón recentrar (Manizales) */}
          <button
            onClick={() => mapRef.current?.recenter()}
            title="Centrar el mapa en Manizales"
            className="absolute bottom-8 right-4 z-500 flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-ink-soft shadow-lg ring-1 ring-line transition hover:text-ink"
          >
            <LocateFixed className="h-4.5 w-4.5" />
          </button>
        </div>

        <DriversSidebar
          drivers={visibleDrivers}
          filter={statusFilter}
          onFilterChange={setStatusFilter}
          search={search}
          onSearchChange={setSearch}
          selectedId={selectedId}
          onSelect={setSelectedId}
          hiddenIds={hiddenIds}
          onToggleHidden={(id) =>
            setHiddenIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onChangeColor={changeDriverColor}
          onChat={openChat}
        />
      </main>

      {tab === 'drivers' && (
        <main className="min-h-0 flex-1">
          <DriversPanel
            drivers={drivers}
            onSelect={(id) => {
              setSelectedId(id);
              setTab('map');
            }}
            onCreate={() => setModal({ mode: 'create' })}
            onEdit={(driver, focusReset) => setModal({ mode: 'edit', driver, focusReset })}
            onChat={openChat}
            unreadOf={unreadOf}
          />
        </main>
      )}

      {tab === 'orders' && (
        <main className="min-h-0 flex-1">
          <OrdersPanel
            branchId={branchId}
            onLocate={locateDriver}
            reloadTick={lastSync?.getTime() ?? 0}
            drivers={drivers}
            onChat={openChat}
          />
        </main>
      )}

      <AppFooter />

      {modal && (
        <DriverFormModal
          mode={modal.mode}
          /* Se busca en la lista viva: el polling refresca el pedido activo
             mientras el modal está abierto. */
          driver={
            modal.mode === 'edit'
              ? (drivers.find((d) => d.id === modal.driver.id) ?? modal.driver)
              : null
          }
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          branches={branches}
          lockedBranchId={scopedBranchId}
        />
      )}

      {chatOpen && (
        <DriverChatModal
          chats={chats}
          initialDriverId={chatDriverId}
          liveTick={chatTick}
          onClose={() => setChatOpen(false)}
          onRefreshChats={() => void refreshChats()}
        />
      )}

      {profileOpen && user && (
        <ProfileModal
          user={user}
          onClose={() => setProfileOpen(false)}
          onSaved={(u) => setUser(u)}
        />
      )}
    </div>
  );
}
