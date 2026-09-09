import {
  ArrowLeft,
  Eye,
  EyeOff,
  MapPinOff,
  Pencil,
  Phone,
  Search,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import type { DriverFilter, FleetDriver } from '../types';
import { FILTER_OPTIONS, driverVisual } from '../lib/status';
import { formatDateTime, isStale, timeAgo, vehicleLabel } from '../lib/format';
import { AvailabilitySwitch, DriverAvatar, LastSeen, StatusBadge } from './DriverBits';

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
  onToggleAvailable: (driver: FleetDriver, value: boolean) => void;
  onToggleActive: (driver: FleetDriver, value: boolean) => void;
  onEdit: (driver: FleetDriver) => void;
}

function DriverRow({
  driver,
  hidden,
  selected,
  onSelect,
  onToggleHidden,
  onToggleAvailable,
}: {
  driver: FleetDriver;
  hidden: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleHidden: () => void;
  onToggleAvailable: (value: boolean) => void;
}) {
  const stale = isStale(driver.lastLocationAt);
  return (
    <div
      className={`group flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2.5 transition-colors ${
        selected ? 'bg-amber-50' : 'hover:bg-slate-50'
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
          hidden ? 'bg-slate-100 text-slate-400 hover:text-slate-600' : 'bg-sky-100 text-sky-600 hover:bg-sky-200'
        }`}
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>

      <DriverAvatar driver={driver} size={34} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-slate-800">{driver.fullName}</p>
          {stale && <MapPinOff className="h-3 w-3 shrink-0 text-rose-400" />}
        </div>
        <p className="truncate text-[11px] text-slate-400">
          {vehicleLabel(driver)}
          {driver.activeAssignment ? ` · ${driver.activeAssignment.referenceCode ?? ''}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge driver={driver} />
        <LastSeen driver={driver} />
      </div>

      <AvailabilitySwitch
        driver={driver}
        onToggle={(_, v) => onToggleAvailable(v)}
      />
    </div>
  );
}

function DetailView({
  driver,
  onBack,
  onEdit,
  onToggleAvailable,
  onToggleActive,
}: {
  driver: FleetDriver;
  onBack: () => void;
  onEdit: () => void;
  onToggleAvailable: (value: boolean) => void;
  onToggleActive: (value: boolean) => void;
}) {
  const visual = driverVisual(driver);
  const a = driver.activeAssignment;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="border-b border-slate-100 p-4">
        <button
          onClick={onBack}
          className="mb-3 flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a la flota
        </button>

        <div className="flex items-start gap-3">
          <DriverAvatar driver={driver} size={48} />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">{driver.fullName}</h3>
            <p className="text-xs text-slate-500">
              {driver.username ? `@${driver.username} · ` : ''}
              {vehicleLabel(driver)}
            </p>
            <div className="mt-1.5">
              <StatusBadge driver={driver} />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <section className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Estado actual
            </span>
            <span className="text-xs font-semibold" style={{ color: visual.color }}>
              {visual.action}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
            <span className="text-xs text-slate-500">Última señal GPS</span>
            <span className={`text-xs font-semibold ${isStale(driver.lastLocationAt) ? 'text-rose-500' : 'text-slate-700'}`}>
              {driver.lastLocationAt ? timeAgo(driver.lastLocationAt) : 'Sin señal'}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">Disponibilidad</span>
            <AvailabilitySwitch driver={driver} onToggle={(_, v) => onToggleAvailable(v)} />
          </div>
        </section>

        <section className="text-sm">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            Contacto
          </h4>
          <div className="space-y-1.5 text-slate-700">
            <p className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-slate-400" /> {driver.phone}
            </p>
            <p className="flex items-center gap-2">
              <UserRound className="h-3.5 w-3.5 text-slate-400" /> {driver.email ?? 'Sin email'}
            </p>
          </div>
        </section>

        {a && (
          <section>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <ShoppingBag className="h-3.5 w-3.5" /> Pedido activo
            </h4>
            <div className="rounded-xl border border-slate-100 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-slate-700">
                  {a.referenceCode ?? `#${a.orderId}`}
                </span>
                <StatusBadge driver={driver} />
              </div>
              <p className="mt-1.5 text-xs text-slate-600">
                Cliente: <strong>{a.customerName ?? '—'}</strong>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {[a.addressLine1, a.city].filter(Boolean).join(', ') || 'Sin dirección'}
              </p>
              <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                <p>Asignado: {formatDateTime(a.assignedAt)}</p>
                {a.acceptedAt && <p>Aceptado: {formatDateTime(a.acceptedAt)}</p>}
                {a.pickedUpAt && <p>Recogido: {formatDateTime(a.pickedUpAt)}</p>}
                {a.inDeliveryAt && <p>En camino: {formatDateTime(a.inDeliveryAt)}</p>}
              </div>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <button
            onClick={onEdit}
            className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
          >
            <Pencil className="h-3.5 w-3.5" /> Editar repartidor
          </button>
          <button
            onClick={() => onToggleActive(!driver.isActive)}
            className={`rounded-xl py-2 text-xs font-bold transition ${
              driver.isActive
                ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
            }`}
          >
            {driver.isActive ? 'Desactivar cuenta' : 'Activar cuenta'}
          </button>
        </section>
      </div>
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
    onToggleAvailable,
    onToggleActive,
    onEdit,
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
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar repartidor, placa, teléfono…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs outline-none transition focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-100"
          />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => onFilterChange(opt.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
                filter === opt.key
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
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
          onBack={() => onSelect(null)}
          onEdit={() => onEdit(selected)}
          onToggleAvailable={(v) => onToggleAvailable(selected, v)}
          onToggleActive={(v) => onToggleActive(selected, v)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 && (
            <p className="p-6 text-center text-xs text-slate-400">
              No hay repartidores que coincidan con el filtro.
            </p>
          )}
          {rows.map((d) => (
            <DriverRow
              key={d.id}
              driver={d}
              hidden={hiddenIds.has(d.id)}
              selected={d.id === selectedId}
              onSelect={() => onSelect(d.id)}
              onToggleHidden={() => onToggleHidden(d.id)}
              onToggleAvailable={(v) => onToggleAvailable(d, v)}
            />
          ))}
          <p className="p-3 text-center text-[11px] text-slate-300">
            {rows.length} repartidor{rows.length === 1 ? '' : 'es'} en la vista
          </p>
        </div>
      )}
    </aside>
  );
}
