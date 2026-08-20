import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chatbotService,
  type BotCart,
  type BotHistoryMessage,
  type BotPayload,
  type BotProduct,
  type BotQuickOption,
} from "../services/chatbot.service";
import logoBot from "../../assets/logo-bot.png";
import type { CartItem } from "../app/types";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  payload?: BotPayload;
};

/**
 * Sesión nueva por apertura: el bot siempre empieza limpio.
 * (No se persiste en localStorage; cada visita/apertura es una sesión fresca
 *  con carrito y conversación nuevos.)
 */
function getSessionId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const fmtPrice = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

/**
 * Reproduce un "ding" de notificación (dos tonos) con Web Audio API.
 * Devuelve true si el contexto quedó en estado audible; false si el
 * navegador lo tiene bloqueado (autoplay) para poder reintentar al primer gesto.
 */
function playNotificationChime(): boolean {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return false;

    const ctx = new Ctor();
    // Si el navegador bloqueó el contexto (autoplay sin gesto), no programar
    // el sonido ni dejar el contexto abierto: se reintentará en el primer gesto.
    if (ctx.state !== "running") {
      void ctx.close().catch(() => {});
      return false;
    }

    const now = ctx.currentTime;
    const notes: Array<[number, number]> = [
      [880, 0], // A5
      [1174.66, 0.16], // D6
    ];
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + at);
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.35, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.5);
    }

    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 1600);

    return true;
  } catch {
    return false;
  }
}

type Props = {
  onAddProduct: (p: {
    id: number;
    name: string;
    price: number;
    image?: string | null;
    slug?: string;
  }) => void;
  onApplyCart: (cart: BotCart) => void;
  pageCartItems: CartItem[];
};

export function ChatbotWidget({ onAddProduct, onApplyCart, pageCartItems }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<BotQuickOption[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string>(getSessionId());
  const historyRef = useRef<BotHistoryMessage[]>([]);
  const hasSentRef = useRef(false);

  // Modal del carrito
  const [cartModalOpen, setCartModalOpen] = useState(false);
  const [cart, setCart] = useState<BotCart | null>(null);
  const [products, setProducts] = useState<BotProduct[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(true);

  // ── Sonido de notificación + burbuja de atención al cargar ────
  useEffect(() => {
    let sounded = false;
    const tryPlay = () => {
      if (sounded) return;
      sounded = playNotificationChime();
    };

    // El navegador bloquea el audio sin gesto del usuario: el sonido se
    // reproduce en el PRIMER gesto (clic/toque/tecla) sobre la página.
    const onFirstGesture = () => {
      tryPlay();
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
    window.addEventListener("pointerdown", onFirstGesture);
    window.addEventListener("keydown", onFirstGesture);

    // La burbuja de atención se oculta sola a los 9s.
    const hintTimer = setTimeout(() => setShowHint(false), 9000);

    return () => {
      clearTimeout(hintTimer);
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, []);

  useEffect(() => {
    chatbotService
      .getOptions()
      .then(setOptions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading, open]);

  const refreshCart = useCallback(async () => {
    try {
      setCart(await chatbotService.getCart(sessionRef.current));
    } catch {
      /* el modal conserva el último estado conocido */
    }
  }, []);

  const openCartModal = useCallback(
    (payload: BotPayload) => {
      if (payload.cart) setCart(payload.cart);
      if (payload.products) setProducts(payload.products);
      setCheckout(payload.checkout === true);
      setModalError(null);
      setCartModalOpen(true);
      // Si el payload no trajo carrito, refrescarlo del bot
      if (!payload.cart) void refreshCart();
    },
    [refreshCart],
  );

  // Abre el modal con el carrito que se está armando (botón del header).
  // Si todavía no tenemos el carrito en el estado local, lo refresca del bot.
  const openCurrentCart = useCallback(() => {
    setModalError(null);
    setCartModalOpen(true);
    if (!cart) void refreshCart();
  }, [cart, refreshCart]);

  const cartCount = cart?.count ?? 0;

  // Ids de productos que ya están en el carrito de la página (fuente de verdad).
  const pageProductIds = useMemo(
    () => new Set(pageCartItems.map((i) => i.id)),
    [pageCartItems],
  );

  // El carrito que muestra el modal = carrito de la página + los ítems que
  // Daisy agregó y que todavía no están en la página (sin duplicar).
  const mergedCart = useMemo<BotCart>(() => {
    const items: BotCart["items"][number][] = pageCartItems.map((p) => ({
      variant_id: p.id,
      product_id: p.id,
      name: p.name,
      slug: p.slug ?? "",
      price: p.price,
      quantity: p.quantity,
      subtotal: p.price * p.quantity,
      image: p.image ?? null,
    }));

    for (const it of cart?.items ?? []) {
      if (pageProductIds.has(it.product_id)) continue;
      items.push({ ...it });
    }

    return {
      session_id: cart?.session_id ?? sessionRef.current,
      items,
      count: items.reduce((s, i) => s + i.quantity, 0),
      total: items.reduce((s, i) => s + i.subtotal, 0),
    };
  }, [cart, pageCartItems, pageProductIds]);

  // Al abrir el chat el bot empieza SIEMPRE limpio: sesión nueva (carrito
  // nuevo en el bot), conversación vacía y sin estado previo. NO arma nada
  // automáticamente: el usuario primero interactúa y la lista sugerida se
  // arma cuando el bot la construye en la conversación.
  const openWidget = useCallback(() => {
    sessionRef.current = getSessionId();
    historyRef.current = [];
    hasSentRef.current = false;
    setMessages([]);
    setCart(null);
    setProducts([]);
    setCheckout(false);
    setCartModalOpen(false);
    setModalError(null);
    setShowHint(false);
    setOpen(true);
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || loading) return;
      hasSentRef.current = true;
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      historyRef.current.push({ role: "user", content: text });
      setLoading(true);
      try {
        const res = await chatbotService.sendMessage(
          text,
          sessionRef.current,
          historyRef.current.slice(-12),
        );
        if (res.session_id) sessionRef.current = res.session_id;
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: res.reply, payload: res.payload },
        ]);
        historyRef.current.push({ role: "assistant", content: res.reply });
        if (res.payload?.products || res.payload?.cart) {
          openCartModal(res.payload);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "Lo siento, no pude conectar con el asistente en este momento. Inténtalo de nuevo en unos segundos.",
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, openCartModal],
  );

  const runCartOp = useCallback(
    async (op: () => Promise<BotCart>) => {
      setMutating(true);
      setModalError(null);
      try {
        setCart(await op());
      } catch (e) {
        setModalError(e instanceof Error ? e.message : "No se pudo actualizar el carrito");
      } finally {
        setMutating(false);
      }
    },
    [],
  );

  const addProductToBotCart = (p: BotProduct, quantity = 1) =>
    runCartOp(() => chatbotService.addCartItem(sessionRef.current, p.product_id, quantity));

  const incItem = (it: BotCart["items"][number]) =>
    runCartOp(() => chatbotService.addCartItem(sessionRef.current, it.product_id, 1));

  const decItem = (it: BotCart["items"][number]) =>
    runCartOp(() => chatbotService.setCartItem(sessionRef.current, it.product_id, it.quantity - 1));

  const removeItem = (it: BotCart["items"][number]) =>
    runCartOp(() => chatbotService.setCartItem(sessionRef.current, it.product_id, 0));

  const searchMore = async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setModalError(null);
    setProducts(await chatbotService.searchProducts(q));
  };

  const applyCart = (c: BotCart) => {
    onApplyCart(c);
    setCartModalOpen(false);
  };

  return (
    <>
      <style>{`
        @keyframes botPop {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          80%  { transform: scale(0.94); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes hintIn {
          0%   { transform: translateY(16px) scale(0.9); opacity: 0; }
          60%  { transform: translateY(-4px) scale(1.02); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes panelIn {
          0%   { transform: translateY(24px) scale(0.96); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>

      {/* Burbuja de atención sobre el botón (se oculta sola a los 9s) */}
      {showHint && !open && (
        <div
          className="fixed bottom-20 sm:bottom-24 right-4 sm:right-5 z-[91] w-[280px] bg-white border-2 border-[#FFF200] rounded-2xl shadow-xl p-4"
          style={{ animation: "hintIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards" }}
        >
          <button
            onClick={() => setShowHint(false)}
            aria-label="Cerrar aviso"
            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-[#1A1A2E] hover:bg-gray-100 cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <p className="text-sm text-[#1A1A2E] font-semibold leading-snug pr-6">
            ¡Hola! 👋 Soy Daisy, tu asistente de compras.
          </p>
          <p className="text-xs text-gray-500 mt-1 pr-6">
            Te ayudo a armar tu carrito 🛒
          </p>
          {/* flecha que apunta al botón */}
          <div className="absolute -bottom-2 right-11 w-4 h-4 bg-white border-r-2 border-b-2 border-[#FFF200] rotate-45" />
        </div>
      )}

      {/* Botón flotante — círculo blanco con borde, visible sobre cualquier fondo */}
      <button
        onClick={() => (open ? setOpen(false) : openWidget())}
        aria-label="Daisy"
        style={{ animation: "botPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) backwards" }}
        className="fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-[90] w-14 h-14 rounded-full bg-white text-[#1A1A2E] border-2 border-[#1A1A2E]/90 shadow-[0_6px_20px_rgba(26,26,46,0.35)] flex items-center justify-center cursor-pointer hover:scale-110 hover:shadow-[0_8px_26px_rgba(26,26,46,0.45)] active:scale-90 transition-all"
      >
        {showHint && !open && (
          <span className="absolute inset-0 rounded-full bg-[#FFF200]/40 animate-ping pointer-events-none" />
        )}
        {open ? (
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <img src={logoBot} alt="Daisy" className="w-11 h-11 rounded-full object-cover" />
        )}
      </button>

      {/* Panel — en móvil ocupa la pantalla entera; en escritorio tarjeta flotante */}
      {open && (
        <div
          className="fixed inset-0 z-[95] h-[100dvh] rounded-none bg-white shadow-2xl border border-black/10 flex flex-col overflow-hidden sm:top-auto sm:inset-x-auto sm:bottom-24 sm:right-5 sm:w-[92vw] sm:max-w-sm sm:h-[560px] sm:max-h-[75vh] sm:rounded-2xl"
          style={{ animation: "panelIn 0.25s ease-out both" }}
        >
          {/* Header */}
          <div className="bg-[#1A1A2E] text-white px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-[#FFF200] text-[#1A1A2E] flex items-center justify-center overflow-hidden">
                <img src={logoBot} alt="Daisy" className="w-full h-full object-cover" />
              </div>
              <div>
                <p className="text-sm font-bold leading-tight">Daisy</p>
                <p className="text-[10px] text-white/70 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  Arma tu carrito conmigo 🛒
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {/* Botón para abrir el carrito que se está armando */}
              <button
                onClick={openCurrentCart}
                aria-label="Ver carrito de compras"
                className="relative p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="9" cy="21" r="1.6" />
                  <circle cx="19" cy="21" r="1.6" />
                  <path d="M2.5 3h2l2.6 12.5a2 2 0 0 0 2 1.5h8.7a2 2 0 0 0 2-1.5L22 7H6" />
                </svg>
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#FFF200] text-[#1A1A2E] text-[9px] font-bold flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mensajes */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3 bg-[#F7F7F9]">
            {messages.length === 0 && (
              <div className="text-sm text-gray-600 leading-relaxed">
                <p>¡Hola! 👋 Soy Daisy, tu asistente de compras de MercAldas.</p>
                <p className="mt-1">
                  Puedo armar tu carrito con los productos que me indiques:
                  búscalos, te confirmo precios y los agrego por ti.
                </p>
                <p className="mt-1 text-xs text-gray-400">Elige una opción o escríbeme:</p>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] bg-[#1A1A2E] text-white text-sm px-3.5 py-2 rounded-2xl rounded-br-md whitespace-pre-wrap">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex flex-col items-start">
                  <div className="max-w-[90%] bg-white border border-black/5 text-gray-800 text-sm px-3.5 py-2 rounded-2xl rounded-bl-md whitespace-pre-wrap shadow-sm">
                    {m.content}
                  </div>
                  {m.payload?.receta && (
                    <div className="mt-1.5 max-w-[90%] w-full bg-[#FFFDF2] border border-[#FFF200] rounded-xl p-3 shadow-sm">
                      <p className="text-sm font-bold text-[#1A1A2E]">
                        🍳 {m.payload.receta.nombre}
                      </p>
                      {m.payload.receta.agregados.length > 0 && (
                        <p className="text-xs text-gray-600 mt-1">
                          Ingredientes al carrito:{" "}
                          {m.payload.receta.agregados
                            .map((a) => `${a.name} x${a.cantidad ?? 1}`)
                            .join(", ")}
                        </p>
                      )}
                      {m.payload.receta.no_encontrados.length > 0 && (
                        <p className="text-xs text-amber-600 mt-1">
                          No encontrados en el catálogo:{" "}
                          {m.payload.receta.no_encontrados.join(", ")}
                        </p>
                      )}
                      {m.payload.receta.dudosos.length > 0 && (
                        <p className="text-xs text-orange-600 mt-1">
                          Por confirmar (no agregados):{" "}
                          {m.payload.receta.dudosos.join(", ")}
                        </p>
                      )}
                      {m.payload.receta.pasos.length > 0 && (
                        <ol className="mt-2 space-y-1">
                          {m.payload.receta.pasos.map((p, idx) => (
                            <li
                              key={idx}
                              className="text-xs text-gray-700 flex gap-1.5"
                            >
                              <span className="font-bold text-[#1A1A2E] shrink-0">
                                {idx + 1}.
                              </span>
                              <span>{p}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                  {m.payload?.cart && m.payload.cart.items.length > 0 && (
                    <button
                      onClick={() => openCartModal(m.payload!)}
                      className="mt-1.5 text-xs font-semibold text-[#1A1A2E] bg-[#FFF200] px-3 py-1.5 rounded-xl hover:bg-[#ffe60d] transition-colors"
                    >
                      🛒 Ver mi carrito ({m.payload.cart.count})
                    </button>
                  )}
                </div>
              ),
            )}

            {loading && (
              <div className="flex items-start">
                <div className="bg-white border border-black/5 text-gray-500 text-sm px-4 py-2.5 rounded-2xl rounded-bl-md shadow-sm flex gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:120ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:240ms]" />
                </div>
              </div>
            )}
          </div>

          {/* Opciones rápidas (hasta que el usuario escriba su primer mensaje) */}
          {options.length > 0 && !hasSentRef.current && !loading && (
            <div className="px-3 pb-2 flex flex-col gap-1.5 bg-[#F7F7F9]">
              {options.map((o) => (
                <button
                  key={o.id}
                  onClick={() => send(o.message)}
                  className="text-left text-xs font-medium text-[#1A1A2E] bg-white border border-black/10 hover:border-[#FFF200] hover:bg-[#FFFDF2] px-3 py-2 rounded-xl transition-colors cursor-pointer"
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-black/5 bg-white shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
              className="flex items-center gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ej: agrega 2 arroces y 1 leche"
                className="flex-1 text-sm px-3.5 py-2.5 rounded-xl bg-[#F4F4F6] focus:outline-none focus:ring-2 focus:ring-[#FFF200] placeholder:text-gray-400"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                aria-label="Enviar"
                className="w-10 h-10 rounded-xl bg-[#FFF200] text-[#1A1A2E] flex items-center justify-center disabled:opacity-40 hover:bg-[#ffe60d] transition-colors shrink-0 cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal del carrito */}
      <BotCartModal
        open={cartModalOpen}
        cart={mergedCart}
        products={products}
        checkout={checkout}
        mutating={mutating}
        error={modalError}
        readOnlyProductIds={pageProductIds}
        onClose={() => setCartModalOpen(false)}
        onInc={incItem}
        onDec={decItem}
        onRemove={removeItem}
        onAddProduct={addProductToBotCart}
        onSearch={searchMore}
        onApplyCart={applyCart}
      />
    </>
  );
}

// ─── Modal: lista de compras + productos seleccionables ─────────

function BotCartModal({
  open,
  cart,
  products,
  checkout,
  mutating,
  error,
  readOnlyProductIds,
  onClose,
  onInc,
  onDec,
  onRemove,
  onAddProduct,
  onSearch,
  onApplyCart,
}: {
  open: boolean;
  cart: BotCart | null;
  products: BotProduct[];
  checkout: boolean;
  mutating: boolean;
  error: string | null;
  readOnlyProductIds: Set<number>;
  onClose: () => void;
  onInc: (it: BotCart["items"][number]) => void;
  onDec: (it: BotCart["items"][number]) => void;
  onRemove: (it: BotCart["items"][number]) => void;
  onAddProduct: (p: BotProduct, qty?: number) => void;
  onSearch: (query: string) => Promise<void>;
  onApplyCart: (cart: BotCart) => void;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);

  // Resetear la búsqueda al abrir el modal
  useEffect(() => {
    if (open) {
      setSearchInput("");
      setSearching(false);
    }
  }, [open]);

  if (!open) return null;

  const items = cart?.items ?? [];
  const total = cart?.total ?? 0;

  const runSearch = async () => {
    setSearching(true);
    try {
      await onSearch(searchInput);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-none sm:rounded-2xl w-full h-[100dvh] sm:h-auto sm:max-w-2xl sm:max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 shrink-0">
          <div>
            <h3 className="font-bold text-[#1A1A2E] text-base">Tu carrito de compras 🛒</h3>
            <p className="text-xs text-gray-500">
              Revisa tu lista y elige productos para agregar.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg text-gray-400 hover:text-[#1A1A2E] hover:bg-gray-100 cursor-pointer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Cuerpo: lista de compras + productos */}
        <div className="flex-1 overflow-y-auto p-5 grid md:grid-cols-2 gap-5">
          {/* Lista de compras */}
          <section className="min-w-0">
            <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
              Lista de compras
            </h4>
            {items.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8 border border-dashed border-gray-200 rounded-xl">
                Aún no hay productos.
                <br />
                Elige de los encontrados 👉
              </div>
            ) : (
              <div className="space-y-2.5">
                {items.map((it) => (
                  <div key={it.variant_id} className="flex items-center gap-2.5 bg-[#F7F7F9] rounded-xl p-2">
                    {it.image ? (
                      <img src={it.image} alt="" loading="lazy" className="w-11 h-11 rounded-lg object-cover bg-white shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-lg bg-white shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 line-clamp-1">{it.name}</p>
                      <p className="text-xs font-bold text-[#1A1A2E]">{fmtPrice(it.subtotal)}</p>
                    </div>
                    {readOnlyProductIds.has(it.product_id) ? (
                      <span className="shrink-0 text-[10px] font-semibold text-gray-400">
                        en tu carrito
                      </span>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => onDec(it)}
                          disabled={mutating}
                          aria-label="Quitar uno"
                          className="w-6 h-6 rounded-md bg-white border border-black/10 text-[#1A1A2E] text-sm font-bold leading-none hover:bg-gray-100 disabled:opacity-40 cursor-pointer"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-xs font-bold text-[#1A1A2E]">{it.quantity}</span>
                        <button
                          onClick={() => onInc(it)}
                          disabled={mutating}
                          aria-label="Agregar uno"
                          className="w-6 h-6 rounded-md bg-[#FFF200] text-[#1A1A2E] text-sm font-bold leading-none hover:bg-[#ffe60d] disabled:opacity-40 cursor-pointer"
                        >
                          +
                        </button>
                        <button
                          onClick={() => onRemove(it)}
                          disabled={mutating}
                          aria-label="Eliminar"
                          className="ml-0.5 w-6 h-6 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center cursor-pointer disabled:opacity-40"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
          </section>

          {/* Productos encontrados / seleccionables */}
          <section className="min-w-0">
            <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
              Productos encontrados
            </h4>
            <div className="flex gap-2 mb-3">
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
                placeholder="Buscar más productos…"
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[#F4F4F6] focus:outline-none focus:ring-2 focus:ring-[#FFF200]"
              />
              <button
                onClick={() => void runSearch()}
                disabled={searching || !searchInput.trim()}
                className="px-3 py-2 rounded-xl bg-[#1A1A2E] text-white text-xs font-semibold hover:bg-[#2a2a44] disabled:opacity-40 cursor-pointer"
              >
                {searching ? "…" : "Buscar"}
              </button>
            </div>

            {products.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8 border border-dashed border-gray-200 rounded-xl">
                Busca productos para ver opciones.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {products.map((p) => (
                  <div key={p.product_id} className="bg-[#F7F7F9] rounded-xl p-2 flex flex-col">
                    {p.image ? (
                      <img src={p.image} alt={p.name} loading="lazy" className="w-full h-16 object-cover rounded-lg mb-1.5 bg-white" />
                    ) : (
                      <div className="w-full h-16 rounded-lg mb-1.5 bg-white flex items-center justify-center text-gray-300 text-xs">
                        sin foto
                      </div>
                    )}
                    <p className="text-[11px] leading-tight text-gray-700 line-clamp-2 flex-1">{p.name}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs font-bold text-[#1A1A2E]">{fmtPrice(p.price)}</span>
                      <button
                        onClick={() => onAddProduct(p, 1)}
                        disabled={mutating}
                        className="text-[11px] font-semibold bg-[#FFF200] text-[#1A1A2E] px-2 py-1 rounded-lg hover:bg-[#ffe60d] disabled:opacity-40 cursor-pointer"
                      >
                        + Agregar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Footer: total + acciones */}
        {items.length > 0 && (
          <div className="px-5 py-4 border-t border-black/5 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">
                {cart?.count} {cart?.count === 1 ? "producto" : "productos"}
              </span>
              <span className="text-lg font-bold text-[#1A1A2E]">{fmtPrice(total)}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => cart && onApplyCart(cart)}
                disabled={mutating}
                className="flex-1 text-sm font-bold bg-[#1A1A2E] text-white py-2.5 rounded-xl hover:bg-[#2a2a44] disabled:opacity-50 cursor-pointer"
              >
                {checkout ? "Ir a pagar →" : "Usar este carrito"}
              </button>
              <button
                onClick={onClose}
                disabled={mutating}
                className="px-4 text-sm font-semibold text-gray-500 hover:text-[#1A1A2E] border border-black/10 rounded-xl hover:bg-gray-50 cursor-pointer"
              >
                Seguir comprando
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
