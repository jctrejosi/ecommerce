import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  MapPinOff,
  MessageCircle,
  Phone,
  Search,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import type { DriverFilter, FleetDriver } from '../types';
import { FILTER_OPTIONS, driverVisual, isDriverOnline, lastSignalAt } from '../lib/status';
import { DRIVER_COLORS, driverColor } from '../lib/driverColors';
import { formatDateTime, loadLabel, timeAgo, vehicleLabel } from '../lib/format';
import { DriverAvatar, LastSeen, StatusBadge } from './DriverBits';
import DriverHistoryPanel from './DriverHistoryPanel';

interface Props {
  drivers: FleetDriver[]; // ya filtrados por el filtro de estado
  filter: DriverFilter;
  onFilterChange: (f: DriverFilter) => void;
  search: string;
  onSearchChange: (s: string) => void;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  hiddenIds: Set<number>;
  onToggleHidden: (id: number) => void;
  onChangeColor: (driver: FleetDriver, color: string) => void;
  /** Abre el chat del panel con el repartidor. */
  onChat: (driverId: number) => void;
  /** Mensajes sin leer del repartidor (badge del botón de chat). */
  unreadOf?: (driverId: number) => number;
}

function DriverRow({
  driver,
  hidden,
  selected,
  unread,
  onSelect,
  onToggleHidden,
  onChat,
}: {
  driver: FleetDriver;
  hidden: boolean;
  selected: boolean;
  unread: number;
  onSelect: () => void;
  onToggleHidden: () => void;
  onChat: () => void;
}) {
  const offline = driver.isActive && !isDriverOnline(driver);
  return (
    <div
      className={`group flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2.5 transition-colors ${
        selected ? 'bg-amber-50' : 'hover:bg-surface-2'
      }`}
      onClick={onSelect}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleHidden();
        }}
        title={hidden ? 'Mostrar en el mapa' : 'Ocultar del mapa'}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
          hidden ? 'bg-surface-3 text-ink-faint hover:text-ink-soft' : 'bg-sky-100 text-sky-600 hover:bg-sky-200'
        }`}
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>

      <DriverAvatar driver={driver} size={34} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-ink">{driver.fullName}</p>
          {offline && <MapPinOff className="h-3 w-3 shrink-0 text-rose-400" />}
        </div>
        <p className="truncate text-[11px] text-ink-faint">
          {vehicleLabel(driver)}
          {driver.activeAssignment ? ` · ${driver.activeAssignment.referenceCode ?? ''}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge driver={driver} />
        <LastSeen driver={driver} />
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onChat();
        }}
        title={unread > 0 ? `Chat · ${unread} sin leer` : 'Chat con el repartidor'}
        className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-faint transition-colors hover:bg-line hover:text-ink-soft"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-500 px-0.5 text-[8px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </div>
  );
}

function DetailView({
  driver,
  unread,
  onBack,
  onChangeColor,
  onChat,
}: {
  driver: FleetDriver;
  unread: number;
  onBack: () => void;
  onChangeColor: (color: string) => void;
  onChat: () => void;
}) {
  const visual = driverVisual(driver);
  const a = driver.activeAssignment;
  const [tab, setTab] = useState<'detalle' | 'historial'>('detalle');

  // Al cambiar de repartidor se vuelve a la pestaña de detalle.
  useEffect(() => setTab('detalle'), [driver.id]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="border-b border-line p-4">
        <button
          onClick={onBack}
          className="mb-3 flex items-center gap-1 text-xs font-semibold text-ink-faint hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a la flota
        </button>

        <div className="flex items-start gap-3">
          <DriverAvatar driver={driver} size={48} />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-ink">{driver.fullName}</h3>
            <p className="text-xs text-ink-faint">
              {driver.username ? `@${driver.username} · ` : ''}
              {vehicleLabel(driver)}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <StatusBadge driver={driver} />
              <button
                onClick={onChat}
                title="Abrir chat con el repartidor"
                className="relative inline-flex items-center gap-1.5 rounded-lg bg-invert px-2.5 py-1 text-[11px] font-bold text-invert-ink transition hover:bg-invert/90"
              >
                <MessageCircle className="h-3.5 w-3.5" /> Chat
                {unread > 0 && (
                  <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-line px-4">
        {(
          [
            ['detalle', 'Detalle'],
            ['historial', 'Historial'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-bold transition-colors ${
              tab === key
                ? 'border-ink text-ink'
                : 'border-transparent text-ink-faint hover:text-ink-soft'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'historial' ? (
        <div className="p-4">
          <DriverHistoryPanel driverId={driver.id} />
        </div>
      ) : (
      <div className="space-y-4 p-4">
        <section className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-faint">
              Estado actual
            </span>
            <span className="text-xs font-semibold" style={{ color: visual.color }}>
              {visual.action}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <span className="text-xs text-ink-faint">Última señal</span>
            <span className={`text-xs font-semibold ${driver.isActive && !isDriverOnline(driver) ? 'text-rose-500' : 'text-ink-soft'}`}>
              {(() => {
                const signal = lastSignalAt(driver);
                return signal ? timeAgo(signal) : 'Sin señal';
              })()}
            </span>
          </div>
          <div className="mt-2 border-t border-line pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-faint">Ocupación</span>
              <span
                className={`text-right text-xs font-semibold ${
                  driver.load?.overloaded ? 'text-rose-500' : 'text-ink-soft'
                }`}
              >
                {loadLabel(driver.load)}
              </span>
            </div>
            {driver.load?.fill != null && (
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full rounded-full ${
                    driver.load.overloaded ? 'bg-rose-500' : 'bg-emerald-500'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.round(driver.load.fill * 100))}%`,
                  }}
                />
              </div>
            )}
            {driver.load?.estimated && (
              <p className="mt-1 text-[10px] text-amber-600">
                Volumen aproximado: hay ítems sin medidas en el catálogo.
              </p>
            )}
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-faint">
            Color de la ruta en el mapa
          </h4>
          <div className="flex flex-wrap gap-2">
            {DRIVER_COLORS.map((color) => {
              const active =
                driverColor(driver).toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  title={color}
                  onClick={() => onChangeColor(color)}
                  className={`h-7 w-7 rounded-full transition ${
                    active
                      ? 'ring-2 ring-ink ring-offset-2'
                      : 'ring-1 ring-black/10 hover:scale-110'
                  }`}
                  style={{ background: color }}
                />
              );
            })}
          </div>
        </section>

        <section className="text-sm">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-faint">
            Contacto
          </h4>
          <div className="space-y-1.5 text-ink-soft">
            <p className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-ink-faint" /> {driver.phone}
            </p>
            <p className="flex items-center gap-2">
              <UserRound className="h-3.5 w-3.5 text-ink-faint" /> {driver.email ?? 'Sin email'}
            </p>
          </div>
        </section>

        {a && (
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-faint">
              <ShoppingBag className="h-3.5 w-3.5" /> Pedido activo
            </h4>
            <div className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-ink-soft">
                  {a.referenceCode ?? `#${a.orderId}`}
                </span>
                <StatusBadge driver={driver} />
              </div>
              <p className="mt-1.5 text-xs text-ink-soft">
                Cliente: <strong>{a.customerName ?? '—'}</strong>
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {[a.addressLine1, a.city].filter(Boolean).join(', ') || 'Sin dirección'}
              </p>
              <div className="mt-2 space-y-1 border-t border-line pt-2 text-[11px] text-ink-faint">
                <p>Asignado: {formatDateTime(a.assignedAt)}</p>
                {a.acceptedAt && <p>Aceptado: {formatDateTime(a.acceptedAt)}</p>}
                {a.pickedUpAt && <p>Recogido: {formatDateTime(a.pickedUpAt)}</p>}
                {a.inDeliveryAt && <p>En camino: {formatDateTime(a.inDeliveryAt)}</p>}
              </div>
            </div>
          </section>
        )}
      </div>
      )}
    </div>
  );
}

export default function DriversSidebar(props: Props) {
  const {
    drivers,
    filter,
    onFilterChange,
    search,
    onSearchChange,
    selectedId,
    onSelect,
    hiddenIds,
    onToggleHidden,
    onChangeColor,
    onChat,
    unreadOf,
  } = props;

  const selected = drivers.find((d) => d.id === selectedId) ?? null;

  const q = search.trim().toLowerCase();
  const rows = q
    ? drivers.filter((d) =>
        [d.fullName, d.username, d.vehiclePlate, d.phone]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
    : drivers;

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface">
      <div className="border-b border-line p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar repartidor, placa, teléfono…"
            className="w-full rounded-xl border border-line bg-surface-2 py-2 pl-9 pr-3 text-xs outline-none transition focus:border-amber-400 focus:bg-surface focus:ring-2 focus:ring-amber-100"
          />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => onFilterChange(opt.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
                filter === opt.key
                  ? 'bg-invert text-invert-ink'
                  : 'bg-surface-3 text-ink-faint hover:bg-line'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {selected ? (
        <DetailView
          driver={selected}
          unread={unreadOf?.(selected.id) ?? 0}
          onBack={() => onSelect(null)}
          onChangeColor={(color) => onChangeColor(selected, color)}
          onChat={() => onChat(selected.id)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 && (
            <p className="p-6 text-center text-xs text-ink-faint">
              No hay repartidores que coincidan con el filtro.
            </p>
          )}
          {rows.map((d) => (
            <DriverRow
              key={d.id}
              driver={d}
              hidden={hiddenIds.has(d.id)}
              selected={d.id === selectedId}
              unread={unreadOf?.(d.id) ?? 0}
              onSelect={() => onSelect(d.id)}
              onToggleHidden={() => onToggleHidden(d.id)}
              onChat={() => onChat(d.id)}
            />
          ))}
          <p className="p-3 text-center text-[11px] text-ink-faint">
            {rows.length} repartidor{rows.length === 1 ? '' : 'es'} en la vista
          </p>
        </div>
      )}
    </aside>
  );
}
