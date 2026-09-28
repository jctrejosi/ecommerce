import {
  Package,
  X,
  ArrowLeft,
  ChevronRight,
  CheckCircle2,
  MapPin,
  Wallet,
  Clock,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ordersService } from "../../services/orders.service";
import type { Order } from "../types";

interface OrdersPanelProps {
  ordersOpen: boolean;
  orders: Order[];
  selectedOrder: Order | null;
  onClose: () => void;
  onSelectOrder: (order: Order | null) => void;
  onGoToCatalog: () => void;
  /** Abre el rastreo en el mapa para un pedido en camino. */
  onTrackOrder?: (code: string) => void;
  fmt: (n: number) => string;
}

export function OrdersPanel({
  ordersOpen,
  orders,
  selectedOrder,
  onClose,
  onSelectOrder,
  onGoToCatalog,
  onTrackOrder,
  fmt,
}: OrdersPanelProps) {
  const [trackCode, setTrackCode] = useState("");
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);

  // Bloquea el scroll del documento mientras el panel está abierto.
  useEffect(() => {
    if (!ordersOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [ordersOpen]);

  if (!ordersOpen) return null;

  const handleTrack = async () => {
    const code = trackCode.trim();
    if (!code || trackLoading) return;
    setTrackLoading(true);
    setTrackError(null);
    try {
      const order = await ordersService.trackOrder(code);
      onSelectOrder(order);
      setTrackCode("");
    } catch (e) {
      setTrackError(
        e instanceof Error ? e.message : "No se pudo consultar el pedido",
      );
    } finally {
      setTrackLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          onClose();
          onSelectOrder(null);
        }}
      />
      <div className="relative ml-auto w-full max-w-md bg-white h-full flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          {selectedOrder && (
            <button
              onClick={() => onSelectOrder(null)}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="flex-1">
            <h2
              className="font-black text-base"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
            >
              {selectedOrder ? `Pedido ${selectedOrder.id}` : "Mis pedidos"}
            </h2>
            {!selectedOrder && (
              <p className="text-xs text-muted-foreground">
                {orders.length} pedido{orders.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <button
            onClick={() => {
              onClose();
              onSelectOrder(null);
            }}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Buscador por código de pedido (para compras sin sesión) */}
          {!selectedOrder && (
            <div className="p-4 border-b border-border">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                ¿Compraste sin iniciar sesión? Busca tu pedido con su código
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleTrack();
                }}
                className="flex gap-2"
              >
                <input
                  value={trackCode}
                  onChange={(e) => setTrackCode(e.target.value)}
                  placeholder="Ej: MER-12345678"
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none uppercase"
                  style={{ boxShadow: "none" }}
                />
                <button
                  type="submit"
                  disabled={trackLoading || !trackCode.trim()}
                  className="px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer"
                  style={{ background: "#FFF200", color: "#1A1A2E" }}
                >
                  <Search size={14} />
                  {trackLoading ? "..." : "Buscar"}
                </button>
              </form>
              {trackError && (
                <p className="text-xs text-red-500 mt-1.5">{trackError}</p>
              )}
            </div>
          )}

          {!selectedOrder && orders.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <Package className="w-12 h-12 text-muted-foreground" />
              <p className="font-semibold text-sm">No tienes pedidos aún</p>
              <p className="text-xs text-muted-foreground">
                Cuando completes una compra, aparecerá aquí.
              </p>
              <button
                onClick={() => onGoToCatalog()}
                className="mt-2 px-6 py-3 rounded-xl font-bold text-sm"
                style={{ background: "#FFF200", color: "#1A1A2E" }}
              >
                Ir a comprar
              </button>
            </div>
          )}

          {!selectedOrder && orders.length > 0 && (
            <div className="divide-y divide-border">
              {orders.map((order) => {
                const statusColor = {
                  pendiente: "#FF9500",
                  preparando: "#FF9500",
                  listo: "#0D9488",
                  "en camino": "#007AFF",
                  entregado: "#34C759",
                  cancelado: "#EF4444",
                }[order.status];
                const statusLabel = {
                  pendiente: "Pendiente",
                  preparando: "Preparando",
                  listo: "Listo",
                  "en camino": "En camino",
                  entregado: "Entregado",
                  cancelado: "Cancelado",
                }[order.status];
                return (
                  <button
                    key={order.id}
                    onClick={() => onSelectOrder(order)}
                    className="w-full text-left px-5 py-4 hover:bg-muted/50 transition-colors flex items-start gap-3"
                  >
                    <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 justify-between">
                        <span className="font-bold text-sm">{order.id}</span>
                        <span
                          className="text-xs font-bold px-2 py-0.5 rounded-full text-white shrink-0"
                          style={{ background: statusColor }}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {order.date}
                      </p>
                      <p className="text-xs mt-0.5">
                        {order.items.length} producto
                        {order.items.length !== 1 ? "s" : ""} ·{" "}
                        {fmt(order.total)}
                      </p>
                      {order.status === "en camino" && onTrackOrder && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            onTrackOrder(String(order.id));
                          }}
                          className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all hover:brightness-95"
                          style={{ background: "#FFF200", color: "#1A1A2E" }}
                        >
                          🛵 Rastrear en el mapa
                        </span>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                  </button>
                );
              })}
            </div>
          )}

          {selectedOrder &&
            (() => {
              const statusColor = {
                pendiente: "#FF9500",
                preparando: "#FF9500",
                listo: "#0D9488",
                "en camino": "#007AFF",
                entregado: "#34C759",
                cancelado: "#EF4444",
              }[selectedOrder.status];
              const statusLabel = {
                pendiente: "Pendiente",
                preparando: "Preparando tu pedido",
                listo: "Listo para entrega",
                "en camino": "En camino",
                entregado: "Entregado",
                cancelado: "Cancelado",
              }[selectedOrder.status];
              const stepNum = {
                pendiente: 0,
                preparando: 1,
                listo: 2,
                "en camino": 3,
                entregado: 4,
                cancelado: -1,
              }[selectedOrder.status];
              const trackSteps = [
                "Confirmado",
                "Preparando",
                "Listo",
                "En camino",
                "Entregado",
              ];
              return (
                <div className="p-5 space-y-4">
                  <div
                    className="rounded-2xl p-4 space-y-3"
                    style={{ background: "#F4F4F6" }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ background: statusColor }}
                      >
                        <CheckCircle2 className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">{statusLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {selectedOrder.date}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center">
                      {trackSteps.map((s, i) => (
                        <div
                          key={s}
                          className="flex items-center flex-1 last:flex-none"
                        >
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{
                              background: i <= stepNum ? "#34C759" : "#D1D5DB",
                            }}
                          />
                          {i < trackSteps.length - 1 && (
                            <div
                              className="h-0.5 flex-1"
                              style={{
                                background: i < stepNum ? "#34C759" : "#D1D5DB",
                              }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      {trackSteps.map((s) => (
                        <span key={s}>{s}</span>
                      ))}
                    </div>
                  </div>

                  {selectedOrder.status === "en camino" && onTrackOrder && (
                    <button
                      onClick={() => onTrackOrder(String(selectedOrder.id))}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all hover:brightness-95"
                      style={{ background: "#FFF200", color: "#1A1A2E" }}
                    >
                      🛵 Ver rastreo en el mapa
                    </button>
                  )}

                  <div>
                    <h3 className="text-sm font-bold mb-2">Productos</h3>
                    <div className="bg-white rounded-2xl border border-border divide-y divide-border overflow-hidden">
                      {selectedOrder.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 px-4 py-3"
                        >
                          <img
                            src={item.image}
                            alt={item.name}
                            className="w-12 h-12 object-cover rounded-lg"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate">
                              {item.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              × {item.quantity}
                            </p>
                          </div>
                          <span className="text-xs font-bold">
                            {fmt(item.price * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-border p-4 space-y-2">
                    <h3 className="text-sm font-bold mb-1">
                      Detalles del envío
                    </h3>
                    <div className="flex items-start gap-2 text-xs text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{selectedOrder.address}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Wallet className="w-3.5 h-3.5 shrink-0" />
                      <span className="capitalize">
                        {selectedOrder.paymentMethod}
                      </span>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-border p-4 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>
                        {fmt(selectedOrder.total - selectedOrder.shipping)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Envío</span>
                      <span>{fmt(selectedOrder.shipping)}</span>
                    </div>
                    <div className="flex justify-between font-black border-t border-border pt-2">
                      <span>Total</span>
                      <span>{fmt(selectedOrder.total)}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
        </div>
      </div>
    </div>
  );
}
