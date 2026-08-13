import {
  ShoppingCart,
  X,
  Minus,
  Plus,
  Trash2,
  Truck,
} from "lucide-react";
import { useEffect, useState } from "react";
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

/** Carousel horizontal de productos relacionados con un ítem del carrito. */
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

  useEffect(() => {
    let cancelled = false;
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

  if (related.length === 0) return null;

  return (
    <div className="mt-3 sm:mt-0">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
        También te puede interesar
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {related.map((p) => (
          <div
            key={p.id}
            className="flex-shrink-0 w-[104px] bg-muted/40 rounded-xl p-1.5"
          >
            <div className="w-full h-14 rounded-lg bg-white overflow-hidden">
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
            <p className="text-[10px] text-foreground line-clamp-1 mt-1 font-medium">
              {p.name}
            </p>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] font-bold">{fmt(p.price)}</span>
              <button
                onClick={() => onAdd(p, 1)}
                aria-label={`Agregar ${p.name}`}
                className="w-5 h-5 rounded-md flex items-center justify-center text-[#1A1A2E] text-xs font-bold cursor-pointer"
                style={{ background: "#FFF200" }}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
      <div className="relative w-full max-w-sm sm:max-w-lg bg-white flex flex-col h-full shadow-2xl">
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

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
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
            cartItems.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-xl border border-border"
              >
                <div className="flex flex-col sm:flex-row gap-3">
                  {/* Producto (a la derecha en desktop, arriba en móvil) */}
                  <div className="flex gap-3 sm:w-1/2 sm:order-2">
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

                  {/* Carousel de relacionados (a la izquierda en desktop, abajo en móvil) */}
                  <div className="sm:w-1/2 sm:order-1">
                    <RelatedCarousel productId={item.id} onAdd={onAdd} fmt={fmt} />
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
    </div>
  );
}
