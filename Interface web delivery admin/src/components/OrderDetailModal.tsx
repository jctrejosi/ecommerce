import { useEffect, type ComponentType, type ReactNode } from 'react';
import {
  Boxes,
  Clock,
  CreditCard,
  LocateFixed,
  MapPin,
  MessageCircle,
  Phone,
  Route,
  Store,
  Truck,
  User,
  X,
} from 'lucide-react';
import type { FleetDriver, FleetOrder } from '../types';
import { STATUS_META } from '../lib/status';
import { formatDateTime, formatMoney, formatVolume, initials } from '../lib/format';
import { DriverAvatar } from './DriverBits';

interface Props {
  order: FleetOrder;
  /** Repartidor (con foto/estado) si está en la flota cargada. */
  driver?: FleetDriver | null;
  onClose: () => void;
  /** Ubica al repartidor en el mapa (cierra el modal). */
  onLocate?: (driverId: number) => void;
  /** Abre el chat con el repartidor (cierra el modal). */
  onChat?: (driverId: number) => void;
  /**
   * Muestra en el mapa el recorrido del pedido entregado (domicilio + sucursal
   * + ruta con su tiempo). Solo se ofrece cuando el pedido está `DELIVERED`.
   */
  onShowRoute?: () => void;
}

/** Pasos del pedido, en orden. Se muestran los que ya ocurrieron, con su hora. */
const TIMELINE: { label: string; key: keyof FleetOrder }[] = [
  { label: 'Asignado', key: 'assignedAt' },
  { label: 'Aceptado', key: 'acceptedAt' },
  { label: 'Recogiendo', key: 'readyForPickupAt' },
  { label: 'Recogido', key: 'pickedUpAt' },
  { label: 'En camino', key: 'inDeliveryAt' },
  { label: 'Entregado', key: 'completedAt' },
];

/** Fila etiqueta/valor de las secciones de datos. */
function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      <span className="min-w-0 text-right text-xs text-ink-soft">{children}</span>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface-2/60 p-3.5">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      {children}
    </section>
  );
}

/**
 * Detalle completo de un pedido de la flota (se abre al tocar un renglón de la
 * pestaña "Pedidos"). Reúne estado, repartidor, cliente, dirección, tiempos,
 * pago y volumen, con accesos a llamar, ubicar en el mapa y chatear.
 */
export default function OrderDetailModal({
  order,
  driver,
  onClose,
  onLocate,
  onChat,
  onShowRoute,
}: Props) {
  const meta = STATUS_META[order.status];
  const isDelivered = order.status === 'DELIVERED';

  // Cerrar con Escape (además del clic en el fondo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const steps = TIMELINE.map((s) => ({ ...s, at: order[s.key] as string | null })).filter(
    (s) => Boolean(s.at),
  );
  const currentIndex = steps.length - 1;

  const address = [order.addressLine1, order.city].filter(Boolean).join(', ') || 'Sin dirección';
  const phone = order.customerPhone?.trim() || null;

  return (
    <div
      className="fixed inset-0 z-1000 flex cursor-pointer items-center justify-center bg-overlay/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl cursor-default flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Cabecera ── */}
        <div className="flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-mono text-base font-bold text-ink">
                {order.referenceCode}
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.badge}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
                {meta.label}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink-faint">
              Pedido #{order.orderId} · {meta.action}
            </p>
          </div>
          <button
            onClick={onClose}
            title="Cerrar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-3 hover:text-ink-soft"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Cuerpo ── */}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {/* Repartidor */}
          <Section icon={Truck} title="Repartidor">
            <div className="flex items-center gap-3">
              {driver ? (
                <DriverAvatar driver={driver} size={40} />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-invert text-xs font-bold text-invert-ink">
                  {initials(order.driverName)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{order.driverName}</p>
                <p className="text-[11px] text-ink-faint">
                  {driver?.vehicleType ?? 'Vehículo'}
                  {driver?.vehiclePlate ? ` · ${driver.vehiclePlate}` : order.driverPlate ? ` · ${order.driverPlate}` : ''}
                </p>
              </div>
            </div>
          </Section>

          {/* Cliente */}
          <Section icon={User} title="Cliente">
            <Row label="Nombre">{order.customerName ?? 'Cliente'}</Row>
            <Row label="Teléfono">{phone ?? 'Sin teléfono'}</Row>
            {phone && (
              <a
                href={`tel:${phone}`}
                className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-bold text-on-accent transition hover:bg-accent-strong"
              >
                <Phone className="h-3.5 w-3.5" /> Llamar al cliente
              </a>
            )}
          </Section>

          {/* Entrega */}
          <Section icon={MapPin} title="Dirección de entrega">
            <p className="text-xs text-ink-soft">{address}</p>
            {order.notes && (
              <p className="mt-1.5 rounded-lg bg-surface px-2.5 py-2 text-[11px] italic text-ink-faint">
                “{order.notes}”
              </p>
            )}
          </Section>

          {/* Tiempos */}
          {steps.length > 0 && (
            <Section icon={Clock} title="Tiempos">
              <ol className="mt-1 space-y-0">
                {steps.map((s, i) => {
                  const isCurrent = i === currentIndex;
                  return (
                    <li key={s.key as string} className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className="mt-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface-2"
                          style={{ background: isCurrent ? meta.color : '#cbd5e1' }}
                        />
                        {i < steps.length - 1 && <span className="h-6 w-px bg-line" />}
                      </div>
                      <div className="flex flex-1 items-baseline justify-between gap-3 pb-1">
                        <span
                          className={`text-xs ${isCurrent ? 'font-bold text-ink' : 'text-ink-faint'}`}
                        >
                          {s.label}
                        </span>
                        <span className="text-xs text-ink-soft">{formatDateTime(s.at)}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Section>
          )}

          {/* Pago y totales */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Section icon={CreditCard} title="Pago">
              <Row label="Método">{order.payment.label}</Row>
              <Row label="Total">
                <span className="text-sm font-bold text-ink">
                  {formatMoney(order.totals.value, order.totals.currency)}
                </span>
              </Row>
            </Section>
            <Section icon={Boxes} title="Carga">
              <Row label="Volumen">
                {formatVolume(order.volume?.cm3)}
                {order.volume?.estimated && (
                  <span className="ml-1 text-amber-600" title="Hay ítems sin medidas en el catálogo">
                    (aprox.)
                  </span>
                )}
              </Row>
            </Section>
          </div>

          {/* Sucursal */}
          {(order.branchName || order.branchAddress) && (
            <Section icon={Store} title="Sucursal">
              <Row label="Sucursal">{order.branchName ?? '—'}</Row>
              {order.branchAddress && <Row label="Dirección">{order.branchAddress}</Row>}
            </Section>
          )}
        </div>

        {/* ── Acciones ── */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-5 py-3.5">
          {isDelivered && onShowRoute ? (
            <button
              onClick={onShowRoute}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-violet-700"
            >
              <Route className="h-3.5 w-3.5" /> Ver ruta en el mapa
            </button>
          ) : (
            onLocate && (
              <button
                onClick={() => onLocate(order.driverId)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-invert px-3.5 py-2 text-xs font-bold text-invert-ink transition hover:bg-invert/90"
              >
                <LocateFixed className="h-3.5 w-3.5" /> Ver en el mapa
              </button>
            )
          )}
          {onChat && (
            <button
              onClick={() => onChat(order.driverId)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-xs font-bold text-ink-soft transition hover:bg-surface-2"
            >
              <MessageCircle className="h-3.5 w-3.5" /> Chat con el repartidor
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded-xl border border-line px-3.5 py-2 text-xs font-semibold text-ink-soft transition hover:bg-surface-2"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
