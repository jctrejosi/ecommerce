import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, Search } from "lucide-react";
import { productTypeIcon } from "../productTypeIcons";

interface ProductType {
  id: number;
  code: string;
  name: string;
  imagePath: string | null;
  count: number;
}

interface QuickCategoriesSectionProps {
  productTypes?: ProductType[];
  onProductTypeClick: (code: string) => void;
  onViewAll: () => void;
  loading?: boolean;
}

function ProductTypeButton({
  pt,
  index,
  onClick,
  variant = "carousel",
}: {
  pt: ProductType;
  index: number;
  onClick: () => void;
  variant?: "carousel" | "grid";
}) {
  return (
    <button
      data-carousel-item
      onClick={onClick}
      className={`flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-muted transition-colors cursor-pointer ${
        variant === "grid" ? "w-full" : "flex-shrink-0 min-w-[90px]"
      }`}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-4xl overflow-hidden"
        style={{ background: "#F4F4F6", color: "#6B7280" }}
      >
        {pt.imagePath ? (
          <img
            src={pt.imagePath}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          productTypeIcon(pt.code, index, pt.name)
        )}
      </div>
      <span className="text-xs font-semibold text-center text-foreground leading-tight max-w-[90px]">
        {pt.name}
      </span>
      <span className="text-[10px] text-muted-foreground">
        {pt.count} productos
      </span>
    </button>
  );
}

export function QuickCategoriesSection({
  productTypes = [],
  onProductTypeClick,
  onViewAll,
}: QuickCategoriesSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [hasOverflow, setHasOverflow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const GAP = 16; // gap-4 entre ítems

  // Ancho de una "copia" completa de la lista = distancia entre un ítem y su
  // duplicado. Ese periodo es el que se resta/suma para el loop continuo sin
  // que se note el salto (el contenido duplicado es idéntico).
  const measureSetWidth = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return 0;
    const items = el.querySelectorAll<HTMLElement>("[data-carousel-item]");
    const n = productTypes.length;
    if (n > 0 && items.length >= n * 2) {
      return items[n].offsetLeft - items[0].offsetLeft;
    }
    return 0;
  }, [productTypes.length]);

  // Desvanecido por posición: los ítems plenamente visibles quedan opacos y
  // los que entran/salen (recortados por el borde) se van transparentando.
  const applyEdgeFade = useCallback(() => {
    rafRef.current = null;
    const el = scrollRef.current;
    if (!el) return;
    const cont = el.getBoundingClientRect();
    el.querySelectorAll<HTMLElement>("[data-carousel-item]").forEach((item) => {
      const r = item.getBoundingClientRect();
      const visible = Math.min(r.right, cont.right) - Math.max(r.left, cont.left);
      const fraction =
        r.width > 0 ? Math.max(0, Math.min(1, visible / r.width)) : 1;
      item.style.opacity = String(0.15 + 0.85 * fraction);
    });
  }, []);

  const scheduleEdgeFade = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(applyEdgeFade);
  }, [applyEdgeFade]);

  // Avanza exactamente un ítem con scroll suave y mantiene el loop continuo.
  const step = useCallback(
    (dir: 1 | -1) => {
      const el = scrollRef.current;
      if (!el) return;
      const first = el.querySelector<HTMLElement>("[data-carousel-item]");
      const pitch = (first?.offsetWidth ?? 120) + GAP;
      const overflow = el.scrollWidth - el.clientWidth > 8;
      const setWidth = measureSetWidth();
      // Solo hace wrap si hay una copia completa de margen (evita saltos
      // raros cuando la lista es tan corta que casi no desborda).
      if (overflow && setWidth >= el.clientWidth + GAP) {
        // Salto del periodo (invisible, el contenido es idéntico).
        if (dir === 1 && el.scrollLeft >= setWidth) {
          el.scrollLeft -= setWidth;
        } else if (dir === -1 && el.scrollLeft <= 1) {
          el.scrollLeft += setWidth;
        }
      }
      el.scrollBy({ left: dir * pitch, behavior: "smooth" });
    },
    [measureSetWidth],
  );

  // Detecta si hay desbordamiento (para mostrar las flechas) y aplica el fade
  // inicial, también al redimensionar.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setHasOverflow(el.scrollWidth - el.clientWidth > 8);
      scheduleEdgeFade();
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [productTypes.length, scheduleEdgeFade]);

  // Auto-avance: un ítem a la vez. Se pausa al hacer hover/tocar.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || productTypes.length === 0 || expanded) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    const id = setInterval(() => {
      if (!pausedRef.current) step(1);
    }, 2500);
    return () => clearInterval(id);
  }, [productTypes.length, expanded, step]);

  if (productTypes.length === 0) {
    return (
      <section className="py-8 bg-white border-b border-border">
          <div className="max-w-7xl mx-auto px-4">
            <p className="text-sm text-muted-foreground">Cargando tipos de producto...</p>
          </div>
        </section>
      );
    }

    return (
      <>
      <section className="py-8 bg-white border-b border-border">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-5">
          <h2
            className="font-black text-lg text-foreground"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            Nuestros productos
          </h2>
          <button
            onClick={() => setExpanded(true)}
            className="text-xs font-medium text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
          >
            Ver todos <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Móvil / tablet / escritorio pequeño: carousel que avanza de uno en uno */}
        <div
          className="group lg:hidden flex items-center gap-1"
          onMouseEnter={() => (pausedRef.current = true)}
          onMouseLeave={() => (pausedRef.current = false)}
          onTouchStart={() => (pausedRef.current = true)}
          onTouchEnd={() => (pausedRef.current = false)}
        >
          {hasOverflow && (
            <button
              onClick={() => step(-1)}
              aria-label="Anterior"
              className="shrink-0 w-8 h-8 rounded-full bg-white shadow-md border border-border flex items-center justify-center hover:bg-muted transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <div
            ref={scrollRef}
            onScroll={scheduleEdgeFade}
            className="flex-1 min-w-0 flex gap-4 overflow-x-auto pb-2"
            style={{ scrollbarWidth: "none" }}
          >
            {/* Duplicados para el loop continuo */}
            {[...productTypes, ...productTypes].map((pt, i) => (
              <ProductTypeButton
                key={`${pt.id}-${i >= productTypes.length ? "b" : "a"}`}
                pt={pt}
                index={i % productTypes.length}
                onClick={() => onProductTypeClick(pt.code)}
              />
            ))}
          </div>
          {hasOverflow && (
            <button
              onClick={() => step(1)}
              aria-label="Siguiente"
              className="shrink-0 w-8 h-8 rounded-full bg-white shadow-md border border-border flex items-center justify-center hover:bg-muted transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Escritorio: filas sin carousel */}
        <div className="hidden lg:grid lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {productTypes.map((pt, i) => (
            <ProductTypeButton
              key={pt.id}
              pt={pt}
              index={i}
              variant="grid"
              onClick={() => onProductTypeClick(pt.code)}
            />
          ))}
        </div>
      </div>
    </section>


      {/* Modal */}
      {expanded && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center w-dvw">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setExpanded(false); setSearchQuery(""); }} />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[70vh] flex flex-col mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 p-6 pb-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg text-foreground">Todos los tipos de producto</h3>
                <button onClick={() => { setExpanded(false); setSearchQuery(""); }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar tipo de producto..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-300 bg-muted/50"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {productTypes
                  .filter((pt) => pt.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((pt, i) => (
                  <ProductTypeButton
                    key={pt.id}
                    pt={pt}
                    index={i}
                    variant="grid"
                    onClick={() => { onProductTypeClick(pt.code); setExpanded(false); setSearchQuery(""); }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
