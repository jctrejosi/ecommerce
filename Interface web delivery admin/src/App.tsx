import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bike,
  Loader2,
  LogOut,
  LocateFixed,
  Package,
  RefreshCw,
  Truck,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  AuthUser,
  DriverFilter,
  FleetDriver,
  FleetOrder,
} from './types';
import { api, ApiError, getToken, setToken } from './services/api';
import {
  connectFleetSocket,
  type FleetLocationEvent,
  type FleetStatusEvent,
} from './services/socket';
import { filterDrivers } from './lib/status';
import { initials, isStale } from './lib/format';
import LoginScreen from './components/LoginScreen';
import FleetMap, { type FleetMapHandle } from './components/FleetMap';
import DriversSidebar from './components/DriversSidebar';
import DriversPanel from './components/DriversPanel';
import OrdersPanel from './components/OrdersPanel';
import DriverFormModal from './components/DriverFormModal';

type Tab = 'map' | 'drivers' | 'orders';

const TABS: { key: Tab; label: string; icon: typeof Truck }[] = [
  { key: 'map', label: 'Mapa', icon: Truck },
  { key: 'drivers', label: 'Repartidores', icon: Users },
  { key: 'orders', label: 'Pedidos', icon: Package },
];

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

  const mapRef = useRef<FleetMapHandle | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Socket en tiempo real ──
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
    });
    return () => {
      disconnect();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [user, scheduleRefresh]);

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

  const toggleActive = useCallback(
    (driver: FleetDriver, value: boolean) => {
      setDrivers((prev) =>
        prev.map((d) => (d.id === driver.id ? { ...d, isActive: value } : d)),
      );
      void api
        .updateDriver(driver.id, { isActive: value })
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
      available: active.filter((d) => d.isAvailable && !d.activeAssignment).length,
      withOrder: active.filter((d) => d.activeAssignment).length,
      inDelivery: active.filter((d) => d.activeAssignment?.status === 'IN_DELIVERY').length,
      stale: active.filter((d) => isStale(d.lastLocationAt)).length,
    };
  }, [drivers]);

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
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400">
            <Bike className="h-5 w-5 text-slate-900" />
          </div>
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
            onToggleActive={toggleActive}
            onEdit={(driver) => setModal({ mode: 'edit', driver })}
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
            onToggleAvailable={toggleAvailable}
            onToggleActive={toggleActive}
          />
        </main>
      )}

      {tab === 'orders' && (
        <main className="min-h-0 flex-1">
          <OrdersPanel orders={orders} onLocate={locateDriver} />
        </main>
      )}

      {modal && (
        <DriverFormModal
          mode={modal.mode}
          driver={modal.mode === 'edit' ? modal.driver : null}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
