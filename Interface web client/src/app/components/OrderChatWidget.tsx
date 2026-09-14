import { useEffect, useMemo, useState } from "react";
import { ChevronRight, MessageCircle, X } from "lucide-react";
import type { Order } from "../types";
import { OrderChatConversation } from "./OrderChatConversation";

interface OrderChatWidgetProps {
  /** Pedidos del cliente logueado (App ya los carga con ordersService.getOrders). */
  orders: Order[];
}

/**
 * Burbuja flotante de chat por pedido. Aparece cuando el cliente tiene al
 * menos un pedido "en camino": abre un panel con la lista de esos pedidos y,
 * al elegir uno, la conversación con su repartidor.
 */
export function OrderChatWidget({ orders }: OrderChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const inDelivery = useMemo(
    () => orders.filter((o) => o.status === "en camino"),
    [orders],
  );

  // Si ya no hay pedidos en camino (p. ej. se entregó), cierra el panel.
  useEffect(() => {
    if (inDelivery.length === 0) {
      setOpen(false);
      setSelected(null);
    }
  }, [inDelivery.length]);

  if (inDelivery.length === 0) return null;

  return (
    <>
      {/* Burbuja flotante — encima del chatbot de compras */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Chat con tu repartidor"
        className="fixed bottom-20 right-3 sm:bottom-24 sm:right-5 z-[92] w-14 h-14 rounded-full bg-[#1A1A2E] text-[#FFF200] border-2 border-[#1A1A2E]/90 shadow-[0_6px_20px_rgba(26,26,46,0.35)] flex items-center justify-center cursor-pointer hover:scale-110 active:scale-90 transition-all"
      >
        {open ? (
          <X className="w-6 h-6" />
        ) : (
          <>
            <MessageCircle className="w-6 h-6" />
            {inDelivery.length > 1 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-black flex items-center justify-center border-2 border-white">
                {inDelivery.length}
              </span>
            )}
          </>
        )}
      </button>

      {/* Panel — igual patrón que el chatbot de compras */}
      {open && (
        <div className="fixed inset-0 z-[96] h-[100dvh] w-full max-w-full bg-white shadow-2xl border border-black/10 flex flex-col overflow-hidden sm:top-auto sm:inset-x-auto sm:bottom-32 sm:right-5 sm:w-[92vw] sm:max-w-sm sm:h-[520px] sm:max-h-[70vh] sm:rounded-2xl">
          {selected ? (
            <OrderChatConversation
              orderCode={selected}
              title={`Pedido ${selected}`}
              onBack={() => setSelected(null)}
              onClose={() => {
                setOpen(false);
                setSelected(null);
              }}
            />
          ) : (
            <>
              {/* Encabezado */}
              <div className="bg-[#1A1A2E] text-white px-4 py-3 flex items-center justify-between shrink-0">
                <div>
                  <p className="text-sm font-bold leading-tight">
                    Chat con tu repartidor
                  </p>
                  <p className="text-[10px] text-white/70">
                    {inDelivery.length === 1
                      ? "Tienes 1 pedido en camino"
                      : `Tienes ${inDelivery.length} pedidos en camino`}
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Cerrar"
                  className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Lista de pedidos por entregar */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-muted/30">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground px-1">
                  Elige el pedido sobre el que quieres hablar
                </p>
                {inDelivery.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setSelected(o.id)}
                    className="w-full text-left bg-white rounded-2xl border border-border p-3.5 flex items-center gap-3 hover:border-[#1A1A2E]/40 hover:shadow-sm transition-all"
                  >
                    <span className="w-10 h-10 rounded-xl bg-[#FFF200] flex items-center justify-center text-lg shrink-0">
                      🛵
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-foreground truncate">
                        Pedido {o.id}
                      </span>
                      <span className="block text-[11px] text-muted-foreground truncate mt-0.5">
                        {o.address || "En camino hacia ti"}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
