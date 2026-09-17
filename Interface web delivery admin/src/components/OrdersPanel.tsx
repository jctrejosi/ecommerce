import { LocateFixed, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AssignmentStatus, FleetOrder } from '../types';
import { STATUS_META } from '../lib/status';
import { formatDateTime, formatMoney } from '../lib/format';

interface Props {
  orders: FleetOrder[];
  onLocate: (driverId: number) => void;
}

const ORDER_FILTERS: { key: AssignmentStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'ASSIGNED', label: 'Por aceptar' },
  { key: 'READY_FOR_PICKUP', label: 'Recogiendo' },
  { key: 'PICKED_UP', label: 'Recogidos' },
  { key: 'IN_DELIVERY', label: 'En entrega' },
];

/**
 * Pasos del repartidor, en orden. Se muestran solo los que ya ocurrieron, con
 * la hora en que ocurrieron, para poder ver cuándo hizo cada cosa.
 */
type TimelineKey =
  | 'assignedAt'
  | 'acceptedAt'
  | 'readyForPickupAt'
  | 'pickedUpAt'
  | 'inDeliveryAt';

const TIMELINE: { label: string; key: TimelineKey }[] = [
  { label: 'Asignado', key: 'assignedAt' },
  { label: 'Aceptado', key: 'acceptedAt' },
  { label: 'Recogiendo', key: 'readyForPickupAt' },
  { label: 'Recogido', key: 'pickedUpAt' },
  { label: 'En camino', key: 'inDeliveryAt' },
];

export default function OrdersPanel({ orders, onLocate }: Props) {
  const [filter, setFilter] = useState<AssignmentStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter !== 'all' && o.status !== filter) return false;
      if (!q) return true;
      return [o.referenceCode, o.driverName, o.customerName, o.addressLine1]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [orders, filter, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-5 pb-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Pedidos activos</h1>
          <p className="text-xs text-slate-400">
            {orders.length} pedidos en curso en toda la flota
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar pedido, repartidor, cliente…"
            className="w-72 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-5 pb-3">
        {ORDER_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
              filter === f.key
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mx-5 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="sticky top-0 border-b border-slate-100 bg-slate-50 text-left">
              {['Pedido', 'Repartidor', 'Estado', 'Cliente', 'Dirección', 'Pago', 'Tiempos', 'Total', ''].map(
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
                <td colSpan={9} className="p-8 text-center text-xs text-slate-400">
                  No hay pedidos activos con este filtro.
                </td>
              </tr>
            )}
            {rows.map((o) => {
              const meta = STATUS_META[o.status];
              return (
                <tr key={o.assignmentId} className="transition-colors hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs font-bold text-slate-800">{o.referenceCode}</p>
                    <p className="text-[11px] text-slate-400">#{o.orderId}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs font-semibold text-slate-700">{o.driverName}</p>
                    <p className="text-[11px] text-slate-400">{o.driverPlate ?? 'sin placa'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.badge}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs font-semibold text-slate-700">{o.customerName ?? '—'}</p>
                    <p className="text-[11px] text-slate-400">{o.customerPhone ?? ''}</p>
                  </td>
                  <td className="max-w-[220px] px-4 py-3">
                    <p className="truncate text-xs text-slate-600">
                      {[o.addressLine1, o.city].filter(Boolean).join(', ') || 'Sin dirección'}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        o.payment.method === 'CASH'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {o.payment.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      {TIMELINE.map((step) => {
                        const at = o[step.key];
                        if (!at) return null;
                        return (
                          <div key={step.key} className="flex items-baseline gap-2 whitespace-nowrap">
                            <span className="w-[84px] shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                              {step.label}
                            </span>
                            <span className="text-xs text-slate-600">{formatDateTime(at)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-800">
                    {formatMoney(o.totals.value, o.totals.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onLocate(o.driverId)}
                      title="Ubicar en el mapa"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-sky-500 hover:bg-sky-50"
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                    </button>
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
