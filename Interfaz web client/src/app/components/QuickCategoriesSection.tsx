import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, Search } from "lucide-react";
import { productTypeIcon } from "../productTypeIcons";

interface ProductType {
  id: number;
  code: string;
  name: string;
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
        className="w-12 h-12 rounded-xl flex items-center justify-center text-lg"
        style={{ background: "#F4F4F6", color: "#6B7280" }}
      >
        {productTypeIcon(pt.code, index)}
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Carousel móvil: avanza UN ítem a la vez (pausa al hacer hover).
  // En escritorio (lg+) se muestra una grilla, sin carousel.
  const pausedRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || productTypes.length === 0 || expanded) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    const step = () => {
      if (pausedRef.current || !el) return;
      const item = el.querySelector(
        "[data-carousel-item]",
      ) as HTMLElement | null;
      const gap = 16; // gap-4
      const w = (item?.offsetWidth ?? 120) + gap;
      if (el.scrollLeft >= el.scrollWidth / 2 - w) {
        el.scrollLeft = 0; // loop infinito
      } else {
        el.scrollLeft += w;
      }
    };
    const id = setInterval(step, 2500);
    return () => clearInterval(id);
  }, [productTypes.length, expanded]);

  const scrollBy = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 300, behavior: "smooth" });
  };

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
          className="relative group lg:hidden"
          onMouseEnter={() => (pausedRef.current = true)}
          onMouseLeave={() => (pausedRef.current = false)}
        >
          <button
            onClick={() => scrollBy(-1)}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 z-10 w-8 h-8 rounded-full bg-white shadow-md border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scrollBy(1)}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 z-10 w-8 h-8 rounded-full bg-white shadow-md border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto pb-2"
            style={{ scrollbarWidth: "none" }}
          >
            {/* Duplicados para el loop infinito */}
            {[...productTypes, ...productTypes].map((pt, i) => (
              <ProductTypeButton
                key={`${pt.id}-${i >= productTypes.length ? "b" : "a"}`}
                pt={pt}
                index={i % productTypes.length}
                onClick={() => onProductTypeClick(pt.code)}
              />
            ))}
          </div>
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
