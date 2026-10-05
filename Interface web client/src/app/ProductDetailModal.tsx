import { useEffect, useState, useRef, useCallback } from "react";
import { CartItem, ProductDetailModalProps, Product } from "./types";
import { Minus, Plus, ShoppingCart, TrendingUp, X } from "lucide-react";
import { catalogService } from "../services/catalog.service";

const SPEC_ORDER = [
  "Presentación",
  "Unidad de medida",
  "Unidades por empaque",
  "Nombre corto",
  "EAN caja (EAN-14)",
  "Referencia fabricante",
  "Registro sanitario INVIMA",
  "CUM",
  "Ubicación bodega",
];

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(n);

function ZoomImage({ src, alt }: { src?: string; alt: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [hover, setHover] = useState(false);

  const handleMouse = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPos({ x, y });
  }, []);

  const imgSrc = src || "";
  return (
    <div
      ref={containerRef}
      className="relative w-full h-full cursor-crosshair"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setHover(true);
      }}
      onPointerLeave={() => setHover(false)}
      onPointerMove={handleMouse}
    >
      <img src={imgSrc} alt={alt} className="w-full h-full object-cover" />
      {hover && imgSrc && (
        <div
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{
            backgroundImage: 'url("' + imgSrc + '")',
            backgroundSize: "250%",
            backgroundPosition: pos.x + "% " + pos.y + "%",
          }}
        />
      )}
    </div>
  );
}

// Las especificaciones y la descripción se construyen en tiempo de render a
// partir de los datos reales del producto (description + attributes + dimensions).

export function ProductDetailModal({
  product,
  cartItems,
  onAdd,
  onRemove,
  onClose,
}: ProductDetailModalProps) {
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
  const [localQty, setLocalQty] = useState(1);
  const [detail, setDetail] = useState<Product | null>(null);
  const inCart = product ? cartItems.find((c) => c.id === product.id) : null;
  const cartQty = inCart?.quantity ?? 0;

  useEffect(() => {
    setLocalQty(1);
  }, [product?.id]);

  useEffect(() => {
    if (!product) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [product]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let mounted = true;

    const loadRelatedProducts = async () => {
      if (!product) return;
      const related = await catalogService.getRelatedProducts(product);
      if (mounted) {
        setRelatedProducts(related.slice(0, 4));
      }
    };

    loadRelatedProducts();

    return () => {
      mounted = false;
    };
  }, [product]);

  useEffect(() => {
    let mounted = true;
    if (!product) {
      setDetail(null);
      return;
    }
    catalogService
      .getProductDetail(product.id)
      .then((d) => {
        if (mounted) setDetail(d);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [product?.id]);

  if (!product) return null;

  const discount = product.originalPrice
    ? Math.round((1 - product.price / product.originalPrice) * 100)
    : null;

  const info = detail ?? product;
  const description =
    (detail?.description || product.description || "").trim() ||
    "Producto seleccionado por Mercaldas para tu hogar.";

  const attrs = [...(detail?.attributes ?? [])].sort((a, b) => {
    const ia = SPEC_ORDER.indexOf(a.name);
    const ib = SPEC_ORDER.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const specs: { label: string; value: string }[] = [];
  const brand = detail?.brandName || detail?.manufacturer || null;
  if (brand) specs.push({ label: "Marca", value: brand });
  if (info.category) specs.push({ label: "Categoría", value: info.category });
  if (detail?.productTypeName)
    specs.push({ label: "Tipo", value: detail.productTypeName });
  for (const a of attrs) specs.push({ label: a.name, value: a.value });
  const dims = detail?.dimensions;
  if (dims && (dims.lengthMm || dims.widthMm || dims.heightMm)) {
    const cm = (n: number | null) =>
      n != null ? String(Math.round((n / 10) * 10) / 10) : "—";
    specs.push({
      label: "Dimensiones (L × A × H)",
      value: `${cm(dims.lengthMm)} × ${cm(dims.widthMm)} × ${cm(dims.heightMm)} cm`,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel - ahora ocupa toda la altura en móvil */}
      <div
        className="relative bg-background w-full sm:max-w-3xl sm:rounded-2xl overflow-hidden shadow-2xl h-full sm:max-h-[92vh] sm:h-auto flex flex-col pb-[var(--safe-bottom)]"
        onClick={(e) => e.stopPropagation()}
        style={{
          animation: "slideUp 0.28s cubic-bezier(0.34,1.56,0.64,1) both",
        }}
      >
        {/* Close button - mejorado para móvil */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-30 w-10 h-10 sm:w-9 sm:h-9 rounded-full bg-white/90 hover:bg-white shadow-lg flex items-center justify-center transition-colors backdrop-blur-sm border border-border/20"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5 sm:w-4.5 sm:h-4.5 text-foreground" />
        </button>

        <div className="overflow-y-auto flex-1">
          {/* Hero image + info */}
          <div className="grid sm:grid-cols-2">
            {/* Image with magnifier - en móvil ocupa menos espacio */}
            <div className="relative bg-muted aspect-square sm:aspect-square max-h-[50vh] sm:max-h-none overflow-hidden">
              <ZoomImage src={product.image} alt={product.name} />
              {product.badge && (
                <span
                  className="absolute top-3 left-3 z-[2] text-xs font-bold px-2.5 py-1 rounded-full text-white"
                  style={{
                    background:
                      product.badge === "Nuevo" ? "var(--secondary)" : "var(--accent)",
                  }}
                >
                  {product.badge}
                </span>
              )}
              {discount && (
                <div
                  className="absolute bottom-3 left-3 z-[2] flex items-center gap-1 text-white text-xs font-bold px-2.5 py-1 rounded-full"
                  style={{ background: "var(--accent)" }}
                >
                  <TrendingUp className="w-3 h-3" />
                  {discount}% OFF
                </div>
              )}
            </div>

            {/* Info - scrollable en móvil */}
            <div className="p-4 sm:p-5 flex flex-col gap-3 overflow-y-auto">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {product.category}
                </p>
                <h2
                  className="text-xl sm:text-2xl font-bold text-foreground leading-tight mt-1"
                  style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
                >
                  {product.name}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {detail?.brandName || detail?.manufacturer || ""}
                </p>
              </div>

              {/* PLU & EAN */}
              {(product.plu || product.barcode || product.externalId) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {product.plu && (
                    <span className="font-mono">PLU: {product.plu}</span>
                  )}
                  {product.barcode && (
                    <span className="font-mono">EAN: {product.barcode}</span>
                  )}
                  {product.externalId && (
                    <span className="font-mono">Ref: {product.externalId}</span>
                  )}
                </div>
              )}

              {/* Pricing */}
              <div className="flex items-baseline gap-2">
                <span
                  className="text-2xl sm:text-3xl font-bold text-foreground"
                  style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
                >
                  {fmt(product.price)}
                </span>
                {product.originalPrice && (
                  <span className="text-sm sm:text-base text-muted-foreground line-through">
                    {fmt(product.originalPrice)}
                  </span>
                )}
              </div>

              {/* Stepper local */}
              <div className="flex items-center gap-3 mt-1">
                <div className="flex items-center border border-border rounded-xl overflow-hidden flex-shrink-0">
                  <button
                    onClick={() => setLocalQty((prev) => Math.max(1, prev - 1))}
                    disabled={localQty <= 1}
                    className="w-10 h-10 flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-25"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-10 text-center font-bold text-base tabular-nums">
                    {localQty}
                  </span>
                  <button
                    onClick={() => setLocalQty((prev) => prev + 1)}
                    className="w-10 h-10 flex items-center justify-center hover:bg-muted transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={() => onAdd(product, localQty)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-all hover:brightness-95 active:scale-[0.98]"
                  style={{ background: "var(--primary)", color: "var(--foreground)" }}
                >
                  <ShoppingCart className="w-4 h-4" />
                  {cartQty === 0
                    ? `Agregar ${localQty}`
                    : `Agregar ${localQty} más`}
                </button>
              </div>

              {cartQty > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  {cartQty} {cartQty === 1 ? "unidad" : "unidades"} en el
                  carrito · subtotal {fmt(product.price * cartQty)}
                </p>
              )}

              {/* Description */}
              <div className="border-t border-border pt-3">
                <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-1.5">
                  Descripción
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {description}
                </p>
              </div>

              {/* Specs */}
              <div className="border-t border-border pt-3">
                <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-2">
                  Especificaciones
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {specs.map((s) => (
                    <div key={s.label}>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-xs font-semibold text-foreground">
                        {s.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Related products */}
          {relatedProducts.length > 0 && (
            <div className="border-t border-border px-4 sm:px-5 py-4">
              <p className="text-sm font-bold text-foreground mb-3">
                Productos relacionados
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {relatedProducts.map((rp) => (
                  <RelatedProductCard
                    key={rp.id}
                    product={rp}
                    cartItems={cartItems}
                    onAdd={onAdd}
                    onRemove={onRemove}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(40px) scale(0.97); } to { opacity:1; transform:translateY(0) scale(1); } }`}</style>
    </div>
  );
}

/* ─── RelatedProductCard ─────────────────────────────────── */
function RelatedProductCard({
  product: rp,
  cartItems,
  onAdd,
  onRemove,
}: {
  product: Product;
  cartItems: CartItem[];
  onAdd: (p: Product, quantity?: number) => void;
  onRemove: (id: number) => void;
}) {
  const [localQty, setLocalQty] = useState(1);
  const rpInCart = cartItems.find((c) => c.id === rp.id);
  const rpCartQty = rpInCart?.quantity ?? 0;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="aspect-square bg-muted">
        <img
          src={rp.image}
          alt={rp.name}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="p-2">
        <p className="text-xs font-semibold line-clamp-2 text-foreground leading-snug">
          {rp.name}
        </p>
        <p
          className="text-xs font-bold mt-1"
          style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
          }}
        >
          {fmt(rp.price)}
        </p>
        <div className="flex items-center border border-border rounded-lg overflow-hidden mt-1.5">
          <button
            onClick={() => setLocalQty((prev) => Math.max(1, prev - 1))}
            disabled={localQty <= 1}
            className="flex-1 flex items-center justify-center py-1 disabled:opacity-25 hover:bg-muted transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-xs font-bold w-6 text-center">{localQty}</span>
          <button
            onClick={() => setLocalQty((prev) => prev + 1)}
            className="flex-1 flex items-center justify-center py-1 hover:bg-muted transition-colors"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        <button
          onClick={() => onAdd(rp, localQty)}
          className="w-full flex items-center justify-center gap-1 py-1 rounded-lg font-semibold text-xs mt-1.5 transition-all hover:brightness-95 active:scale-95"
          style={{ background: "var(--primary)", color: "var(--foreground)" }}
        >
          <ShoppingCart className="w-3 h-3" />
          Agregar {localQty}
        </button>
      </div>
    </div>
  );
}
