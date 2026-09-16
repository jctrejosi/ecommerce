import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  Loader2,
  LogOut,
  LocateFixed,
  MessageCircle,
  Package,
  RefreshCw,
  Truck,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  AuthUser,
  DriverConversation,
  DriverFilter,
  FleetDriver,
  FleetOrder,
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
import { initials } from './lib/format';
import {
  notificationPermission,
  notificationsSupported,
  notify,
  requestNotificationPermission,
  type NotificationPermissionState,
} from './services/browserNotifications';
import LoginScreen from './components/LoginScreen';
import footerLogo from './assets/logo.png';
// El logo del header es el del delivery; el del footer (copyright) sigue siendo logo.png.
import headerLogo from './assets/delivery.png';
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

  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [orders, setOrders] = useState<FleetOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

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
        setBooting(false);
      })
      .catch(() => {
        setToken(null);
        setBooting(false);
      });
  }, []);

  // ── Carga de datos ──
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [d, o] = await Promise.all([api.drivers(), api.orders()]);
      setDrivers(d);
      setOrders(o);
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
  }, []);

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
  }, []);

  const handleLogout = useCallback(() => {
    setToken(null);
    setUser(null);
    setDrivers([]);
    setOrders([]);
    setSelectedId(null);
  }, []);

  const toggleAvailable = useCallback(
    (driver: FleetDriver, value: boolean) => {
      setDrivers((prev) =>
        prev.map((d) => (d.id === driver.id ? { ...d, isAvailable: value } : d)),
      );
      void api
        .updateDriver(driver.id, { isAvailable: value })
        .catch(() => scheduleRefresh());
    },
    [scheduleRefresh],
  );

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

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-100">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Topbar ── */}
      <header className="z-10 flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4">
        <div className="flex items-center gap-2.5">
          <img
            src={headerLogo}
            alt="Mercaldas"
            className="h-9 w-auto shrink-0 object-contain"
          />
          <div className="leading-tight">
            <p className="text-sm font-bold text-slate-900">Delivery Admin</p>
            <p className="text-[11px] text-slate-400">Seguimiento de flota</p>
          </div>
        </div>

        <nav className="ml-2 flex gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
                  tab === t.key
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* chips de estado */}
          <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 lg:flex">
            <Truck className="h-3 w-3" /> {stats.inDelivery} en entrega
          </span>
          <span className="hidden items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700 lg:flex">
            <Package className="h-3 w-3" /> {stats.withOrder} con pedido
          </span>
          {stats.offline > 0 && (
            <span className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500 lg:flex">
              <WifiOff className="h-3 w-3" /> {stats.offline} desconectados
            </span>
          )}
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
              connected ? 'bg-slate-100 text-slate-600' : 'bg-rose-50 text-rose-600'
            }`}
            title={connected ? 'Conectado en tiempo real' : 'Sin conexión en vivo · polling cada 30 s'}
          >
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? 'En vivo' : 'Sin señal'}
          </span>
          {lastSync && (
            <span className="hidden text-[11px] text-slate-400 sm:block">
              Sincronizado {lastSync.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => void refresh()}
            disabled={loading}
            title="Actualizar ahora"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => void handleNotificationsClick()}
            title={NOTIF_HINTS[notifPermission]}
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
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
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <MessageCircle className="h-4 w-4" />
            {unreadTotal > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {unreadTotal > 99 ? '99+' : unreadTotal}
              </span>
            )}
          </button>

          <div className="ml-1 flex items-center gap-2 border-l border-slate-200 pl-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
              {initials(user.fullName || user.username)}
            </div>
            <div className="hidden leading-tight md:block">
              <p className="text-xs font-semibold text-slate-800">{user.fullName || user.username}</p>
              <p className="text-[10px] text-slate-400">Administrador</p>
            </div>
            <button
              onClick={handleLogout}
              title="Cerrar sesión"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            >
              <LogOut className="h-4 w-4" />
            </button>
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
      {tab === 'map' && (
        <main className="relative flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <FleetMap
              ref={mapRef}
              drivers={visibleDrivers}
              hiddenIds={hiddenIds}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />

            {/* Botón recentrar (Manizales) */}
            <button
              onClick={() => mapRef.current?.recenter()}
              title="Centrar el mapa en Manizales"
              className="absolute bottom-8 right-4 z-500 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-lg ring-1 ring-slate-200 transition hover:text-slate-900"
            >
              <LocateFixed className="h-4.5 w-4.5" />
            </button>

            {/* Leyenda (junto al control de zoom) */}
            <div className="pointer-events-none absolute left-12 top-4 z-500 rounded-xl bg-white/95 p-3 shadow-lg ring-1 ring-slate-200 backdrop-blur">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Estado de los repartidores
              </p>
              <div className="space-y-1.5">
                {[
                  { color: '#34d399', label: 'Disponible · sin pedido' },
                  { color: '#0ea5e9', label: 'Pedido asignado (por aceptar)' },
                  { color: '#f59e0b', label: 'Aceptado · va a la tienda' },
                  { color: '#f97316', label: 'Recogiendo en tienda' },
                  { color: '#8b5cf6', label: 'Pedido recogido' },
                  { color: '#16a34a', label: 'En entrega al cliente' },
                  { color: '#94a3b8', label: 'No disponible / desactivado' },
                ].map((row, i, arr) => (
                  <div key={row.label} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full ring-2 ring-white"
                      style={{ background: row.color, opacity: i === arr.length - 1 ? 0.5 : 1 }}
                    />
                    <span className="text-[11px] text-slate-600">{row.label}</span>
                  </div>
                ))}
              </div>
            </div>
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
            onToggleAvailable={toggleAvailable}
            onChangeColor={changeDriverColor}
            onChat={openChat}
          />
        </main>
      )}

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
          <OrdersPanel orders={orders} onLocate={locateDriver} />
        </main>
      )}

      <footer className="shrink-0" style={{ background: '#111827' }}>
        <div className="flex flex-col items-center justify-center gap-x-4 gap-y-1 px-3 py-2 text-center md:flex-row">
          <a
            href="https://dsi.com.co"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center transition-opacity hover:opacity-80"
          >
            <img src={footerLogo} alt="Mercaldas" className="h-8 w-auto object-contain" />
          </a>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
            © 2026 Desarrollado por{' '}
            <span className="font-bold text-white/70">DSI SA</span> · Todos los
            derechos reservados
          </p>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Manizales, Caldas, Colombia
          </p>
        </div>
      </footer>

      {modal && (
        <DriverFormModal
          mode={modal.mode}
          driver={modal.mode === 'edit' ? modal.driver : null}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
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
    </div>
  );
}
