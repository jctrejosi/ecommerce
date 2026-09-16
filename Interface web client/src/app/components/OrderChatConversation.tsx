import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCheck, Loader2, Send, X } from "lucide-react";
import {
  ordersService,
  type OrderChatMessage,
} from "../../services/orders.service";

const POLL_MS = 3000;

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

interface OrderChatConversationProps {
  /** Código de referencia del pedido (público). */
  orderCode: string;
  /** Título corto para el encabezado (opcional). */
  title?: string;
  /** Si se define, muestra botón de volver en el encabezado. */
  onBack?: () => void;
  /** Si se define, muestra botón de cerrar en el encabezado. */
  onClose?: () => void;
}

/**
 * Conversación del chat por pedido (cliente ↔ repartidor).
 * Consulta los mensajes cada 3 s mientras está montado.
 */
export function OrderChatConversation({
  orderCode,
  title,
  onBack,
  onClose,
}: OrderChatConversationProps) {
  const [messages, setMessages] = useState<OrderChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const seenRef = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      const rows = await ordersService.chatMessages(orderCode);
      setMessages(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el chat");
    } finally {
      setLoading(false);
    }
  }, [orderCode]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    void load();
    timerRef.current = window.setInterval(() => void load(), POLL_MS);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    };
  }, [load]);

  // Acuse de lectura: al ver la conversación, el repartidor recibe el visto de
  // lo que escribió. Se sella una sola vez por mensaje pendiente.
  useEffect(() => {
    const pending = messages.some((m) => m.senderType === "delivery" && !m.readAt);
    if (!pending) return;
    let cancelled = false;
    void (async () => {
      try {
        const now = new Date().toISOString();
        await ordersService.markChatRead(orderCode);
        if (cancelled) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.senderType === "delivery" && !m.readAt ? { ...m, readAt: now } : m,
          ),
        );
      } catch {
        // Si falla, el siguiente sondeo lo vuelve a intentar.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, orderCode]);

  // Auto-scroll al final cuando llegan mensajes nuevos.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const shouldStick =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120 || messages.length > seenRef.current;
    seenRef.current = messages.length;
    if (shouldStick) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const msg = await ordersService.sendChatMessage(orderCode, text);
      setDraft("");
      // Se añade al final; el próximo poll trae el resto.
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar el mensaje");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Encabezado */}
      {(onBack || onClose || title) && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Volver"
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-4.5 h-4.5" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate">
              {title ?? `Pedido ${orderCode}`}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Chat con tu repartidor
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          )}
        </div>
      )}

      {/* Mensajes */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0 bg-muted/30">
        {loading && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Cargando conversación…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-10 px-4">
            <span className="text-2xl mb-2">💬</span>
            <p className="text-xs font-semibold text-foreground">
              Aún no hay mensajes
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Escríbele a tu repartidor para coordinar la entrega.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.senderType === "customer";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 shadow-sm ${
                    mine
                      ? "bg-[#FFF200] text-[#1A1A2E] rounded-br-md"
                      : "bg-white border border-border text-foreground rounded-bl-md"
                  }`}
                >
                  {!mine && (
                    <p className="text-[10px] font-bold text-muted-foreground mb-0.5">
                      🛵 Tu repartidor
                    </p>
                  )}
                  <p className="text-sm whitespace-pre-wrap break-words leading-snug">
                    {m.body}
                  </p>
                  <p
                    className={`text-[9px] mt-1 flex items-center gap-1 ${
                      mine
                        ? "text-[#1A1A2E]/50 justify-end"
                        : "text-muted-foreground/70"
                    }`}
                  >
                    <span>{fmtTime(m.createdAt)}</span>
                    {mine &&
                      (m.readAt ? (
                        <CheckCheck
                          className="w-3.5 h-3.5 text-[#1A1A2E]"
                          aria-label="Leído por tu repartidor"
                        />
                      ) : (
                        <Check
                          className="w-3.5 h-3.5"
                          aria-label="Enviado"
                        />
                      ))}
                  </p>
                </div>
              </div>
            );
          })
        )}
        {error && (
          <p className="text-center text-[11px] text-red-600 bg-red-50 rounded-lg px-2 py-1">
            {error}
          </p>
        )}
      </div>

      {/* Entrada */}
      <div className="shrink-0 border-t border-border bg-white px-3 py-2.5 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Escribe un mensaje…"
          className="flex-1 resize-none rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-[#FFF200] focus:border-transparent max-h-28"
        />
        <button
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          aria-label="Enviar mensaje"
          className="w-10 h-10 rounded-full bg-[#1A1A2E] text-[#FFF200] flex items-center justify-center shrink-0 disabled:opacity-40 transition-all hover:scale-105 active:scale-95"
        >
          {sending ? (
            <Loader2 className="w-4.5 h-4.5 animate-spin" />
          ) : (
            <Send className="w-4.5 h-4.5" />
          )}
        </button>
      </div>
    </div>
  );
}
