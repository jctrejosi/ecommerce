import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { X, Home, Navigation, PackageCheck, Loader2, MessageCircle } from "lucide-react";
import {
  ordersService,
  type OrderLiveRoute,
  type OrderLiveTracking,
} from "../../services/orders.service";
import { LiveOrderMap } from "./LiveOrderMap";
import { OrderChatConversation } from "./OrderChatConversation";

const SOCKET_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

const STATUS_TEXT: Record<string, { label: string; tone: string; showMap: boolean }> = {
  ASSIGNED: { label: "Repartidor asignado", tone: "#F59E0B", showMap: false },
  ACCEPTED: { label: "Repartidor aceptó el pedido", tone: "#F59E0B", showMap: false },
  READY_FOR_PICKUP: { label: "Recogiendo el pedido en la tienda", tone: "#F59E0B", showMap: false },
  PICKED_UP: { label: "Pedido recogido — ¡ya viene!", tone: "#2563EB", showMap: true },
  IN_DELIVERY: { label: "En camino hacia ti", tone: "#2563EB", showMap: true },
  DELIVERED: { label: "Entregado 🎉", tone: "#16A34A", showMap: true },
  FAILED_DELIVERY: { label: "No se pudo entregar", tone: "#EF4444", showMap: false },
  REJECTED: { label: "Entrega rechazada", tone: "#EF4444", showMap: false },
  CANCELLED: { label: "Cancelado", tone: "#EF4444", showMap: false },
};

const fmtTime = (iso: string | null | undefined) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

interface OrderTrackingModalProps {
  orderCode: string;
  onClose: () => void;
}

/**
 * Modal de rastreo en vivo: consulta `GET /orders/track/:code/live` cada 3 s y
 * pinta al repartidor sobre el mismo mapa del delivery admin (Liberty).
 */
export function OrderTrackingModal({ orderCode, onClose }: OrderTrackingModalProps) {
  const [data, setData] = useState<OrderLiveTracking | null>(null);
  const [route, setRoute] = useState<OrderLiveRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const routeTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const live = await ordersService.liveTracking(orderCode);
      setData(live);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar el rastreo");
    } finally {
      setLoading(false);
    }
  }, [orderCode]);

  // La ruta por calles se recalcula más lento que la posición: el backend la
  // cachea ~30 s y no conviene pedirla en cada refresco del rastreo.
  const loadRoute = useCallback(async () => {
    try {
      setRoute(await ordersService.liveRoute(orderCode));
    } catch {
      /* sin ruta disponible: se conserva la anterior */
    }
  }, [orderCode]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    void load();
    timerRef.current = window.setInterval(() => void load(), 3000);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    };
  }, [load]);

  useEffect(() => {
    setRoute(null);
    void loadRoute();
    routeTimerRef.current = window.setInterval(() => void loadRoute(), 30_000);
    return () => {
      if (routeTimerRef.current != null) window.clearInterval(routeTimerRef.current);
    };
  }, [loadRoute]);

  // En vivo: el backend avisa al instante cuando el pedido cambia de estado
  // (picking → "en camino" → "entregado"), sin esperar al siguiente sondeo.
  // El intervalo de 3 s se mantiene como respaldo si el socket no está.
  useEffect(() => {
    const socket = io(`${SOCKET_URL}/orders`, {
      transports: ["websocket", "polling"],
    });
    const subscribe = () => socket.emit("subscribe:order", orderCode);
    socket.on("connect", subscribe);

    const onUpdate = () => {
      void load();
      void loadRoute();
    };
    socket.on("order:status", onUpdate);
    socket.on("order:updated", onUpdate);

    return () => {
      socket.emit("unsubscribe:order", orderCode);
      socket.off("connect", subscribe);
      socket.off("order:status", onUpdate);
      socket.off("order:updated", onUpdate);
      socket.disconnect();
    };
  }, [orderCode, load, loadRoute]);

  const delivery = data?.deliveryStatus ? STATUS_TEXT[data.deliveryStatus] : null;
  const canShowMap =
    data != null &&
    (data.driver?.location != null ||
      data.destination?.location != null ||
      data.branch?.location != null);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[92vh] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-white shrink-0">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
              Rastreo en vivo
            </p>
            <h2
              className="font-black text-lg text-foreground leading-tight"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
            >
              Pedido {orderCode}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {chatOpen ? (
          <OrderChatConversation
            orderCode={orderCode}
            title={`Pedido ${orderCode}`}
            onBack={() => setChatOpen(false)}
            onClose={onClose}
          />
        ) : (
        <div className="flex-1 overflow-y-auto">
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Buscando tu repartidor…</p>
            </div>
          ) : error && !data ? (
            <div className="p-6 text-center">
              <p className="text-sm text-red-600 font-semibold">{error}</p>
              <button
                onClick={() => void load()}
                className="mt-3 px-4 py-2 rounded-xl text-xs font-bold border border-border hover:bg-muted transition-colors"
              >
                Reintentar
              </button>
            </div>
          ) : data ? (
            <div className="p-5 space-y-4">
              {/* Estado */}
              <div
                className="rounded-2xl px-4 py-3 flex items-center gap-3"
                style={{
                  background: (delivery?.tone ?? "#F59E0B") + "14",
                  border: `1px solid ${delivery?.tone ?? "#F59E0B"}33`,
                }}
              >
                <span
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: delivery?.tone ?? "#F59E0B" }}
                >
                  {data.deliveryStatus === "DELIVERED" ? (
                    <PackageCheck className="w-4.5 h-4.5 text-white" />
                  ) : (
                    <Navigation className="w-4.5 h-4.5 text-white" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-bold text-foreground">
                    {delivery?.label ?? "Preparando tu pedido"}
                  </p>
                  {delivery?.label !== "Entregado 🎉" && (
                    <p className="text-[11px] text-muted-foreground">
                      Actualizando cada pocos segundos…
                    </p>
                  )}
                </div>
              </div>

              {/* Mapa */}
              {canShowMap ? (
                <div className="h-72">
                  <LiveOrderMap
                    driver={data.driver?.location ?? null}
                    destination={data.destination?.location ?? null}
                    branch={data.branch?.location ?? null}
                    routePolyline={route?.polyline ?? null}
                  />
                </div>
              ) : (
                <div className="h-40 rounded-2xl bg-muted/60 flex flex-col items-center justify-center text-center px-6">
                  <PackageCheck className="w-8 h-8 text-muted-foreground/60 mb-2" />
                  <p className="text-xs font-semibold text-foreground">
                    El mapa aparecerá cuando el repartidor salga con tu pedido
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Te avisaremos con una notificación en cuanto esté en camino.
                  </p>
                </div>
              )}

              {/* Repartidor */}
              {data.driver && (
                <div className="rounded-2xl border border-border p-4 flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl bg-[#FFF200] shrink-0">
                    🛵
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">
                      {data.driver.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[data.driver.vehicleType, data.driver.vehiclePlate]
                        .filter(Boolean)
                        .join(" · ") || "Repartidor"}
                    </p>
                  </div>
                  {/* El chat solo se muestra mientras el pedido está en camino */}
                  {(data.deliveryStatus === "PICKED_UP" ||
                    data.deliveryStatus === "IN_DELIVERY") && (
                    <button
                      onClick={() => setChatOpen(true)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-[#1A1A2E] bg-[#FFF200] hover:brightness-95 transition-all"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Chatear
                    </button>
                  )}
                  {data.updatedAt && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      Últ. ubicación {fmtTime(data.updatedAt)}
                    </span>
                  )}
                </div>
              )}

              {/* Destino */}
              <div className="rounded-2xl border border-border p-4 flex items-start gap-3">
                <Home className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground">Dirección de entrega</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data.destination.address || "—"}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        )}
      </div>
    </div>
  );
}
