import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Loader2, Package, Check, Plus, X } from "lucide-react";
import { catalogService } from "../services/catalog.service";

export type ProductOption = {
  id: number;
  name: string;
  price?: number;
  image?: string | null;
  category?: string | null;
};

export type AdminCategory = {
  id: number;
  name: string;
  parentId: number | null;
  level?: number;
  productCount?: number;
};

// Productos por página del lazy load.
const PICKER_PAGE_SIZE = 5;

// Buscador de productos con chips de selección múltiple.
// Muestra productos del catálogo de 5 en 5 (lazy load al hacer scroll) y
// permite buscar por nombre. Cada producto se muestra con su imagen.
export function ProductPicker({
  selected,
  onChange,
}: {
  selected: ProductOption[];
  onChange: (next: ProductOption[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const offsetRef = useRef(0);
  const reqIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const mapProduct = (p: any): ProductOption => ({
    id: p.id,
    name: p.name,
    price: Number(p.price ?? 0),
    image: p.image ?? null,
    category: p.category ?? null,
  });

  const loadPage = useCallback(async (q: string, reset: boolean) => {
    const offset = reset ? 0 : offsetRef.current;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const list = await catalogService.getProducts({
        limit: PICKER_PAGE_SIZE,
        offset,
        search: q.trim() || undefined,
      });
      if (reqId !== reqIdRef.current) return; // respuesta obsoleta
      const mapped = list.map(mapProduct);
      setItems((prev) => {
        if (reset) return mapped;
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...mapped.filter((p) => !seen.has(p.id))];
      });
      offsetRef.current = offset + mapped.length;
      setDone(mapped.length < PICKER_PAGE_SIZE);
    } catch {
      if (reqId === reqIdRef.current) setDone(true);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, []);

  // Carga inicial + búsqueda con debounce.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      offsetRef.current = 0;
      void loadPage(query, true);
      return;
    }
    debounceRef.current = setTimeout(() => {
      offsetRef.current = 0;
      setDone(false);
      void loadPage(query, true);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, loadPage]);

  // Lazy load: cargar la siguiente página al llegar al final de la lista.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading && !done) {
          void loadPage(query, false);
        }
      },
      { root: el.parentElement, rootMargin: "48px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, done, query, loadPage]);

  const selectedIds = new Set(selected.map((p) => p.id));
  const add = (p: ProductOption) => {
    if (selectedIds.has(p.id)) return;
    onChange([...selected, p]);
  };
  const remove = (id: number) => onChange(selected.filter((p) => p.id !== id));

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 text-[11px] bg-gray-100 border border-gray-200 rounded-lg max-w-full"
            >
              {p.image && (
                <img src={p.image} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
              )}
              <span className="truncate max-w-[160px]">{p.name}</span>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="text-gray-400 hover:text-red-500 shrink-0"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar productos por nombre…"
          className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
        />
        {loading && (
          <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
        )}
      </div>

      <div className="max-h-52 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
        {items.length === 0 && !loading ? (
          <p className="px-3 py-4 text-xs text-gray-400 text-center">Sin resultados</p>
        ) : (
          items.map((p) => {
            const already = selectedIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                disabled={already}
                onClick={() => add(p)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-left text-xs transition-colors ${
                  already ? "opacity-40" : "hover:bg-amber-50"
                }`}
              >
                {p.image ? (
                  <img src={p.image} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 bg-gray-100" loading="lazy" />
                ) : (
                  <span className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Package size={14} className="text-gray-400" />
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{p.name}</span>
                  {p.category && (
                    <span className="block truncate text-[10px] text-gray-400">{p.category}</span>
                  )}
                </span>
                {already ? (
                  <Check size={13} className="text-green-500 shrink-0" />
                ) : (
                  <Plus size={13} className="text-amber-500 shrink-0" />
                )}
              </button>
            );
          })
        )}
        <div ref={sentinelRef} className="h-8 flex items-center justify-center">
          {loading && items.length > 0 && (
            <Loader2 size={13} className="animate-spin text-gray-400" />
          )}
          {!loading && done && items.length > 0 && (
            <span className="text-[10px] text-gray-300">Fin de la lista</span>
          )}
        </div>
      </div>
    </div>
  );
}

// Selector de categorías (con jerarquía y búsqueda).
export function CategoryPicker({
  categories,
  selected,
  onChange,
}: {
  categories: AdminCategory[];
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = categories.filter((c) => !q || c.name.toLowerCase().includes(q));
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar categorías…"
          className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
        />
      </div>
      <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-400 text-center">Sin categorías</p>
        ) : (
          visible.map((c) => {
            const checked = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs transition-colors ${
                  checked ? "bg-amber-50" : "hover:bg-gray-50"
                }`}
                style={{ paddingLeft: 10 + (c.level ?? 0) * 14 }}
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    checked ? "bg-amber-500 border-amber-500" : "border-gray-300"
                  }`}
                >
                  {checked && <Check size={11} className="text-white" />}
                </span>
                <span className="flex-1 min-w-0 truncate">{c.name}</span>
                {typeof c.productCount === "number" && (
                  <span className="text-[10px] text-gray-400 shrink-0">{c.productCount}</span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// Categorías del admin (con nivel para la indentación jerárquica).
export function useAdminCategories(): AdminCategory[] {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  useEffect(() => {
    catalogService
      .getCategoriesAdmin()
      .then((list) =>
        setCategories(
          list.map((c) => ({
            id: c.id,
            name: c.name,
            parentId: c.parentId,
            level: (c as { level?: number }).level ?? 0,
            productCount: c.productCount,
          })),
        ),
      )
      .catch(() => {});
  }, []);
  return categories;
}

// Mantiene los nombres de los productos seleccionados a partir de sus ids
// (el filtro solo guarda los ids). Fusiona si el usuario ya agregó alguno.
export function useProductOptions(initialIds: number[]): {
  products: ProductOption[];
  setProducts: (next: ProductOption[]) => void;
} {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const idsKey = initialIds.join(",");
  useEffect(() => {
    if (!initialIds.length) return;
    catalogService
      .getProducts({ productIds: initialIds, limit: 100 } as any)
      .then((list) =>
        setProducts((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          const hydrated = list
            .map((p) => ({ id: p.id, name: p.name, price: p.price, image: p.image }))
            .filter((p) => !seen.has(p.id));
          return [...prev, ...hydrated];
        }),
      )
      .catch(() => {});
    // Solo al montar (o si cambian los ids iniciales).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  return { products, setProducts };
}
