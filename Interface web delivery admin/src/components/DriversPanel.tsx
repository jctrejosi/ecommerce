import { MapPin, MessageCircle, Pencil, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FleetDriver } from '../types';
import { FILTER_OPTIONS, driverVisual, filterDrivers, isDriverOnline } from '../lib/status';
import { loadLabel, vehicleLabel } from '../lib/format';
import { DriverAvatar, LastSeen, StatusBadge } from './DriverBits';
import type { DriverFilter } from '../types';

interface Props {
  drivers: FleetDriver[];
  onSelect: (id: number | null) => void;
  onCreate: () => void;
  onEdit: (driver: FleetDriver, focusReset?: boolean) => void;
  /** Abre el chat del panel con el repartidor. */
  onChat: (driverId: number) => void;
  /** Mensajes sin leer del repartidor (badge del botón de chat). */
  unreadOf?: (driverId: number) => number;
}

export default function DriversPanel({
  drivers,
  onSelect,
  onCreate,
  onEdit,
  onChat,
  unreadOf,
}: Props) {
  const [filter, setFilter] = useState<DriverFilter>('all');
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byStatus = filterDrivers(drivers, filter);
    if (!q) return byStatus;
    return byStatus.filter((d) =>
      [d.fullName, d.username, d.email, d.phone, d.vehiclePlate]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [drivers, filter, search]);

  const onlineCount = drivers.filter((d) => isDriverOnline(d)).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-5 pb-3">
        <div>
          <h1 className="text-lg font-bold text-ink">Repartidores</h1>
          <p className="text-xs text-ink-faint">
            {drivers.length} registrados · {onlineCount} conectados
          </p>
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-bold text-on-accent transition hover:bg-accent-strong"
        >
          <Plus className="h-4 w-4" /> Nuevo repartidor
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="w-56 rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-xs outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </div>
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
              filter === opt.key
                ? 'bg-invert text-invert-ink'
                : 'bg-surface text-ink-faint ring-1 ring-line hover:bg-surface-2'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="mx-5 flex-1 overflow-auto rounded-2xl border border-line bg-surface">
        <table className="w-full">
          <thead>
            {/* Cabecera fija. Hacen falta las DOS cosas:
                - `z-10` en el `<tr>` (el `sticky` crea contexto de apilado; sin
                  z-index propio pierde por orden de árbol frente a los elementos
                  posicionados de las filas, p. ej. el botón de chat),
                - `relative z-10` en cada `th`, porque el `bg-surface` del `th` es
                  lo que realmente tapa lo que pasa por debajo. */}
            <tr className="sticky top-0 z-10 border-b border-line text-left">
              {['Repartidor', 'Contacto', 'Vehículo', 'Ocupación', 'Estado', 'Última señal', 'Acciones'].map(
                (h) => (
                  <th
                    key={h}
                    className="relative z-10 whitespace-nowrap bg-surface px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-ink-faint"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-xs text-ink-faint">
                  No hay repartidores que coincidan.
                </td>
              </tr>
            )}
            {rows.map((d) => {
              const visual = driverVisual(d);
              return (
                <tr
                  key={d.id}
                  className="cursor-pointer transition-colors hover:bg-surface-2"
                  onClick={() => onEdit(d)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <DriverAvatar driver={d} size={34} />
                      <div>
                        <p className="text-sm font-semibold text-ink">{d.fullName}</p>
                        <p className="text-[11px] text-ink-faint">
                          {d.username ? `@${d.username}` : 'sin usuario'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-ink-soft">{d.phone}</p>
                    <p className="text-[11px] text-ink-faint">{d.email ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-ink-soft">{vehicleLabel(d)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p
                      className={`text-xs font-semibold ${
                        d.load?.overloaded ? 'text-rose-500' : 'text-ink-soft'
                      }`}
                    >
                      {loadLabel(d.load)}
                    </p>
                    {d.load?.fill != null && (
                      <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-line">
                        <div
                          className={`h-full rounded-full ${
                            d.load.overloaded ? 'bg-rose-500' : 'bg-emerald-500'
                          }`}
                          style={{
                            width: `${Math.min(100, Math.round(d.load.fill * 100))}%`,
                          }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge driver={d} />
                    <p className="mt-1 text-[11px] text-ink-faint" style={{ maxWidth: 180 }}>
                      {visual.action}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <LastSeen driver={d} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-start gap-2">
                      <button
                        title="Ver en el mapa"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(d.id);
                        }}
                        className="inline-flex items-center gap-2 rounded-xl bg-invert px-3.5 py-2 text-xs font-bold text-invert-ink transition hover:bg-invert/90"
                      >
                        <MapPin className="h-4 w-4" /> Mapa
                      </button>
                      <button
                        title="Editar"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(d);
                        }}
                        className="inline-flex items-center gap-2 rounded-xl bg-surface px-3.5 py-2 text-xs font-bold text-ink-soft ring-1 ring-line transition hover:bg-surface-2"
                      >
                        <Pencil className="h-4 w-4" /> Editar
                      </button>
                      {(() => {
                        const unread = unreadOf?.(d.id) ?? 0;
                        return (
                          <button
                            title="Chat con el repartidor"
                            onClick={(e) => {
                              e.stopPropagation();
                              onChat(d.id);
                            }}
                            className="relative inline-flex items-center gap-2 rounded-xl bg-surface px-3.5 py-2 text-xs font-bold text-ink-soft ring-1 ring-line transition hover:bg-surface-2"
                          >
                            <MessageCircle className="h-4 w-4" /> Chat
                            {unread > 0 && (
                              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                                {unread > 99 ? '99+' : unread}
                              </span>
                            )}
                          </button>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
