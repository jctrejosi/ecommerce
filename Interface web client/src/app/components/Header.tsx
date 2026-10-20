import { useState, useEffect, useRef } from "react";
import { categoryIcon } from "../categoryIcons";
import {
  Search,
  ShoppingCart,
  MapPin,
  User,
  Package,
  Menu,
  TrendingUp,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  X,
  Plus,
  Minus,
  Bell,
  Phone,
  MessageCircle,
  Sun,
  Moon,
} from "lucide-react";
import { Logo } from "../Logo";
import storeLogo from "../../assets/logo.png";
import type { CartItem, CatalogCategory, Product } from "../types";
import { catalogService } from "../../services/catalog.service";
import { NotificationsDropdown } from "./NotificationsDropdown";
import { AddressModal, getAddressDisplay } from "./AddressModal";
import {
  type CustomerAddress,
  customerAddressService,
} from "../../services/customer-auth.service";
import type { AppNotification } from "../../hooks/useNotifications";
import { useTheme, type Theme, type ThemeConfig } from "../../hooks/useTheme";

/**
 * Alterna entre tema claro y oscuro. Los colores de cada tema se configuran
 * desde el admin (/contenido/general) y llegan en `generalLogo.theme`.
 */
function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const isDark = theme === "oscuro";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      title={isDark ? "Tema claro" : "Tema oscuro"}
      className="flex items-center justify-center w-8 h-8 rounded-full border border-border text-foreground hover:bg-muted transition-colors cursor-pointer"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

const API_BASE_URL = (import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"));

// Prefijos telefónicos conocidos (los más largos primero).
const WHATSAPP_PREFIXES = [
  "+591", "+593", "+595", "+598", "+351",
  "+57", "+52", "+51", "+54", "+56", "+58", "+55", "+34", "+44", "+49", "+33", "+39", "+1",
];

// Muestra el WhatsApp con el prefijo separado del número.
function formatWhatsapp(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  const spaced = value.match(/^(\+\d{1,4})\s+(.+)$/);
  if (spaced) return `${spaced[1]} ${spaced[2].trim()}`;
  const prefix = WHATSAPP_PREFIXES.find((p) => value.startsWith(p));
  if (prefix && value.length > prefix.length) {
    return `${prefix} ${value.slice(prefix.length)}`;
  }
  return value;
}

interface HeaderProps {
  cartCount: number;
  categories: CatalogCategory[];
  customer: { firstName?: string; fullName?: string } | null;
  customerLoading: boolean;
  ordersCount: number;
  cartItems: CartItem[];
  onCartOpen: () => void;
  onOrdersOpen: () => void;
  onLoginModal: (view: "choice" | "login" | "register") => void;
  onCatalogSearch: (search: string) => void;
  onOpenCatalog: (categoryId?: number) => void;
  onAddToCart: (product: Product, quantity?: number) => void;
  onRemoveFromCart: (id: number) => void;
  currentView: string;
  onHome: () => void;
  onAccount?: () => void;
  notifications?: AppNotification[];
  unreadNotifCount?: number;
  onMarkNotifRead?: (id: number) => void;
  /** Abre el mapa de rastreo de un pedido (notificaciones tipo order-track). */
  onTrackOrder?: (code: string) => void;
  onNavigateNotifs: () => void;
  onAddressClick: () => void;
  generalLogo?: { url?: string; theme?: ThemeConfig | null } | null;
  fmt: (n: number) => string;
}

const POPULAR_SEARCHES = [
  "Leche Alquería",
  "Aguacate",
  "Arroz Diana",
  "Pollo",
  "Huevos",
  "Café Juan Valdez",
];

export function Header({
  cartCount,
  categories,
  customer,
  customerLoading,
  ordersCount,
  cartItems,
  onCartOpen,
  onOrdersOpen,
  onLoginModal,
  onCatalogSearch,
  onOpenCatalog,
  onAddToCart,
  onRemoveFromCart,
  currentView,
  onHome,
  onAccount,
  notifications = [],
  unreadNotifCount = 0,
  onMarkNotifRead,
  onTrackOrder,
  onNavigateNotifs,
  onAddressClick,
  generalLogo,
  fmt,
}: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchCategories, setSearchCategories] = useState<CatalogCategory[]>(
    [],
  );
  const searchRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Una vez abierto el menú por primera vez, el punto deja de titilar.
  const [mobileMenuSeen, setMobileMenuSeen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const categoriesRef = useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const { theme, toggleTheme } = useTheme(generalLogo?.theme);
  const [defaultAddress, setDefaultAddress] = useState<CustomerAddress | null>(
    null,
  );
  const [storePhone, setStorePhone] = useState("");
  const [storeWhatsapp, setStoreWhatsapp] = useState("");
  // Sombra solo cuando la fila del buscador está flotando sobre el contenido
  // (así no queda una línea de sombra entre el buscador y la tira de contacto).
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsStuck(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // El header no siempre mide 64px (en móvil lleva una fila extra de logos y su
  // altura puede variar con el tamaño de fuente). Se publica como variable CSS
  // para que los desplegables con `position: fixed` se anclen justo debajo.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () =>
      el.style.setProperty("--header-h", `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load default address when customer changes
  useEffect(() => {
    if (customer) {
      customerAddressService
        .getAddresses()
        .then((addrs) => {
          setDefaultAddress(addrs.find((a) => a.isDefault) ?? null);
        })
        .catch(() => {});
    } else {
      setDefaultAddress(null);
    }
  }, [customer]);

  // Load store contact info
  useEffect(() => {
    fetch(`${API_BASE_URL}/admin/settings/public-info`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => {
        setStorePhone(d.phone || "");
        setStoreWhatsapp(d.whatsapp || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node))
        setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close categories dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        categoriesRef.current &&
        !categoriesRef.current.contains(e.target as Node)
      ) {
        setCategoriesOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Sync categories from props for search suggestions
  useEffect(() => {
    if (categories.length > 0) setSearchCategories(categories);
  }, [categories]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    let cancelled = false;

    const timer = setTimeout(() => {
      void catalogService
        .getProducts({
          search: query,
          limit: 5,
        })
        .then((products) => {
          if (!cancelled) setSearchResults(products);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, searchCategories]);

  const normalizeForMatch = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const suggestedCategories =
    searchQuery.trim().length >= 2
      ? searchCategories
          .filter((cat) =>
            normalizeForMatch(cat.name).includes(
              normalizeForMatch(searchQuery.trim()),
            ),
          )
          .slice(0, 5)
      : [];

  const handleSearch = () => {
    const query = searchQuery.trim();
    if (query.length >= 2) {
      setSearchOpen(false);
      // onCatalogSearch abre el catálogo con la búsqueda aplicada.
      onCatalogSearch(query);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  // Build category tree for the dropdown menu
  const categoriesByParentId = categories.reduce<
    Map<number | null, CatalogCategory[]>
  >((map, cat) => {
    const parentId = cat.parentId ?? null;
    const existing = map.get(parentId) ?? [];
    existing.push(cat);
    map.set(parentId, existing);
    return map;
  }, new Map());

  const rootCategories = categories.filter((cat) => !cat.parentId);

  // Track which root category is hovered to show its flyout
  const [hoveredRootId, setHoveredRootId] = useState<number | null>(null);
  const flyoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track sub-flyout chain for nested hover
  const [hoveredSubPath, setHoveredSubPath] = useState<number[]>([]);
  const subTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recursive flyout column — renders one column of items
  function FlyoutColumn({
    categoryIds,
    path,
  }: {
    categoryIds: number[];
    path: number[];
  }) {
    const activeId = path.length > 0 ? path[path.length - 1] : null;
    return (
      <div
        className="py-2 w-[240px] shrink-0"
        onMouseEnter={() => {
          if (subTimerRef.current) clearTimeout(subTimerRef.current);
        }}
      >
        {categoryIds.map((id) => {
          const cat = categories.find((c) => c.id === id);
          if (!cat) return null;
          const icon = categoryIcon(cat.slug, cat.name);
          const children = categoriesByParentId.get(id) ?? [];
          const hasChildren = children.length > 0;
          const isActive = activeId === id;
          return (
            <button
              key={id}
              onClick={() => {
                onOpenCatalog(id);
                setCategoriesOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted transition-colors text-left min-h-[32px] ${isActive ? "bg-muted" : ""}`}
              onMouseEnter={() => {
                if (subTimerRef.current) clearTimeout(subTimerRef.current);
                if (hasChildren) {
                  setHoveredSubPath([...path, id]);
                } else {
                  setHoveredSubPath(path);
                }
              }}
            >
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-[13px] leading-none"
                style={{
                  background: cat.bg || "var(--muted)",
                  color: cat.color || "var(--muted-foreground)",
                }}
              >
                {icon}
              </div>
              <div className="flex-1 min-w-0 leading-tight">
                <p className="text-xs font-medium text-foreground uppercase tracking-wide whitespace-normal">
                  {cat.name}
                </p>
              </div>
              {hasChildren && (
                <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <header
        ref={headerRef}
        className={`sticky top-0 z-50 bg-white border-b border-border transition-shadow ${isStuck ? "shadow-sm" : ""}`}
      >

      {/* Logos (solo móvil): tira superior en una sola fila */}
      <div className="md:hidden px-4 pt-2 pb-1 flex items-center justify-center gap-3">
        <a
          href="#"
          className="flex items-center gap-3"
          onClick={(e) => {
            e.preventDefault();
            onHome();
          }}
        >
          <img
            src={storeLogo}
            alt="Mercaldas"
            className="h-5 w-auto object-contain"
          />
          <span className="h-5 w-px bg-gray-300" aria-hidden="true" />
          <Logo
            dark={true}
            logoSrc={generalLogo?.url}
            hideTextOnMobile
            imgClassName="h-5 w-auto object-contain"
            boxClassName="w-5 h-5"
          />
        </a>
      </div>

      {/* Main header row */}
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-3">
        <button
          className="md:hidden order-1 relative p-2 rounded-lg hover:bg-muted transition-colors"
          onClick={() => {
            if (!mobileMenuOpen) setMobileMenuSeen(true);
            setMobileMenuOpen(!mobileMenuOpen);
          }}
          aria-label="Abrir menú"
        >
          <Menu className="w-5 h-5" />
          {(unreadNotifCount > 0 || ordersCount > 0) && (
            <span
              className="pointer-events-none absolute top-1 right-1 w-2.5 h-2.5"
              aria-hidden="true"
            >
              {!mobileMenuSeen && (
                <span
                  className="absolute inset-0 rounded-full border-2 animate-ping"
                  style={{ borderColor: "var(--accent)" }}
                />
              )}
              <span
                className={`absolute inset-0 rounded-full border-2 border-white ${
                  mobileMenuSeen ? "" : "animate-blink"
                }`}
                style={{ background: "var(--accent)" }}
              />
            </span>
          )}
        </button>

        <a
          href="#"
          className="hidden md:flex flex-shrink-0 items-center gap-3"
          onClick={(e) => {
            e.preventDefault();
            onHome();
          }}
        >
          <img src={storeLogo} alt="Mercaldas" className="h-7 w-auto object-contain" />
          <span className="h-6 w-px bg-gray-300" aria-hidden="true" />
          <Logo
            dark={true}
            logoSrc={generalLogo?.url}
            imgClassName="h-8 w-auto object-contain"
            boxClassName="w-8 h-8"
          />
        </a>

        <div className="flex-1 max-w-2xl mx-auto order-2 md:order-none" ref={searchRef}>
          <div className="relative">
            {/* Input */}
            <div className="relative flex items-center">
              {/* Search button */}
              <button
                onClick={handleSearch}
                className="absolute left-3 z-10 p-0.5 rounded-full hover:bg-muted transition-colors"
                aria-label="Buscar"
              >
                <Search className="w-4 h-4 text-muted-foreground" />
              </button>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Busca productos, marcas y categorías..."
                className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-border bg-muted/60 text-sm focus:outline-none transition-all"
                style={
                  searchOpen
                    ? {
                        boxShadow: "0 0 0 2px var(--primary)",
                        borderColor: "var(--primary)",
                        borderBottomLeftRadius: searchOpen ? "0" : "",
                        borderBottomRightRadius: searchOpen ? "0" : "",
                      }
                    : {}
                }
              />
              {searchQuery && (
                <button
                  className="absolute right-3 p-0.5 rounded-full hover:bg-muted transition-colors"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchOpen(false);
                  }}
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              )}
            </div>

            {/* Dropdown */}
            {searchOpen && (
              <div
                className="fixed inset-x-0 top-[var(--header-h)] md:absolute md:top-full md:left-0 md:right-0 bg-white border border-border rounded-b-xl shadow-xl z-50 overflow-hidden"
                style={{
                  borderTop: "none",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
                }}
              >
                {/* Estado vacío: populares y categorías */}
                {searchQuery.trim().length < 2 && (
                  <div className="p-3 space-y-4">
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide px-1 mb-2 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> Búsquedas populares
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {POPULAR_SEARCHES.map((q) => (
                          <button
                            key={q}
                            onClick={() => {
                              setSearchQuery(q);
                            }}
                            className="px-3 py-1.5 rounded-full text-xs font-medium border border-border hover:border-foreground hover:bg-muted transition-all"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Con query: resultados + sugerencias */}
                {searchQuery.trim().length >= 2 && (
                  <div>
                    {/* Categorías sugeridas */}
                    {suggestedCategories.length > 0 && (
                      <div className="px-3 pt-3 pb-2 border-b border-border">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                          Categorías
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {suggestedCategories.map((cat) => {
                            const icon = categoryIcon(cat.slug, cat.name);
                            return (
                              <button
                                key={cat.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-border hover:bg-muted transition-all"
                                onClick={() => {
                                  setSearchQuery(cat.name);
                                }}
                              >
                                <span className="text-[13px] leading-none">
                                  {icon}
                                </span>
                                {cat.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Productos encontrados */}
                    {searchLoading ? (
                      <div className="px-4 py-6 text-center">
                        <p className="text-sm text-muted-foreground">
                          Buscando productos...
                        </p>
                      </div>
                    ) : searchResults.length > 0 ? (
                      <div>
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide px-3 pt-3 pb-1.5">
                          Productos ({searchResults.length})
                        </p>
                        <ul className="max-h-[260px] overflow-y-auto">
                          {searchResults.slice(0, 5).map((p) => {
                            const inCart = cartItems.find((c) => c.id === p.id);
                            return (
                              <li
                                key={p.id}
                                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors border-b border-border last:border-0"
                              >
                                <div className="w-11 h-11 rounded-lg bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  {p.image ? (
                                    <img
                                      src={p.image}
                                      alt={p.name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <Package className="w-5 h-5 text-muted-foreground" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-foreground truncate">
                                    {p.name}
                                  </p>
                                  {(p.plu || p.barcode || p.externalId) && (
                                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                      {[
                                        p.plu && `PLU: ${p.plu}`,
                                        p.barcode && `EAN: ${p.barcode}`,
                                        p.externalId && `Ref: ${p.externalId}`,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </p>
                                  )}
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span
                                      className="text-sm font-bold"
                                      style={{
                                        fontFamily:
                                          "'Bricolage Grotesque', sans-serif",
                                      }}
                                    >
                                      {fmt(p.price)}
                                    </span>
                                    {p.originalPrice && (
                                      <span className="text-xs text-muted-foreground line-through">
                                        {fmt(p.originalPrice)}
                                      </span>
                                    )}
                                    {p.badge && (
                                      <span
                                        className="text-xs font-bold px-1.5 py-0.5 rounded-full text-white"
                                        style={{ background: "var(--accent)" }}
                                      >
                                        {p.badge}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                                  <div className="flex items-center border border-border rounded-lg overflow-hidden">
                                    <button
                                      onClick={() => onRemoveFromCart(p.id)}
                                      disabled={(inCart?.quantity ?? 0) === 0}
                                      className="px-2 py-1.5 hover:bg-muted transition-colors disabled:opacity-25"
                                    >
                                      <Minus className="w-3 h-3" />
                                    </button>
                                    <span className="w-6 text-center text-xs font-bold tabular-nums">
                                      {inCart?.quantity ?? 0}
                                    </span>
                                    <button
                                      onClick={() => onAddToCart(p)}
                                      className="px-2 py-1.5 hover:bg-muted transition-colors"
                                    >
                                      <Plus className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <button
                                    onClick={() => onAddToCart(p)}
                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold flex-shrink-0 transition-all hover:brightness-95 whitespace-nowrap"
                                    style={{
                                      background: "var(--primary)",
                                      color: "var(--foreground)",
                                    }}
                                  >
                                    <Plus className="w-3 h-3" />
                                    Agregar
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        {/* Ver todos */}
                        <button
                          className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-foreground hover:bg-muted transition-colors"
                          onClick={() => {
                            setSearchOpen(false);
                            onCatalogSearch(searchQuery);
                          }}
                        >
                          Ver todos los resultados para "{searchQuery}"
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="px-4 py-6 text-center">
                        <p className="text-sm font-semibold text-foreground">
                          Sin resultados para "{searchQuery}"
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Intenta con otro término o explora las categorías.
                        </p>
                        <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                          {POPULAR_SEARCHES.slice(0, 4).map((q) => (
                            <button
                              key={q}
                              onClick={() => setSearchQuery(q)}
                              className="px-3 py-1.5 rounded-full text-xs font-medium border border-border hover:bg-muted transition-all"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 order-3 md:order-none">
          <button
            onClick={() => {
              if (customer) {
                if (onAccount) {
                  onAccount();
                  return;
                }
                onOrdersOpen();
                return;
              }
              onLoginModal("login");
            }}
            className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm font-medium whitespace-nowrap"
          >
            <User className="w-4 h-4" />
            <span className="hidden lg:inline">
              {customerLoading
                ? "Cargando..."
                : customer?.firstName || customer?.fullName || "Iniciar sesión"}
            </span>
          </button>
          {customer && (
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm font-medium whitespace-nowrap relative"
              >
                <Bell className="w-4 h-4" />
                {unreadNotifCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center"
                    style={{ background: "var(--accent)", color: "#fff" }}
                  >
                    {unreadNotifCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <NotificationsDropdown
                  notifications={notifications}
                  unreadCount={unreadNotifCount}
                  onMarkAsRead={(id) => {
                    onMarkNotifRead?.(id);
                  }}
                  onTrackOrder={onTrackOrder}
                  onNavigate={() => onNavigateNotifs?.()}
                  onClose={() => setNotifOpen(false)}
                />
              )}
            </div>
          )}
          <button
            onClick={onOrdersOpen}
            className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm font-medium whitespace-nowrap relative"
          >
            <Package className="w-4 h-4" />
            <span className="hidden lg:inline">Pedidos</span>
            {ordersCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {ordersCount}
              </span>
            )}
          </button>
          <button
            onClick={onCartOpen}
            className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm font-medium"
          >
            {cartCount > 0 && (
              <span className="cart-trace" aria-hidden="true" />
            )}
            <ShoppingCart className="w-5 h-5" />
            <span className="hidden lg:inline">Carrito</span>
            {cartCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center"
                style={{ background: "var(--primary)", color: "var(--foreground)" }}
              >
                {cartCount}
              </span>
            )}
          </button>
          {/* Móvil: el inicio de sesión ocupa el lugar que tenían los logos */}
          <button
            onClick={() => {
              if (customer) {
                if (onAccount) {
                  onAccount();
                  return;
                }
                onOrdersOpen();
                return;
              }
              onLoginModal("login");
            }}
            aria-label={customer ? "Mi cuenta" : "Iniciar sesión"}
            className="md:hidden flex items-center justify-center p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <User className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mobile dropdown (flotante: no desplaza el contenido) */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute left-0 right-0 top-full z-50 border-t border-b border-border bg-white px-4 py-3 flex flex-col gap-1 shadow-xl rounded-b-2xl max-h-[80vh] overflow-y-auto">
          {(customer
            ? ["Inicio", "Catálogo", "Mi carrito", "Pedidos", "Notificaciones", "Mi cuenta"]
            : ["Inicio", "Catálogo", "Mi carrito", "Pedidos"]
          ).map((item) => (
            <a
              key={item}
              href="#"
              className="flex items-center justify-between py-2.5 px-2 text-sm font-medium rounded-lg hover:bg-muted transition-colors border-b border-border last:border-0"
              onClick={(e) => {
                e.preventDefault();
                if (item === "Inicio") onHome();
                if (item === "Catálogo") onOpenCatalog();
                if (item === "Catalogo") onOpenCatalog();
                if (item === "Catálogo") onOpenCatalog();
                if (item === "Catálogo") onOpenCatalog();
                if (item === "Mi carrito") onCartOpen();
                if (item === "Pedidos") onOrdersOpen();
                if (item === "Notificaciones") onNavigateNotifs();
                if (item === "Mi cuenta" && onAccount) onAccount();
                setMobileMenuOpen(false);
              }}
            >
              <span>{item}</span>
              {item === "Mi carrito" && cartCount > 0 && (
                <span
                  className="w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center"
                  style={{ background: "var(--primary)", color: "var(--foreground)" }}
                >
                  {cartCount}
                </span>
              )}
              {item === "Pedidos" && ordersCount > 0 && (
                <span
                  className="w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  {ordersCount}
                </span>
              )}
              {item === "Notificaciones" && unreadNotifCount > 0 && (
                <span
                  className="w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  {unreadNotifCount}
                </span>
              )}
            </a>
          ))}

          {/* Cambio de tema (claro/oscuro), igual que en el navbar */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "oscuro" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
            className="w-full flex items-center justify-between py-2.5 px-2 rounded-lg text-left hover:bg-muted transition-colors cursor-pointer"
          >
            <span className="text-sm font-medium">
              {theme === "oscuro" ? "Tema oscuro" : "Tema claro"}
            </span>
            <span className="flex items-center justify-center w-8 h-8 rounded-full border border-border text-foreground">
              {theme === "oscuro" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </span>
          </button>
        </div>
      )}
      </header>

      {/* Contact strip */}
      {(storePhone || storeWhatsapp) && (
        <div className="hidden md:flex items-center justify-center gap-6 bg-white py-1.5 px-4">
          {storePhone && (
            <a href={`tel:${storePhone}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Phone className="w-3 h-3" />
              <span>{storePhone}</span>
            </a>
          )}
          {storeWhatsapp && (
            <a
              href={`https://wa.me/${storeWhatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-green-600 hover:text-green-700 transition-colors"
            >
              <MessageCircle className="w-3 h-3" />
              <span>{formatWhatsapp(storeWhatsapp)}</span>
            </a>
          )}
        </div>
      )}

      {/* ── NavBar ── */}
      <nav className="hidden md:block bg-white border-b border-border">
        <div className="max-w-7xl mx-auto px-4 flex items-center">
          {/* Categories dropdown trigger */}
          <div className="relative" ref={categoriesRef}>
            <button
              className="flex items-center gap-2 px-4 py-3 text-sm font-semibold text-white transition-colors"
              style={{ background: "var(--secondary)" }}
              onClick={() => setCategoriesOpen(!categoriesOpen)}
            >
              <Menu className="w-4 h-4" />
              Nuestros productos
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${categoriesOpen ? "rotate-180" : ""}`}
              />
            </button>

            {/* Dropdown mega menu */}
            {categoriesOpen && (
              <div
                className="absolute top-full left-0 bg-white border border-border rounded-b-xl shadow-xl z-50 flex"
                onMouseEnter={() => {
                  if (flyoutTimerRef.current)
                    clearTimeout(flyoutTimerRef.current);
                }}
                onMouseLeave={() => {
                  flyoutTimerRef.current = setTimeout(() => {
                    setHoveredRootId(null);
                    setHoveredSubPath([]);
                  }, 100);
                }}
              >
                {/* Root column */}
                <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden">
                  <FlyoutColumn
                    categoryIds={rootCategories.map((c) => c.id)}
                    path={[]}
                  />
                </div>

                {/* Flyout columns — rendered as siblings, not nested */}
                {hoveredSubPath.length > 0 &&
                  hoveredSubPath.map((id, colIdx) => {
                    const children = categoriesByParentId.get(id) ?? [];
                    if (children.length === 0) return null;
                    return (
                      <div
                        key={`${id}-${colIdx}`}
                        className="border-l border-border max-h-[70vh] overflow-y-auto overflow-x-hidden"
                        onMouseEnter={() => {
                          if (subTimerRef.current)
                            clearTimeout(subTimerRef.current);
                        }}
                        onMouseLeave={() => {
                          subTimerRef.current = setTimeout(() => {
                            setHoveredSubPath((prev) =>
                              prev.slice(0, colIdx + 1),
                            );
                          }, 100);
                        }}
                      >
                        <FlyoutColumn
                          categoryIds={children.map((c) => c.id)}
                          path={hoveredSubPath.slice(0, colIdx + 1)}
                        />
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {(customer
            ? ["Inicio", "Catálogo", "Mi cuenta"]
            : ["Inicio", "Catálogo"]
          ).map((item) => (
            <button
              key={item}
              onClick={() => {
                if (item === "Inicio") onHome();
                if (item === "Catálogo") onOpenCatalog();
                if (item === "Mi cuenta" && onAccount) onAccount();
              }}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${(item === "Inicio" && currentView === "home") || (item === "Catálogo" && currentView === "catalog") || (item === "Mi cuenta" && currentView === "account") ? "bg-primary text-foreground border-primary" : "border-transparent text-foreground"} hover:border-primary hover:text-foreground`}
            >
              {item}
            </button>
          ))}

          <button
            onClick={() => setAddressModalOpen(true)}
            className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>
              Entregar en{" "}
              <strong className="text-foreground">
                {getAddressDisplay(defaultAddress)}
              </strong>
            </span>
            <ChevronDown className="w-3 h-3" />
          </button>

          {/* Cambio de tema, a la derecha de la dirección */}
          <div className="ml-3">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </nav>

      <AddressModal
        open={addressModalOpen}
        onClose={() => setAddressModalOpen(false)}
        customer={customer}
        onLoginModal={onLoginModal}
        onAddressesChange={(addr) => setDefaultAddress(addr)}
      />
    </>
  );
}
