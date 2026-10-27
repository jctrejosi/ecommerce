import {
  ShoppingCart,
  X,
  Minus,
  Plus,
  Trash2,
  Truck,
  RefreshCw,
} from "lucide-react";
import { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import { catalogService } from "../../services/catalog.service";
import type { CartItem, Product } from "../types";

interface CartDrawerProps {
  cartOpen: boolean;
  cartItems: CartItem[];
  cartCount: number;
  cartTotal: number;
  /** Descuento por promociones vigentes (cotización del backend). */
  discountTotal?: number;
  promotions?: { id: number; name: string; amount: number }[];
  onClose: () => void;
  onAdd: (product: Product, quantity?: number) => void;
  onRemove: (id: number) => void;
  onDelete: (id: number) => void;
  onCheckout: () => void;
  fmt: (n: number) => string;
}

// Ancho del panel flotante de recomendaciones y separación con el carrito.
const REC_W = 264;
const GAP = 16;

/** Recomendación relacionada con un ítem: UN producto que rota con fade. */
function RelatedCarousel({
  productId,
  quantity,
  onAdd,
  onSwap,
  fmt,
}: {
  productId: number;
  quantity: number;
  onAdd: (product: Product, quantity?: number) => void;
  onSwap: (recommended: Product, cartItemId: number, quantity: number) => void;
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
      className="bg-white border border-border rounded-xl shadow-sm h-full flex items-center gap-1.5 p-1.5 overflow-hidden"
      style={{ opacity: leaving ? 0 : 1, transition: "opacity 0.65s ease" }}
    >
      <div className="w-10 h-10 rounded-lg bg-muted overflow-hidden shrink-0 self-center">
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
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-foreground line-clamp-2 font-medium leading-tight">
          {p.name}
        </p>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-[11px] font-bold">{fmt(p.price)}</span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => onAdd(p, 1)}
              aria-label={`Agregar ${p.name}`}
              className="w-5 h-5 rounded-md flex items-center justify-center text-foreground text-[11px] font-bold cursor-pointer shrink-0"
              style={{ background: "var(--primary)" }}
            >
              +
            </button>
            <button
              onClick={() => onSwap(p, productId, quantity)}
              aria-label="Intercambiar por este producto"
              title="Intercambiar"
              className="h-5 px-1 rounded-md flex items-center gap-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0 text-[9px] font-semibold"
            >
              <RefreshCw className="w-3 h-3" />
              <span className="hidden sm:inline">intercambiar</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CartDrawer({
  cartOpen,
  cartItems,
  cartCount,
  cartTotal,
  discountTotal = 0,
  promotions = [],
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
  const [rec, setRec] = useState<{
    top: number;
    left: number;
    height: number;
    items: Record<number, { top: number; height: number }>;
  } | null>(null);

  // Mide el panel del carrito y la posición/alto de cada ítem para alinear
  // las recomendaciones exactamente al lado de su producto. En móvil (sin
  // espacio horizontal) no se flota y se muestra inline.
  const measure = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    const left = panelRect.left - REC_W - GAP;
    if (left < 8) {
      setRec(null);
      return;
    }

    // El panel termina donde termina el scroll de los ítems (antes del subtotal).
    const list = listRef.current;
    const height = list
      ? list.getBoundingClientRect().bottom - panelRect.top
      : panelRect.height;

    const items: Record<number, { top: number; height: number }> = {};
    itemRefs.current.forEach((node, id) => {
      const r = node.getBoundingClientRect();
      items[id] = { top: r.top - panelRect.top, height: r.height };
    });

    setRec({ top: panelRect.top, left, height, items });
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
  }, [cartOpen, measure, cartItems]);

  // Intercambia un ítem del carrito por el producto recomendado (misma cantidad).
  const swapItem = useCallback(
    (recommended: Product, cartItemId: number, quantity: number) => {
      onDelete(cartItemId);
      onAdd(recommended, quantity);
    },
    [onDelete, onAdd],
  );

  if (!cartOpen) return null;

  const floatingRec = rec !== null;

  return (
    <div className="fixed inset-0 z-[95] flex justify-end">
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
        className="relative w-full max-w-sm sm:max-w-lg bg-white flex flex-col h-full shadow-2xl pb-[var(--safe-bottom)]"
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
                style={{ background: "var(--primary)", color: "var(--foreground)" }}
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
                style={{ background: "var(--primary)", color: "var(--foreground)" }}
              >
                Seguir comprando
              </button>
            </div>
          ) : (
            cartItems.map((item) => (
              <div key={item.id}>
                {/* Fallback móvil: recomendación inline debajo del producto */}
                {!floatingRec && (
                  <div className="mb-2">
                    <RelatedCarousel
                      productId={item.id}
                      quantity={item.quantity}
                      onAdd={onAdd}
                      onSwap={swapItem}
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
            ))
          )}
        </div>

        {cartItems.length > 0 && (
          <div className="border-t border-border px-5 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Subtotal ({cartCount} productos)
              </span>
              <span
                className={
                  discountTotal > 0
                    ? "font-semibold"
                    : "font-bold text-xl"
                }
              >
                {fmt(cartTotal)}
              </span>
            </div>
            {discountTotal > 0 && (
              <>
                <div className="flex items-center justify-between text-sm text-green-600">
                  <span>
                    Descuento
                    {promotions.length > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {" "}
                        ({promotions.map((p) => p.name).join(", ")})
                      </span>
                    )}
                  </span>
                  <span className="font-semibold">-{fmt(discountTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold">Total</span>
                  <span className="font-bold text-xl">
                    {fmt(Math.max(0, cartTotal - discountTotal))}
                  </span>
                </div>
              </>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
              <Truck className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Domicilio calculado al finalizar el pedido</span>
            </div>
            <button
              onClick={onCheckout}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all hover:brightness-95 active:scale-95"
              style={{ background: "var(--secondary)", color: "var(--primary)" }}
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

      {/* Panel flotante "Recomendaciones" (fuera del carrito, a su izquierda) */}
      {floatingRec && rec && cartItems.length > 0 && (
        <div
          className="fixed z-[60]"
          style={{ top: rec.top, left: rec.left, height: rec.height }}
        >
          <div
            className="relative bg-white border border-border rounded-2xl shadow-2xl overflow-hidden"
            style={{ width: REC_W, height: "100%" }}
          >
            {/* Título alineado con "Mi Carrito" */}
            <div className="absolute top-0 left-0 right-0 z-10 px-5 py-4 border-b border-border bg-white">
              <h2
                className="font-black text-lg whitespace-nowrap"
                style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
              >
                Recomendaciones
              </h2>
            </div>

            {/* Cada recomendación alineada con su producto del carrito */}
            {cartItems.map((item) => {
              const pos = rec.items[item.id];
              if (!pos) return null;
              return (
                <div
                  key={item.id}
                  className="absolute left-0 right-0 px-3"
                  style={{ top: pos.top, height: pos.height }}
                >
                  <RelatedCarousel
                    productId={item.id}
                    quantity={item.quantity}
                    onAdd={onAdd}
                    onSwap={swapItem}
                    fmt={fmt}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
