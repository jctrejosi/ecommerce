import { useEffect, useState, useCallback, useRef } from "react";
import {
  Search,
  X,
  ChevronRight,
  ChevronDown,
  Check,
  ArrowUpDown,
} from "lucide-react";
import { useCatalog } from "../../../hooks/useCatalog";
import { catalogService } from "../../../services/catalog.service";
import { productTypeIcon } from "../../productTypeIcons";
import { categoryIcon } from "../../categoryIcons";
import { InfiniteScrollTrigger } from "./InfiniteScrollTrigger";
import { ProductCard } from "./ProductCard";
import { SkeletonCard } from "./SkeletonCard";
import type {
  Brand,
  Branch,
  CatalogCategory,
  CatalogPageProps,
  Product,
} from "../../types";

const PRICE_RANGES = [
  { id: "all", label: "Todos los precios" },
  { id: "0-10000", label: "Hasta $10.000" },
  { id: "10000-30000", label: "$10.000 – $30.000" },
  { id: "30000-70000", label: "$30.000 – $70.000" },
  { id: "70000+", label: "Más de $70.000" },
];

const SORT_OPTIONS = [
  { id: "relevancia", label: "Relevancia" },
  { id: "precio-asc", label: "Precio: menor a mayor" },
  { id: "precio-desc", label: "Precio: mayor a menor" },
  { id: "descuento", label: "Mayor descuento" },
  { id: "nombre", label: "Nombre A–Z" },
];

const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_CATEGORIES: CatalogCategory[] = [];

type FlyoutAnchor = { top: number; left: number; right: number };

const FLYOUT_WIDTH = 240;
const FLYOUT_GAP = 6;

/** Posición del panel flotante; si no cabe a la derecha, se abre a la izquierda. */
function flyoutPosition(anchor: FlyoutAnchor, openToRight: boolean) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = openToRight
    ? anchor.right + FLYOUT_GAP
    : anchor.left - FLYOUT_WIDTH - FLYOUT_GAP;

  if (openToRight && left + FLYOUT_WIDTH > viewportWidth - 8) {
    left = anchor.left - FLYOUT_WIDTH - FLYOUT_GAP;
  }
  left = Math.max(8, left);

  const top = Math.max(8, Math.min(anchor.top, viewportHeight - 160));

  return {
    top,
    left,
    // El panel nunca se sale por abajo ni por la derecha.
    maxHeight: Math.max(
      160,
      Math.min(Math.round(viewportHeight * 0.7), viewportHeight - top - 8),
    ),
    maxWidth: Math.max(FLYOUT_WIDTH, viewportWidth - left - 8),
  };
}

interface CategoryFlyoutProps {
  nodes: CatalogCategory[];
  anchor: FlyoutAnchor;
  openToRight: boolean;
  selectedIds: number[];
  childrenOf: (categoryId: number) => CatalogCategory[];
  onToggle: (categoryId: number) => void;
  onEnter: () => void;
  onLeave: () => void;
}

/**
 * Menú de categorías en columnas contiguas, con el mismo estilado del
 * mega-menú "Nuestros productos" del header: 240px por columna, filas planas
 * con `hover:bg-muted`, icono de 24px y borde izquierdo entre columnas.
 * Cada nivel se abre solo al pasar sobre su categoría padre.
 */
function CategoryFlyout({
  nodes,
  anchor,
  openToRight,
  selectedIds,
  childrenOf,
  onToggle,
  onEnter,
  onLeave,
}: CategoryFlyoutProps) {
  // Cadena de categorías sobre las que está el puntero: cada nivel abre una
  // columna a la derecha, igual que el mega-menú "Nuestros productos".
  const [path, setPath] = useState<number[]>([]);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setPath([]), 100);
  };

  // Columna 0 = hijos de la categoría raíz; cada id del path añade una columna.
  const columns: CatalogCategory[][] = [nodes];
  for (const id of path) {
    const current = columns[columns.length - 1];
    const node = current.find((item) => item.id === id);
    if (!node) break;
    const kids = childrenOf(node.id);
    if (kids.length === 0) break;
    columns.push(kids);
  }

  const { top, left, maxHeight, maxWidth } = flyoutPosition(
    anchor,
    openToRight,
  );

  return (
    <div
      className="fixed z-40 flex overflow-x-auto overflow-y-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
      style={{ top, left, maxHeight, maxWidth }}
      onMouseEnter={() => {
        cancelClose();
        onEnter();
      }}
      onMouseLeave={() => {
        scheduleClose();
        onLeave();
      }}
    >
      {columns.map((column, columnIndex) => {
        const activeId = path[columnIndex] ?? null;

        return (
          <div
            key={columnIndex}
            className={`shrink-0 overflow-y-auto overflow-x-hidden ${
              columnIndex > 0 ? "border-l border-border" : ""
            }`}
            style={{ maxHeight }}
            onMouseEnter={() => {
              cancelClose();
              onEnter();
            }}
          >
            <div className="w-[240px] py-2">
              {column.map((node) => {
                const kids = childrenOf(node.id);
                const hasKids = kids.length > 0;
                const checked = selectedIds.includes(node.id);
                const isActive = activeId === node.id;
                const icon = categoryIcon(node.slug, node.name);

                return (
                  <div
                    key={node.id}
                    className={`flex min-h-[32px] items-center transition-colors ${
                      checked
                        ? "filter-selected"
                        : isActive
                          ? "bg-muted"
                          : "hover:bg-muted"
                    }`}
                    onMouseEnter={() => {
                      cancelClose();
                      onEnter();
                      setPath(
                        hasKids
                          ? [...path.slice(0, columnIndex), node.id]
                          : path.slice(0, columnIndex),
                      );
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onToggle(node.id)}
                      title={node.name}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left"
                    >
                      <div
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-[13px] leading-none"
                        style={{
                          background: node.bg || "var(--muted)",
                          color: node.color || "var(--muted-foreground)",
                        }}
                      >
                        {icon}
                      </div>
                      <span
                        className={`min-w-0 flex-1 whitespace-normal text-xs font-medium uppercase tracking-wide ${
                          checked ? "" : "text-foreground"
                        }`}
                      >
                        {node.name}
                      </span>
                      {checked && (
                        <Check className="h-3.5 w-3.5 flex-shrink-0" />
                      )}
                    </button>
                    {hasKids && (
                      <button
                        type="button"
                        aria-label={
                          isActive
                            ? `Contraer ${node.name}`
                            : `Ver subcategorías de ${node.name}`
                        }
                        aria-expanded={isActive}
                        onClick={() =>
                          setPath(
                            isActive
                              ? path.slice(0, columnIndex)
                              : [...path.slice(0, columnIndex), node.id],
                          )
                        }
                        className={`mr-1 flex-shrink-0 rounded p-1 transition-colors ${
                          checked
                            ? "opacity-80 hover:opacity-100"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <ChevronRight
                          className={`h-3 w-3 transition-transform ${
                            isActive ? "rotate-90" : "rotate-0"
                          }`}
                        />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Productos por página del scroll infinito.
const PAGE_SIZE = 20;

/**
 * Expande una selección de categorías a sí misma + todos sus descendientes.
 * El padre no tiene productos propios, así que sin esto el filtro por una
 * categoría superior no devuelve nada.
 */
function expandCategoryIds(
  categories: CatalogCategory[],
  ids: number[],
): number[] {
  if (ids.length === 0) return ids;
  const childrenByParent = new Map<number, number[]>();
  for (const category of categories) {
    const parentId = category.parentId ?? null;
    if (parentId === null) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(category.id);
    childrenByParent.set(parentId, children);
  }
  const expanded = new Set<number>();
  const stack = [...ids];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (expanded.has(current)) continue;
    expanded.add(current);
    for (const child of childrenByParent.get(current) ?? []) stack.push(child);
  }
  return Array.from(expanded);
}

export function CatalogPage({
  cartItems,
  onAdd,
  onRemove,
  onBack,
  onProductClick,
  catalogCategory,
  setCatalogCategory,
  catalogProductIds,
  setCatalogProductIds,
  catalogOnSale,
  setCatalogOnSale,
  catalogPriceRange,
  setCatalogPriceRange,
  catalogSort,
  setCatalogSort,
  catalogSearch,
  setCatalogSearch,
  catalogBrand,
  setCatalogBrand,
  catalogBranch,
  setCatalogBranch,
  mobileFiltersOpen,
  setMobileFiltersOpen,
  catalogProductType,
  setCatalogProductType,
  catalogCategories,
}: CatalogPageProps) {
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Refs sincrónicos: evitan que varios disparos del observer avancen el offset
  // dos veces (lo que saltaría una página completa).
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const [searchInput, setSearchInput] = useState(catalogSearch);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [productTypes, setProductTypes] = useState<
    { id: number; code: string; name: string; imagePath: string | null; count: number }[]
  >([]);
  const [brandSearch, setBrandSearch] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement | null>(null);

  // Cierra el dropdown de orden al hacer click fuera.
  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [sortOpen]);

  // ── Animación del drawer de filtros móvil (entrada/salida suave) ──
  // `mounted` mantiene el drawer en el DOM durante la animación de salida,
  // `active` dispara la transición (slide + fade del fondo).
  const [filtersMounted, setFiltersMounted] = useState(false);
  const [filtersActive, setFiltersActive] = useState(false);

  useEffect(() => {
    if (mobileFiltersOpen) {
      setFiltersMounted(true);
      const raf = requestAnimationFrame(() => setFiltersActive(true));
      return () => cancelAnimationFrame(raf);
    }
    setFiltersActive(false);
    const timer = setTimeout(() => setFiltersMounted(false), 300);
    return () => clearTimeout(timer);
  }, [mobileFiltersOpen]);

  // ── Expansión del árbol de categorías (hover en desktop, chevron en móvil) ──
  const [hoverCat, setHoverCat] = useState<number | null>(null);
  const [pinCat, setPinCat] = useState<number | null>(null);
  const openCat = hoverCat ?? pinCat;

  // Ancla del flyout flotante: posición en pantalla de la fila hovereada
  // (se usa position:fixed para que el panel no lo recorte el sidebar).
  const [flyoutAnchor, setFlyoutAnchor] = useState<{
    top: number;
    right: number;
    left: number;
  } | null>(null);

  const captureAnchor = (el: HTMLElement | null) => {
    if (!el) return;
    const row = el.closest(".catalog-cat-row") as HTMLElement | null;
    const rect = (row ?? el).getBoundingClientRect();
    setFlyoutAnchor({ top: rect.top, right: rect.right, left: rect.left });
  };

  // Cierre con pequeño retardo: permite cruzar el hueco entre la fila y el
  // flyout sin que se cierre (mismo patrón que el menú del Header).
  const flyoutCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleCloseCat = () => {
    if (flyoutCloseTimer.current) clearTimeout(flyoutCloseTimer.current);
    flyoutCloseTimer.current = setTimeout(() => setHoverCat(null), 180);
  };
  const cancelCloseCat = () => {
    if (flyoutCloseTimer.current) {
      clearTimeout(flyoutCloseTimer.current);
      flyoutCloseTimer.current = null;
    }
  };

  // Al hacer scroll (sidebar o página) se cierra el flyout: su ancla queda
  // desactualizada y se vería "flotando" en una posición vieja.
  useEffect(() => {
    const closeFlyout = () => {
      setHoverCat(null);
      setPinCat(null);
      setFlyoutAnchor(null);
    };
    window.addEventListener("scroll", closeFlyout, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener("scroll", closeFlyout, { capture: true });
  }, []);

  useEffect(() => {
    catalogService
      .getFeaturedBrands()
      .then(setBrands)
      .catch(() => {});
    catalogService
      .getProductTypes()
      .then(setProductTypes)
      .catch(() => {});
    catalogService
      .getBranches()
      .then(setBranches)
      .catch(() => {});
  }, []);

  // El filtro por categoría debe incluir subcategorías: se expande el árbol
  // antes de consultar (las categorías ya vienen con su jerarquía).
  const queryCategoryIds = catalogCategories?.length
    ? expandCategoryIds(catalogCategories, catalogCategory)
    : catalogCategory;

  const {
    categories,
    products,
    loading: catalogLoading,
    error: catalogError,
  } = useCatalog(
    {
      categoryIds: catalogSearch ? [] : queryCategoryIds,
      productIds: catalogSearch ? undefined : catalogProductIds,
      onSale: catalogSearch ? false : catalogOnSale,
      priceRange: catalogSearch ? "all" : catalogPriceRange,
      sort: catalogSort,
      search: catalogSearch,
      brandId: catalogSearch ? undefined : (catalogBrand ?? undefined),
      branchId: catalogBranch ?? undefined,
      productTypeCode: catalogSearch
        ? undefined
        : catalogProductType || undefined,
      limit: PAGE_SIZE,
      offset,
    },
    catalogCategories,
  );

  const getCategoryName = (categoryId: number): string => {
    const category = categories.find((c) => c.id === categoryId);
    return category?.name || String(categoryId);
  };

  // Reset products when filters change
  useEffect(() => {
    setAllProducts([]);
    setOffset(0);
    setHasMore(true);
  }, [
    catalogCategory,
    catalogProductIds,
    catalogOnSale,
    catalogPriceRange,
    catalogSort,
    catalogSearch,
    catalogBrand,
    catalogBranch,
    catalogProductType,
  ]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setCatalogSearch(searchInput);
    }, 1000);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Sync search input when catalogSearch changes externally
  useEffect(() => {
    setSearchInput(catalogSearch);
  }, [catalogSearch]);

  // Accumulate products when new ones arrive (con dedupe por id por seguridad)
  useEffect(() => {
    if (offset === 0) {
      setAllProducts(products);
    } else {
      setAllProducts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const fresh = products.filter((p) => !seen.has(p.id));
        return [...prev, ...fresh];
      });
    }
    setHasMore(products.length === PAGE_SIZE);
  }, [products, offset]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  // Libera el lock cuando llega una página nueva (o cuando la carga falla).
  useEffect(() => {
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [products, catalogError]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setOffset((prev) => prev + PAGE_SIZE);
  }, []);

  const categoriesByParentId = categories.reduce<
    Map<number | null, CatalogCategory[]>
  >((map, category) => {
    const parentId = category.parentId ?? null;
    const current = map.get(parentId) ?? [];
    current.push(category);
    map.set(parentId, current);
    return map;
  }, new Map());

  const getDescendantIds = (categoryId: number): number[] => {
    const descendants = new Set<number>();
    const stack = [categoryId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      if (descendants.has(currentId)) continue;
      descendants.add(currentId);

      for (const child of categoriesByParentId.get(currentId) ?? []) {
        stack.push(child.id);
      }
    }

    return Array.from(descendants);
  };

  const getCategoryCount = (categoryId: number): number => {
    const descendantIds = getDescendantIds(categoryId);
    return descendantIds.reduce((sum, id) => {
      const category = categories.find((c) => c.id === id);
      return sum + (category?.count ?? 0);
    }, 0);
  };

  // Selección única: el filtro de categorías no combina categorías. Volver a
  // pulsar la categoría activa la quita.
  const toggleCategory = (categoryId: number) => {
    setCatalogCategory(
      catalogCategory.includes(categoryId) ? [] : [categoryId],
    );
  };

  const catalogProducts = products.length > 0 ? products : EMPTY_PRODUCTS;
  const rootCategories =
    categories.length > 0
      ? categories.filter((category) => !category.parentId)
      : [];

  const getChildCategories = (parentId: number) =>
    categoriesByParentId.get(parentId) ?? [];

  const activeFilterCount =
    catalogCategory.length +
    (catalogProductIds.length > 0 ? 1 : 0) +
    (catalogOnSale ? 1 : 0) +
    (catalogPriceRange !== "all" ? 1 : 0) +
    (catalogProductType ? 1 : 0) +
    (catalogBranch ? 1 : 0);

  const clearAll = () => {
    setCatalogCategory([]);
    setCatalogProductIds([]);
    setCatalogOnSale(false);
    setCatalogPriceRange("all");
    setCatalogSearch("");
    setCatalogBrand(null);
    setCatalogBranch(null);
    setCatalogProductType("");
  };

  const SidebarContent = ({
    flyoutToRight = true,
  }: {
    flyoutToRight?: boolean;
  }) => {
    return (
    <div className="space-y-6">
      {/* Categories */}
      <div>
        <h3 className="font-bold text-sm text-foreground mb-3">Categorías</h3>
        <div className="space-y-0.5">
          {rootCategories.map((cat) => {
            const icon = categoryIcon(cat.slug, cat.name);
            const childCategories = getChildCategories(cat.id);
            const checked = catalogCategory.includes(cat.id);
            const isOpen = openCat === cat.id;

            return (
              <div
                key={cat.id}
                className="relative catalog-cat-row"
                onMouseEnter={(e) => {
                  cancelCloseCat();
                  captureAnchor(e.currentTarget);
                  setHoverCat(cat.id);
                }}
                onMouseLeave={scheduleCloseCat}
              >
                <label
                  className={`flex items-center gap-2.5 py-1.5 px-2 rounded-lg cursor-pointer transition-colors ${
                    checked
                      ? "filter-selected"
                      : isOpen
                        ? "bg-muted"
                        : "hover:bg-muted"
                  }`}
                >
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-[12px] leading-none"
                    style={{ background: cat.bg ?? "var(--muted)" }}
                  >
                    {icon}
                  </div>
                  <span
                    className={`text-sm flex-1 min-w-0 transition-colors leading-tight break-words ${
                      checked ? "font-semibold" : "text-muted-foreground"
                    }`}
                    onClick={() => toggleCategory(cat.id)}
                  >
                    {cat.name}
                  </span>
                  {childCategories.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        captureAnchor(e.currentTarget);
                        setPinCat(isOpen ? null : cat.id);
                      }}
                      className={`p-0.5 rounded transition-all ${
                        checked
                          ? "opacity-80 hover:opacity-100"
                          : isOpen
                            ? "text-foreground"
                            : "text-gray-300 hover:text-gray-500"
                      } ${isOpen ? "rotate-90" : ""}`}
                      title={isOpen ? "Contraer" : "Expandir"}
                    >
                      <ChevronRight size={14} />
                    </button>
                  )}
                </label>

                {isOpen && childCategories.length > 0 && flyoutAnchor && (
                  // z-40: es contenido de página, así que queda por debajo del
                  // header pegajoso (z-50) y de las capas flotantes (carrito,
                  // modales). El panel se dibuja justo debajo del header, nunca
                  // lo tapa. Con z-[60] se montaba encima del carrito.
                  <CategoryFlyout
                    nodes={childCategories}
                    anchor={flyoutAnchor}
                    openToRight={flyoutToRight}
                    selectedIds={catalogCategory}
                    childrenOf={getChildCategories}
                    onToggle={toggleCategory}
                    onEnter={cancelCloseCat}
                    onLeave={scheduleCloseCat}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Price range */}
      <div className="border-t border-border pt-5">
        <h3 className="font-bold text-sm text-foreground mb-3">
          Rango de precio
        </h3>
        <div className="space-y-1.5">
          {PRICE_RANGES.map((r) => (
            <label
              key={r.id}
              className="flex items-center gap-2.5 py-1 px-2 rounded-lg cursor-pointer hover:bg-muted transition-colors"
            >
              <div
                className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                style={{
                  borderColor:
                    catalogPriceRange === r.id ? "var(--secondary)" : "#D1D5DB",
                }}
                onClick={() => setCatalogPriceRange(r.id)}
              >
                {catalogPriceRange === r.id && (
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: "var(--secondary)" }}
                  />
                )}
              </div>
              <span
                className="text-sm flex-1 min-w-0 cursor-pointer break-words"
                style={{
                  color: catalogPriceRange === r.id ? "var(--foreground)" : "var(--muted-foreground)",
                  fontWeight: catalogPriceRange === r.id ? 600 : 400,
                }}
                onClick={() => setCatalogPriceRange(r.id)}
              >
                {r.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Brands */}
      {brands.length > 0 && (
        <div className="border-t border-border pt-5">
          <h3 className="font-bold text-sm text-foreground mb-3">Marcas</h3>
          <div className="relative mb-2">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={brandSearch}
              onChange={(e) => setBrandSearch(e.target.value)}
              placeholder="Buscar marca..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 bg-muted/40"
            />
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {brands
              .filter((brand) =>
                brand.name.toLowerCase().includes(brandSearch.toLowerCase()),
              )
              .map((brand) => {
                const checked = catalogBrand === brand.id;
                return (
                  <label
                    key={brand.id}
                    className="flex items-center gap-2.5 py-1 px-2 rounded-lg cursor-pointer hover:bg-muted transition-colors group"
                  >
                    <div
                      className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all"
                      style={{
                        borderColor: checked ? "var(--secondary)" : "#D1D5DB",
                        background: checked ? "var(--secondary)" : "white",
                      }}
                      onClick={() => setCatalogBrand(checked ? null : brand.id)}
                    >
                      {checked && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </div>
                    <span
                      className="text-sm flex-1 min-w-0 transition-colors break-words"
                      style={{
                        color: checked ? "var(--foreground)" : "var(--muted-foreground)",
                        fontWeight: checked ? 600 : 400,
                      }}
                      onClick={() => setCatalogBrand(checked ? null : brand.id)}
                    >
                      {brand.name}
                    </span>
                  </label>
                );
              })}
          </div>
        </div>
      )}

      {/* Product Types */}
      {productTypes.length > 0 && (
        <div className="border-t border-border pt-5">
          <h3 className="font-bold text-sm text-foreground mb-3">
            Tipo de producto
          </h3>
          <div className="space-y-1.5">
            {productTypes.map((pt) => {
              const checked = catalogProductType === pt.code;
              return (
                <label
                  key={pt.id}
                  className="flex items-center gap-2.5 py-1 px-2 rounded-lg cursor-pointer hover:bg-muted transition-colors group"
                >
                  <div
                    className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      borderColor: checked ? "var(--secondary)" : "#D1D5DB",
                      background: checked ? "var(--secondary)" : "white",
                    }}
                    onClick={() =>
                      setCatalogProductType(checked ? "" : pt.code)
                    }
                  >
                    {checked && (
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                  {pt.imagePath ? (
                    <img
                      src={pt.imagePath}
                      alt=""
                      className="w-5 h-5 rounded object-cover flex-shrink-0"
                    />
                  ) : (
                    <span className="text-sm leading-none">
                      {productTypeIcon(pt.code, 0, pt.name)}
                    </span>
                  )}
                  <span
                    className="text-sm flex-1 min-w-0 transition-colors break-words"
                    style={{
                      color: checked ? "var(--foreground)" : "var(--muted-foreground)",
                      fontWeight: checked ? 600 : 400,
                    }}
                    onClick={() =>
                      setCatalogProductType(checked ? "" : pt.code)
                    }
                  >
                    {pt.name}
                  </span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">
                    {pt.count}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* On sale */}
      <div className="border-t border-border pt-5">
        <label className="flex items-center justify-between cursor-pointer group">
          <div>
            <p className="font-bold text-sm text-foreground">Solo ofertas</p>
            <p className="text-xs text-muted-foreground">
              Productos con descuento
            </p>
          </div>
          <div
            className="relative w-11 h-6 rounded-full transition-all flex-shrink-0"
            style={{ background: catalogOnSale ? "var(--primary)" : "#E5E7EB" }}
            onClick={() => setCatalogOnSale(!catalogOnSale)}
          >
            <div
              className="absolute top-1 w-4 h-4 rounded-full bg-foreground transition-all shadow-sm"
              style={{ left: catalogOnSale ? "calc(100% - 20px)" : "4px" }}
            />
          </div>
        </label>
      </div>

      {activeFilterCount > 0 && (
        <button
          onClick={clearAll}
          className="w-full py-2 rounded-xl text-sm font-semibold text-muted-foreground border border-border hover:border-foreground hover:text-foreground transition-all"
        >
          Limpiar todos los filtros
        </button>
      )}
    </div>
    );
  };

  const filtered = allProducts;

  return (
    <div
      className="bg-muted/40"
      style={{ height: "calc(100vh - 108px)", overflow: "hidden" }}
    >
      {/* ── Two-column body ── */}
      <div className="max-w-7xl mx-auto px-4 py-5 flex gap-5 h-full">
        {/* Desktop sidebar */}
        <aside
          className="hidden md:flex flex-col w-56 flex-shrink-0 bg-white rounded-xl border border-border overflow-y-auto overflow-x-hidden"
          style={{ height: "calc(100vh - 148px)" }}
        >
          {/* Search inside sidebar */}
          <div className="p-3 border-b border-border sticky top-0 bg-white z-10">
            <form
              onSubmit={(e) => {
                e.preventDefault();
              }}
              className="relative"
            >
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar en catálogo..."
                className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-border bg-muted/60 focus:outline-none"
                onFocus={(e) => {
                  e.target.style.boxShadow = "0 0 0 2px #FFF200";
                  e.target.style.borderColor = "var(--primary)";
                }}
                onBlur={(e) => {
                  e.target.style.boxShadow = "none";
                  e.target.style.borderColor = "";
                }}
              />
            </form>
          </div>
          <div className="p-4">
            <SidebarContent flyoutToRight />
          </div>
        </aside>

        {/* Products column */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Sort row + chips */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-shrink-0">
            <div className="flex items-start flex-wrap gap-1.5">
              {/* Mobile filters button */}
              <button
                onClick={() => setMobileFiltersOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-semibold md:hidden hover:bg-muted transition-colors"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                  <line x1="11" y1="18" x2="13" y2="18" />
                </svg>
                Filtros
                {activeFilterCount > 0 && (
                  <span
                    className="w-4 h-4 rounded-full text-xs font-black flex items-center justify-center"
                    style={{ background: "var(--primary)", color: "var(--foreground)" }}
                  >
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {(catalogCategory.length > 0 ||
                catalogOnSale ||
                catalogPriceRange !== "all" ||
                catalogSearch ||
                catalogBrand ||
                catalogProductType ||
                catalogBranch) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {catalogCategory.map((cat) => (
                    <span
                      key={cat}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border-2 border-foreground text-foreground"
                    >
                      {getCategoryName(cat)}
                      <button
                        onClick={() => toggleCategory(cat)}
                        className="hover:opacity-60 ml-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                  {catalogOnSale && (
                    <span
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-white"
                      style={{ background: "var(--accent)" }}
                    >
                      Solo ofertas
                      <button
                        onClick={() => setCatalogOnSale(false)}
                        className="hover:opacity-70 ml-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  )}
                  {catalogPriceRange !== "all" && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-border text-muted-foreground">
                      {
                        PRICE_RANGES.find((r) => r.id === catalogPriceRange)
                          ?.label
                      }
                      <button
                        onClick={() => setCatalogPriceRange("all")}
                        className="hover:opacity-70 ml-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  )}
                  {catalogBrand && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-border text-muted-foreground">
                      {brands.find((b) => b.id === catalogBrand)?.name ||
                        `Marca #${catalogBrand}`}
                      <button
                        onClick={() => setCatalogBrand(null)}
                        className="hover:opacity-70 ml-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  )}
                  {catalogProductType && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-border text-muted-foreground">
                      {productTypes.find((pt) => pt.code === catalogProductType)
                        ?.name || catalogProductType}
                      <button
                        onClick={() => setCatalogProductType("")}
                        className="hover:opacity-70 ml-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  )}
                  {catalogBranch && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-border text-muted-foreground">
                      {branches.find((b) => b.id === catalogBranch)?.name ||
                        `Sucursal #${catalogBranch}`}
                      <button
                        onClick={() => setCatalogBranch(null)}
                        className="hover:opacity-70 ml-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  )}
                  {catalogSearch && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-border text-muted-foreground">
                      "{catalogSearch}"
                      <button
                        onClick={() => setCatalogSearch("")}
                        className="hover:opacity-70 ml-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  )}
                  {catalogProductIds.length > 0 && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-border text-muted-foreground">
                      Selección de productos ({catalogProductIds.length})
                      <button
                        onClick={() => setCatalogProductIds([])}
                        className="hover:opacity-70 ml-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  )}
                  <button
                    onClick={clearAll}
                    className="text-xs text-muted-foreground underline hover:text-foreground transition-colors ml-1 whitespace-nowrap"
                  >
                    Limpiar todo
                  </button>
                </div>
              )}
            </div>

            {/* Sort: dropdown propio */}
            <div ref={sortRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setSortOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={sortOpen}
                  className={`flex items-center gap-2 pl-3 pr-2.5 py-2 text-xs rounded-xl border bg-white font-medium shadow-sm hover:shadow transition-all cursor-pointer ${
                    sortOpen ? "" : "border-border"
                  }`}
                  style={
                    sortOpen
                      ? {
                          borderColor: "var(--primary)",
                          boxShadow: "0 0 0 2px rgba(255,242,0,0.35)",
                        }
                      : undefined
                  }
                >
                  <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground hidden sm:inline">
                    Ordenar por
                  </span>
                  <span className="font-bold whitespace-nowrap">
                    {SORT_OPTIONS.find((o) => o.id === catalogSort)?.label ??
                      "Relevancia"}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${
                      sortOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {sortOpen && (
                  <div
                    role="listbox"
                    className="absolute right-0 top-full mt-2 z-50 w-56 rounded-xl border border-border bg-white shadow-xl overflow-hidden py-1"
                  >
                    {SORT_OPTIONS.map((o) => {
                      const active = o.id === catalogSort;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => {
                            setCatalogSort(o.id);
                            setSortOpen(false);
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors"
                          style={
                            active
                              ? {
                                  background: "var(--primary)",
                                  color: "var(--foreground)",
                                  fontWeight: 700,
                                }
                              : undefined
                          }
                          onMouseEnter={(e) => {
                            if (!active) {
                              e.currentTarget.style.background = "var(--muted)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!active) {
                              e.currentTarget.style.background = "";
                            }
                          }}
                        >
                          <span>{o.label}</span>
                          {active && <Check className="w-3.5 h-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
          </div>

          {/* Filtro por sucursal: tabs, una sola a la vez */}
          {branches.length > 0 && (
            <div
              className="flex items-center gap-2 mb-3 overflow-x-auto pb-1 flex-shrink-0"
              style={{ scrollbarWidth: "none" }}
            >
              <button
                onClick={() => setCatalogBranch(null)}
                className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border whitespace-nowrap"
                style={
                  catalogBranch === null
                    ? {
                        background: "var(--secondary)",
                        color: "var(--primary)",
                        borderColor: "var(--secondary)",
                      }
                    : {
                        background: "var(--muted)",
                        color: "var(--muted-foreground)",
                        borderColor: "transparent",
                      }
                }
              >
                Todas las sucursales
              </button>
              {branches.map((b) => (
                <button
                  key={b.id}
                  onClick={() =>
                    setCatalogBranch(catalogBranch === b.id ? null : b.id)
                  }
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border whitespace-nowrap"
                  style={
                    catalogBranch === b.id
                      ? {
                          background: "var(--secondary)",
                          color: "var(--primary)",
                          borderColor: "var(--secondary)",
                        }
                      : {
                          background: "var(--muted)",
                          color: "var(--muted-foreground)",
                          borderColor: "transparent",
                        }
                  }
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}

          {/* Grid */}
          <div
            className="flex-1 overflow-y-auto"
            style={{ height: "calc(100vh - 220px)" }}
          >
            {catalogLoading && allProducts.length === 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                {Array.from({ length: PAGE_SIZE }).map((_, index) => (
                  <SkeletonCard key={index} />
                ))}
              </div>
            ) : filtered.length > 0 ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                  {filtered.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      cartItems={cartItems}
                      onAdd={onAdd}
                      onRemove={onRemove}
                      onProductClick={onProductClick}
                    />
                  ))}
                </div>

                {/* Sentinel + skeletons */}
                <InfiniteScrollTrigger
                  onIntersect={loadMore}
                  count={loadingMore ? PAGE_SIZE : 0}
                  disabled={!hasMore || loadingMore}
                />

                {!hasMore && allProducts.length > 0 && (
                  <p className="text-center text-xs text-muted-foreground mt-10 pb-8">
                    ✓ Has visto todos los {allProducts.length} productos
                  </p>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-20">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                  <Search className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="font-bold text-foreground">Sin resultados</p>
                <p className="text-sm text-muted-foreground mt-1 mb-4">
                  Intenta con otros filtros o categorías.
                </p>
                <button
                  onClick={clearAll}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-95"
                  style={{ background: "var(--primary)", color: "var(--foreground)" }}
                >
                  Limpiar filtros
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile filters drawer */}
      {filtersMounted && (
        <div
          className={`fixed inset-0 z-50 flex md:hidden ${
            filtersActive ? "pointer-events-auto" : "pointer-events-none"
          }`}
        >
          <div
            className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
              filtersActive ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setMobileFiltersOpen(false)}
          />
          <div
            className={`relative ml-auto w-72 bg-white h-full flex flex-col shadow-2xl transition-transform duration-300 ease-out pb-[var(--safe-bottom)] ${
              filtersActive ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <h2 className="font-bold text-base">Filtros</h2>
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
              <SidebarContent flyoutToRight={false} />
            </div>
            <div className="border-t border-border p-4">
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all hover:brightness-95"
                style={{ background: "var(--secondary)", color: "var(--primary)" }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                  <line x1="11" y1="18" x2="13" y2="18" />
                </svg>
                Aplicar filtros
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
