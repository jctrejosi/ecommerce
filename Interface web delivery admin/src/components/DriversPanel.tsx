import { MapPin, Pencil, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FleetDriver } from '../types';
import { FILTER_OPTIONS, driverVisual } from '../lib/status';
import { vehicleLabel } from '../lib/format';
import { DriverAvatar, LastSeen, StatusBadge } from './DriverBits';
import type { DriverFilter } from '../types';

interface Props {
  drivers: FleetDriver[];
  onSelect: (id: number | null) => void;
  onCreate: () => void;
  onEdit: (driver: FleetDriver, focusReset?: boolean) => void;
}

export default function DriversPanel({
  drivers,
  onSelect,
  onCreate,
  onEdit,
}: Props) {
  const [filter, setFilter] = useState<DriverFilter>('all');
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drivers.filter((d) => {
      const matchesFilter =
        filter === 'all'
          ? true
          : filter === 'available'
            ? d.isActive && d.isAvailable && !d.activeAssignment
            : filter === 'with-order'
              ? d.isActive && Boolean(d.activeAssignment)
              : filter === 'in-delivery'
                ? d.isActive && d.activeAssignment?.status === 'IN_DELIVERY'
                : !d.isActive;
      if (!matchesFilter) return false;
      if (!q) return true;
      return [d.fullName, d.username, d.email, d.phone, d.vehiclePlate]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [drivers, filter, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-5 pb-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Repartidores</h1>
          <p className="text-xs text-slate-400">
            {drivers.length} registrados ·{' '}
            {drivers.filter((d) => d.isActive).length} activos
          </p>
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 py-2 text-sm font-bold text-amber-950 transition hover:bg-amber-500"
        >
          <Plus className="h-4 w-4" /> Nuevo repartidor
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="w-56 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          />
        </div>
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
              filter === opt.key
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="mx-5 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="sticky top-0 border-b border-slate-100 bg-slate-50 text-left">
              {['Repartidor', 'Contacto', 'Vehículo', 'Estado', 'Última señal', 'Acciones'].map(
                (h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-xs text-slate-400">
                  No hay repartidores que coincidan.
                </td>
              </tr>
            )}
            {rows.map((d) => {
              const visual = driverVisual(d);
              return (
                <tr
                  key={d.id}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                  onClick={() => onEdit(d)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <DriverAvatar driver={d} size={34} />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{d.fullName}</p>
                        <p className="text-[11px] text-slate-400">
                          {d.username ? `@${d.username}` : 'sin usuario'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-slate-700">{d.phone}</p>
                    <p className="text-[11px] text-slate-400">{d.email ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-slate-700">{vehicleLabel(d)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge driver={d} />
                    <p className="mt-1 text-[11px] text-slate-400" style={{ maxWidth: 180 }}>
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
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
                      >
                        <MapPin className="h-4 w-4" /> Ver en el mapa
                      </button>
                      <button
                        title="Editar"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(d);
                        }}
                        className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
                      >
                        <Pencil className="h-4 w-4" /> Editar
                      </button>
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
