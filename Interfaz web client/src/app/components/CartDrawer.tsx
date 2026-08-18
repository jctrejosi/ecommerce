import {
  ShoppingCart,
  X,
  Minus,
  Plus,
  Trash2,
  Truck,
  ChevronRight,
} from "lucide-react";
import { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import { catalogService } from "../../services/catalog.service";
import type { CartItem, Product } from "../types";

interface CartDrawerProps {
  cartOpen: boolean;
  cartItems: CartItem[];
  cartCount: number;
  cartTotal: number;
  onClose: () => void;
  onAdd: (product: Product, quantity?: number) => void;
  onRemove: (id: number) => void;
  onDelete: (id: number) => void;
  onCheckout: () => void;
  fmt: (n: number) => string;
}

/** Recomendación relacionada con un ítem: UN producto que rota con fade. */
function RelatedCarousel({
  productId,
  onAdd,
  fmt,
}: {
  productId: number;
  onAdd: (product: Product, quantity?: number) => void;
  fmt: (n: number) => string;
}) {
  const [related, setRelated] = useState<Product[]>([]);
  const [current, setCurrent] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const changingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setCurrent(0);
    setLeaving(false);
    catalogService
      .getRelatedProductsById(productId)
      .then((p) => {
        if (!cancelled) setRelated(p.slice(0, 8));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const next = useCallback(() => {
    if (related.length <= 1 || changingRef.current) return;
    changingRef.current = true;
    setLeaving(true);
    // Fade-out lento (0.65s) y luego cambia al siguiente con fade-in
    setTimeout(() => {
      setCurrent((c) => (c + 1) % related.length);
      setLeaving(false);
      changingRef.current = false;
    }, 650);
  }, [related.length]);

  // Auto-avance: cambia de recomendación cada 30s
  useEffect(() => {
    if (related.length <= 1) return;
    const id = setInterval(next, 30000);
    return () => clearInterval(id);
  }, [next, related.length]);

  if (related.length === 0) return null;
  const p = related[current];

  return (
    <div
      className="mt-2 sm:mt-0 sm:-translate-x-2"
      style={{ opacity: leaving ? 0 : 1, transition: "opacity 0.65s ease" }}
    >
      <div className="bg-white border border-border rounded-xl shadow-lg p-2.5 flex flex-col gap-1.5">
        <div className="w-full h-20 rounded-lg bg-muted overflow-hidden">
          {p.image ? (
            <img
              src={p.image}
              alt={p.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300 text-[10px]">
              sin foto
            </div>
          )}
        </div>
        <p className="text-[11px] text-foreground line-clamp-2 mt-1.5 font-medium">
          {p.name}
        </p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs font-bold">{fmt(p.price)}</span>
          <button
            onClick={() => onAdd(p, 1)}
            aria-label={`Agregar ${p.name}`}
            className="w-6 h-6 rounded-md flex items-center justify-center text-[#1A1A2E] text-xs font-bold cursor-pointer"
            style={{ background: "#FFF200" }}
          >
            +
          </button>
        </div>
        {related.length > 1 && (
          <button
            onClick={next}
            className="self-start text-[10px] font-semibold text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors cursor-pointer"
          >
            Cambiar
          </button>
        )}
      </div>
    </div>
  );
}

// Dimensiones de la tarjeta flotante de recomendación (para medir espacio).
const CARD_W = 152;
const CARD_H = 190;
const GAP = 14;

export function CartDrawer({
  cartOpen,
  cartItems,
  cartCount,
  cartTotal,
  onClose,
  onAdd,
  onRemove,
  onDelete,
  onCheckout,
  fmt,
}: CartDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [floats, setFloats] = useState<
    Record<number, { top: number; left: number }>
  >({});

  // Mide dónde va cada tarjeta flotante: alineada con su ítem, justo a la
  // izquierda del panel (fuera de "Mi Carrito"). Se descartan las que se
  // solaparían entre sí o no tengan espacio (→ se muestran inline).
  const measure = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const panelLeft = panel.getBoundingClientRect().left;
    const next: Record<number, { top: number; left: number }> = {};
    let prevCenter: number | null = null;
    itemRefs.current.forEach((node, id) => {
      const r = node.getBoundingClientRect();
      const center = r.top + r.height / 2;
      if (prevCenter !== null && center - prevCenter < CARD_H + 8) return;
      const left = panelLeft - CARD_W - GAP;
      if (left < 8) return;
      next[id] = { top: center, left };
      prevCenter = center;
    });
    setFloats(next);
  }, []);

  useLayoutEffect(() => {
    if (!cartOpen) return;
    measure();
    const list = listRef.current;
    list?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      list?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [cartOpen, measure, cartItems.length]);

  if (!cartOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0"
        style={{
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(2px)",
        }}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="relative w-full max-w-sm sm:max-w-lg bg-white flex flex-col h-full shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            <h2
              className="font-black text-lg"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
            >
              Mi Carrito
            </h2>
            {cartCount > 0 && (
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: "#FFF200", color: "#1A1A2E" }}
              >
                {cartCount}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        >
          {cartItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                <ShoppingCart className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="font-semibold text-foreground">
                Tu carrito está vacío
              </p>
              <p className="text-sm text-muted-foreground">
                Agrega productos desde el catálogo.
              </p>
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-95"
                style={{ background: "#FFF200", color: "#1A1A2E" }}
              >
                Seguir comprando
              </button>
            </div>
          ) : (
            cartItems.map((item) => {
              const floating = floats[item.id];
              return (
                <div key={item.id}>
                  {/* Recomendación inline (móvil / sin espacio para flotar) */}
                  {!floating && (
                    <div className="mb-2">
                      <RelatedCarousel
                        productId={item.id}
                        onAdd={onAdd}
                        fmt={fmt}
                      />
                    </div>
                  )}

                  {/* Producto del carrito */}
                  <div
                    ref={(el) => {
                      if (el) itemRefs.current.set(item.id, el);
                      else itemRefs.current.delete(item.id);
                    }}
                    className="p-3 rounded-xl border border-border"
                  >
                    <div className="flex items-center gap-3">
                      {/* Flecha que conecta la recomendación flotante con el producto */}
                      {floating && (
                        <ChevronRight className="w-5 h-5 text-muted-foreground/70 shrink-0" />
                      )}
                      <div className="flex gap-3 flex-1 min-w-0">
                        <div className="w-14 h-14 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                          <img
                            src={item.image}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground leading-snug line-clamp-2">
                            {item.name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {item.unit}
                          </p>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-sm font-bold">
                              {fmt(item.price * item.quantity)}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => onRemove(item.id)}
                                className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center hover:bg-border transition-colors"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="text-xs font-bold w-5 text-center">
                                {item.quantity}
                              </span>
                              <button
                                onClick={() => onAdd(item)}
                                className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center hover:bg-border transition-colors"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => onDelete(item.id)}
                                className="w-6 h-6 rounded-lg ml-1 flex items-center justify-center hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-3 h-3 text-accent" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {cartItems.length > 0 && (
          <div className="border-t border-border px-5 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Subtotal ({cartCount} productos)
              </span>
              <span className="font-bold text-xl">{fmt(cartTotal)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
              <Truck className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Domicilio calculado al finalizar el pedido</span>
            </div>
            <button
              onClick={onCheckout}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all hover:brightness-95 active:scale-95"
              style={{ background: "#1A1A2E", color: "#FFF200" }}
            >
              Finalizar pedido →
            </button>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-xl font-semibold text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Seguir comprando
            </button>
          </div>
        )}
      </div>

      {/* Recomendaciones flotantes: fuera del panel, al lado izquierdo de cada producto */}
      {cartItems.map((item) => {
        const f = floats[item.id];
        if (!f) return null;
        return (
          <div
            key={`rec-${item.id}`}
            className="fixed z-[60] pointer-events-none"
            style={{ top: f.top, left: f.left, transform: "translateY(-50%)" }}
          >
            <div className="pointer-events-auto" style={{ width: CARD_W }}>
              <RelatedCarousel productId={item.id} onAdd={onAdd} fmt={fmt} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
