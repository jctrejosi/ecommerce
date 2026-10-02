import { useEffect, useState } from 'react';
import { Loader2, PackageSearch } from 'lucide-react';
import type { FleetOrder } from '../types';
import { api, ApiError } from '../services/api';
import { STATUS_META } from '../lib/status';
import { formatDateTime, formatMoney } from '../lib/format';

/**
 * Historial de un repartidor dentro de su ficha (pestaña "Historial").
 *
 * Se carga al abrir la pestaña y al cambiar de repartidor; no se refresca con
 * el polling del panel porque son asignaciones ya cerradas y no cambian.
 */
export default function DriverHistoryPanel({ driverId }: { driverId: number }) {
  const [orders, setOrders] = useState<FleetOrder[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOrders(null);
    api
      .driverHistory(driverId)
      .then((rows) => {
        if (!cancelled) setOrders(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'No se pudo cargar el historial.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-xs font-semibold text-ink-faint">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando historial…
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">
        {error}
      </p>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <PackageSearch className="h-7 w-7 text-ink-faint" />
        <p className="text-xs font-semibold text-ink-faint">Aún no tiene entregas cerradas</p>
        <p className="text-[11px] text-ink-faint">
          Aquí aparecerán los pedidos entregados, fallidos o cancelados.
        </p>
      </div>
    );
  }

  const entregadas = orders.filter((o) => o.status === 'DELIVERED');
  const totalEntregado = entregadas.reduce((sum, o) => sum + o.totals.value, 0);
  const currency = entregadas[0]?.totals.currency ?? 'COP';

  return (
    <div className="space-y-2">
      {/* Resumen */}
      <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-xs">
        <span className="font-semibold text-ink-faint">
          {entregadas.length} entregada{entregadas.length === 1 ? '' : 's'}
          {orders.length !== entregadas.length ? ` · ${orders.length - entregadas.length} sin entregar` : ''}
        </span>
        <span className="font-bold text-ink">{formatMoney(totalEntregado, currency)}</span>
      </div>

      {orders.map((o) => {
        const meta = STATUS_META[o.status];
        return (
          <div
            key={o.assignmentId}
            className="rounded-xl border border-line bg-surface px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-bold text-ink">
                {o.referenceCode}
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${meta?.badge ?? 'bg-surface-3 text-ink-soft'}`}
              >
                {meta?.label ?? o.status}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-ink-faint">
              {o.customerName ?? 'Cliente'}
            </p>
            <p className="truncate text-[11px] text-ink-faint">
              {[o.addressLine1, o.city].filter(Boolean).join(', ') || 'Sin dirección'}
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10px] text-ink-faint">
                {formatDateTime(o.completedAt ?? o.pickedUpAt ?? o.assignedAt)}
              </span>
              <span className="text-[11px] font-bold text-ink-soft">
                {formatMoney(o.totals.value, o.totals.currency)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
