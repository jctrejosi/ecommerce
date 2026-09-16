import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, MessageCircle, X } from "lucide-react";
import type { Order } from "../types";
import {
  ordersService,
  type OrderChatMessage,
} from "../../services/orders.service";
import { OrderChatConversation } from "./OrderChatConversation";

/** Cada cuánto se revisan los mensajes de los pedidos en camino. */
const POLL_MS = 4000;

type ChatInfo = {
  /** Último mensaje de la conversación (de cualquiera de los dos lados). */
  lastMessage: OrderChatMessage | null;
  /** Fecha ISO de ese último mensaje, "" si aún no hay ninguno. */
  lastAt: string;
  /** Mensajes del repartidor que el cliente todavía no ha leído. */
  unread: number;
};

/** "ahora" / "hace 5 min" / hora exacta, para la fila del pedido. */
function fmtWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

interface OrderChatWidgetProps {
  /** Pedidos del cliente logueado (App ya los carga con ordersService.getOrders). */
  orders: Order[];
}

/**
 * Burbuja flotante de chat por pedido. Aparece cuando el cliente tiene al
 * menos un pedido "en camino": abre un panel con la lista de esos pedidos y,
 * al elegir uno, la conversación con su repartidor.
 *
 * Mientras está montado consulta los mensajes de todos esos pedidos, de modo
 * que un mensaje nuevo del repartidor se delate con una animación en la
 * burbuja y con el resaltado de su fila en la lista. La lista va del chat con
 * actividad más reciente al más antiguo.
 *
 * Los no leídos salen del propio servidor (`read_at` del mensaje, que sella la
 * contraparte al leer): así el aviso se apaga al abrir la conversación desde
 * cualquier dispositivo, no solo desde este navegador.
 */
export function OrderChatWidget({ orders }: OrderChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, ChatInfo>>({});
  const selectedRef = useRef<string | null>(null);

  const inDelivery = useMemo(
    () => orders.filter((o) => o.status === "en camino"),
    [orders],
  );

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Si ya no hay pedidos en camino (p. ej. se entregó), cierra el panel.
  useEffect(() => {
    if (inDelivery.length === 0) {
      setOpen(false);
      setSelected(null);
    }
  }, [inDelivery.length]);

  const poll = useCallback(async () => {
    if (inDelivery.length === 0) return;
    const results = await Promise.all(
      inDelivery.map(async (o) => {
        try {
          return { code: o.id, rows: await ordersService.chatMessages(o.id) };
        } catch {
          return null; // un pedido que falle no debe romper el resto
        }
      }),
    );

    const next: Record<string, ChatInfo> = {};
    for (const r of results) {
      if (!r) continue;
      const last = r.rows.length > 0 ? r.rows[r.rows.length - 1] : null;
      const isOpen = selectedRef.current === r.code;
      next[r.code] = {
        lastMessage: last,
        lastAt: last?.createdAt ?? "",
        // La conversación abierta se da por leída: el acuse lo manda el propio
        // componente de la conversación, así que aquí ya no cuenta como aviso.
        unread: isOpen
          ? 0
          : r.rows.filter((m) => m.senderType === "delivery" && !m.readAt)
              .length,
      };
    }
    setChats((prev) => ({ ...prev, ...next }));
  }, [inDelivery]);

  useEffect(() => {
    if (inDelivery.length === 0) return;
    void poll();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void poll();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [inDelivery.length, poll]);

  // Lista ordenada por actividad: el chat más reciente queda arriba.
  const list = useMemo(() => {
    return [...inDelivery].sort((a, b) => {
      const ta = chats[a.id]?.lastAt ?? "";
      const tb = chats[b.id]?.lastAt ?? "";
      if (ta !== tb) return tb.localeCompare(ta);
      return (b.date ?? "").localeCompare(a.date ?? "");
    });
  }, [inDelivery, chats]);

  const totalUnread = useMemo(
    () => list.reduce((acc, o) => acc + (chats[o.id]?.unread ?? 0), 0),
    [list, chats],
  );

  const openConversation = (orderCode: string) => {
    selectedRef.current = orderCode;
    setSelected(orderCode);
    setChats((prev) => ({
      ...prev,
      [orderCode]: { ...prev[orderCode], unread: 0 },
    }));
  };

  if (inDelivery.length === 0) return null;

  return (
    <>
      {/* Burbuja flotante — encima del chatbot de compras */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={
          totalUnread > 0
            ? `Chat con tu repartidor, ${totalUnread} mensaje${totalUnread === 1 ? "" : "s"} sin leer`
            : "Chat con tu repartidor"
        }
        className="fixed bottom-20 right-3 sm:bottom-24 sm:right-5 z-[92] w-14 h-14 rounded-full bg-[#1A1A2E] text-[#FFF200] border-2 border-[#1A1A2E]/90 shadow-[0_6px_20px_rgba(26,26,46,0.35)] flex items-center justify-center cursor-pointer hover:scale-110 active:scale-90 transition-all"
      >
        {totalUnread > 0 ? (
          <span className="chat-alert" aria-hidden="true" />
        ) : null}
        {open ? (
          <X className="w-6 h-6" />
        ) : (
          <>
            <MessageCircle
              className={`w-6 h-6 ${
                totalUnread > 0
                  ? "animate-chat-wiggle motion-reduce:animate-none"
                  : ""
              }`}
            />
            {totalUnread > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-black flex items-center justify-center border-2 border-white">
                {totalUnread}
              </span>
            ) : (
              inDelivery.length > 1 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-black flex items-center justify-center border-2 border-white">
                  {inDelivery.length}
                </span>
              )
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
                  <p
                    className={`text-[10px] ${
                      totalUnread > 0 ? "text-[#FFF200] font-semibold" : "text-white/70"
                    }`}
                  >
                    {totalUnread > 0
                      ? `${totalUnread} mensaje${totalUnread === 1 ? "" : "s"} nuevo${totalUnread === 1 ? "" : "s"} sin leer`
                      : inDelivery.length === 1
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
                {list.map((o) => {
                  const info = chats[o.id];
                  const unread = info?.unread ?? 0;
                  const preview =
                    info?.lastMessage?.body || o.address || "En camino hacia ti";
                  return (
                    <button
                      key={o.id}
                      onClick={() => openConversation(o.id)}
                      className={`w-full text-left rounded-2xl border p-3.5 flex items-center gap-3 transition-all ${
                        unread > 0
                          ? "bg-[#FFF200]/25 border-[#FFF200] shadow-sm hover:shadow-md"
                          : "bg-white border-border hover:border-[#1A1A2E]/40 hover:shadow-sm"
                      }`}
                    >
                      <span className="relative w-10 h-10 rounded-xl bg-[#FFF200] flex items-center justify-center text-lg shrink-0">
                        🛵
                        {unread > 0 && (
                          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[#EF4444] text-white text-[9px] font-black flex items-center justify-center border border-white">
                            {unread}
                          </span>
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-bold text-foreground truncate">
                            Pedido {o.id}
                          </span>
                          {info?.lastAt ? (
                            <span
                              className={`text-[10px] shrink-0 ${
                                unread > 0
                                  ? "text-[#EF4444] font-bold"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {fmtWhen(info.lastAt)}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={`block text-[11px] truncate mt-0.5 ${
                            unread > 0
                              ? "text-foreground font-semibold"
                              : "text-muted-foreground"
                          }`}
                        >
                          {preview}
                        </span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
