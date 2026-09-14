import { useState, useEffect, useRef, useCallback } from "react";
import sidebarLogo from "./assets/logo.png";
import {
  LayoutDashboard,
  Package,
  FolderTree,
  Tag,
  Users,
  ShoppingCart,
  Megaphone,
  Image,
  Layers,
  Percent,
  Shield,
  Settings,
  SlidersHorizontal,
  Search,
  Bell,
  ChevronRight,
  Plus,
  X,
  LogOut,
  User,
  HelpCircle,
  Zap,
  Hash,
  FileText,
  Globe,
  ChevronDown,
  Menu,
  Building2,
  AlertTriangle,
  LayoutTemplate,
  Mail,
  Clock,
  Store,
  Star,
} from "lucide-react";
import Dashboard from "./views/Dashboard";
import Products from "./views/Products";
import Orders from "./views/Orders";
import { ordersService } from "./services/orders.service";
import { authService, AuthApiError, type UserProfile } from "./services/auth.service";
import HomepageEditor from "./views/HomepageEditor";
import {
  HomeHeroSection,
  HomePromosSection,
  HomeProductTypesSection,
  HomeBenefitsBarSection,
  HomeFeaturedSection,
  HomeDealsSection,
  HomeBrandsSection,
  HomeBranchesSection,
  HomeBenefitsSection,
  HomeFooterSection,
} from "./views/Banners";
import Customers from "./views/Customers";
import Categories from "./views/Categories";
import Brands from "./views/Brands";
import General from "./views/General";
import ProductTypes from "./views/ProductTypes";
import Suppliers from "./views/Suppliers";
import Promotions from "./views/Promotions";
import Marketplace from "./views/Marketplace";
import UsersView from "./views/Users";
import SettingsView from "./views/Settings";
import Branches from "./views/Branches";
import Popups from "./views/Popups";
import Login from "./views/Login";
import AppFooter from "./components/AppFooter";
import Newsletter from "./views/Newsletter";

export type ViewId =
  | "dashboard"
  | "products"
  | "categories"
  | "productTypes"
  | "brands"
  | "suppliers"
  | "orders"
  | "customers"
  | "promotions"
  | "homepage"
  | "homeHero"
  | "homePromos"
  | "homeProductTypes"
  | "homeBenefitsBar"
  | "homeFeatured"
  | "homeDeals"
  | "homeBrands"
  | "homeBranches"
  | "homeBenefits"
  | "homeFooter"
  | "marketplace"
  | "users"
  | "settings"
  | "branches"
  | "general"
  | "popups"
  | "newsletter";

interface NavItem {
  id: ViewId;
  label: string;
  icon: React.ElementType;
  badge?: number;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    title: "Visión General",
    items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Catálogo",
    items: [
      { id: "products", label: "Productos", icon: Package },
      { id: "categories", label: "Categorías", icon: FolderTree },
      { id: "productTypes", label: "Tipos de Producto", icon: Layers },
      { id: "brands", label: "Marcas", icon: Tag },
      { id: "suppliers", label: "Proveedores", icon: Building2 },
      { id: "branches", label: "Sucursales", icon: Building2 },
    ],
  },
  {
    title: "Comercio",
    items: [
      { id: "orders", label: "Pedidos", icon: ShoppingCart },
      { id: "customers", label: "Clientes", icon: Users },
      { id: "promotions", label: "Promociones", icon: Percent },
    ],
  },
  {
    title: "Marketing",
    items: [
      { id: "popups", label: "Popups", icon: Megaphone },
      { id: "newsletter", label: "Newsletter", icon: Mail },
    ],
  },
  {
    title: "Contenido",
    items: [
      { id: "homeHero", label: "Banners publicitarios", icon: LayoutTemplate },
      { id: "homeProductTypes", label: "Tipos de Producto", icon: Layers },
      { id: "homeBenefitsBar", label: "Barra de Beneficios", icon: Zap },
      { id: "homeFeatured", label: "Productos Destacados", icon: Package },
      { id: "homePromos", label: "Banners Promocionales", icon: Megaphone },
      { id: "homeDeals", label: "Ofertas del Día", icon: Clock },
      { id: "homeBrands", label: "Marcas", icon: Tag },
      { id: "homeBranches", label: "Sucursales", icon: Store },
      { id: "homeBenefits", label: "Beneficios", icon: Star },
      { id: "homeFooter", label: "Footer", icon: LayoutTemplate },
      { id: "general", label: "General", icon: SlidersHorizontal },
    ],
  },
  {
    title: "Administración",
    items: [
      { id: "users", label: "Usuarios y Permisos", icon: Shield },
      { id: "settings", label: "Configuración", icon: Settings },
    ],
  },
];

const VIEW_PATHS: Record<string, ViewId> = {
  "": "dashboard",
  dashboard: "dashboard",
  products: "products",
  categories: "categories",
  "product-types": "productTypes",
  brands: "brands",
  suppliers: "suppliers",
  orders: "orders",
  customers: "customers",
  promotions: "promotions",
  "homepage-editor": "homepage",
  "home/hero": "homeHero",
  "home/promos": "homePromos",
  "home/product-types": "homeProductTypes",
  "home/benefits-bar": "homeBenefitsBar",
  "home/featured": "homeFeatured",
  "home/deals": "homeDeals",
  "home/brands": "homeBrands",
  "home/branches": "homeBranches",
  "home/benefits": "homeBenefits",
  "home/footer": "homeFooter",
  marketplace: "marketplace",
  branches: "branches",
  users: "users",
  settings: "settings",
  general: "general",
  popups: "popups",
  newsletter: "newsletter",
};

const VIEW_SLUGS: Record<ViewId, string> = {
  dashboard: "dashboard",
  products: "products",
  categories: "categories",
  productTypes: "product-types",
  brands: "brands",
  suppliers: "suppliers",
  orders: "orders",
  customers: "customers",
  promotions: "promotions",
  homepage: "homepage-editor",
  homeHero: "home/hero",
  homePromos: "home/promos",
  homeProductTypes: "home/product-types",
  homeBenefitsBar: "home/benefits-bar",
  homeFeatured: "home/featured",
  homeDeals: "home/deals",
  homeBrands: "home/brands",
  homeBranches: "home/branches",
  homeBenefits: "home/benefits",
  homeFooter: "home/footer",
  marketplace: "marketplace",
  branches: "branches",
  users: "users",
  settings: "settings",
  general: "general",
  popups: "popups",
  newsletter: "newsletter",
};

function useViewFromUrl(): [ViewId, (v: ViewId) => void] {
  const path = location.pathname.replace(/^\/+/g, "");
  const [view, setView] = useState<ViewId>(VIEW_PATHS[path] || "dashboard");

  // Ruta inexistente → redirigir a la raíz del proyecto
  useEffect(() => {
    if (!(path in VIEW_PATHS)) {
      history.replaceState(null, "", "/");
      setView("dashboard");
    }
  }, [path]);

  // Sync from URL on popstate (back/forward)
  useEffect(() => {
    const onPop = () => {
      const p = location.pathname.replace(/^\/+/g, "");
      if (!(p in VIEW_PATHS)) {
        history.replaceState(null, "", "/");
        setView("dashboard");
        return;
      }
      setView(VIEW_PATHS[p]);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((v: ViewId) => {
    setView(v);
    const slug = VIEW_SLUGS[v];
    if (slug === "dashboard") {
      history.pushState(null, "", "/");
    } else {
      history.pushState(null, "", `/${slug}`);
    }
  }, []);

  return [view, navigate];
}

const LABELS: Record<ViewId, string> = {
  dashboard: "Dashboard",
  products: "Productos",
  categories: "Categorías",
  productTypes: "Tipos de Producto",
  brands: "Marcas",
  suppliers: "Proveedores",
  orders: "Pedidos",
  customers: "Clientes",
  promotions: "Promociones",
  homepage: "Editor de Inicio",
  homeHero: "Banners publicitarios",
  homePromos: "Banners Promocionales",
  homeProductTypes: "Tipos de Producto",
  homeBenefitsBar: "Barra de Beneficios",
  homeFeatured: "Productos Destacados",
  homeDeals: "Ofertas del Día",
  homeBrands: "Marcas",
  homeBranches: "Sucursales",
  homeBenefits: "Beneficios",
  homeFooter: "Footer",
  marketplace: "Publicidad Marketplace",
  branches: "Sucursales",
  users: "Usuarios y Permisos",
  settings: "Configuración",
  general: "General",
  popups: "Popups",
  newsletter: "Newsletter",
};

const QUICK_COMMANDS = [
  {
    icon: LayoutDashboard,
    label: "Ir al Dashboard",
    view: "dashboard" as ViewId,
  },
  { icon: Plus, label: "Crear nuevo producto", view: "products" as ViewId },
  {
    icon: ShoppingCart,
    label: "Ver pedidos pendientes",
    view: "orders" as ViewId,
  },
  {
    icon: LayoutTemplate,
    label: "Editar página de inicio",
    view: "homepage" as ViewId,
  },
  { icon: Image, label: "Gestionar banners", view: "homeHero" as ViewId },
  {
    icon: Megaphone,
    label: "Campañas publicitarias",
    view: "marketplace" as ViewId,
  },
  { icon: Users, label: "Gestionar clientes", view: "customers" as ViewId },
  { icon: Percent, label: "Crear promoción", view: "promotions" as ViewId },
];

function CommandPalette({
  onNavigate,
  onClose,
}: {
  onNavigate: (v: ViewId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = QUICK_COMMANDS.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <Search size={16} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar o ejecutar comando..."
            className="flex-1 outline-none text-sm text-gray-800 placeholder-gray-400"
          />
          <kbd className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded font-mono">
            ESC
          </kbd>
        </div>
        <div className="py-2 max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Sin resultados
            </div>
          ) : (
            filtered.map((cmd) => (
              <button
                key={cmd.label}
                onClick={() => {
                  onNavigate(cmd.view);
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50 text-left transition-colors group"
              >
                <div className="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-amber-100 flex items-center justify-center shrink-0 transition-colors">
                  <cmd.icon
                    size={15}
                    className="text-gray-500 group-hover:text-amber-600"
                  />
                </div>
                <span className="text-sm text-gray-700">{cmd.label}</span>
                <ChevronRight
                  size={14}
                  className="ml-auto text-gray-300 group-hover:text-amber-400"
                />
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-2.5 border-t border-gray-100 flex items-center gap-4">
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <kbd className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">
              ↑↓
            </kbd>{" "}
            navegar
          </span>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <kbd className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">↵</kbd>{" "}
            abrir
          </span>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <kbd className="bg-gray-100 px-1.5 py-0.5 rounded font-mono">
              ESC
            </kbd>{" "}
            cerrar
          </span>
        </div>
      </div>
    </div>
  );
}

function Notifications({ onClose }: { onClose: () => void }) {
  const items = [
    {
      icon: AlertTriangle,
      color: "text-amber-500 bg-amber-50",
      title: "Stock bajo detectado",
      sub: "Leche Alquería — quedan 12 unidades",
      time: "hace 5m",
    },
    {
      icon: ShoppingCart,
      color: "text-blue-500 bg-blue-50",
      title: "Nuevo pedido #MC-3821",
      sub: "Total: $124.900 — Pago confirmado",
      time: "hace 12m",
    },
    {
      icon: Zap,
      color: "text-green-500 bg-green-50",
      title: "Campaña activada",
      sub: "Flash Sale Viernes — 47 productos",
      time: "hace 1h",
    },
    {
      icon: Users,
      color: "text-purple-500 bg-purple-50",
      title: "100 nuevos clientes hoy",
      sub: "+18% comparado con ayer",
      time: "hace 2h",
    },
  ];

  return (
    <div
      className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-40"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="font-semibold text-sm text-gray-900">
          Notificaciones
        </span>
        <button
          onClick={onClose}
          className="text-xs text-amber-600 hover:text-amber-700 font-medium"
        >
          Marcar todo como leído
        </button>
      </div>
      <div className="divide-y divide-gray-50">
        {items.map((n) => (
          <div
            key={n.title}
            className="flex gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
          >
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${n.color}`}
            >
              <n.icon size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">
                {n.title}
              </p>
              <p className="text-xs text-gray-500 truncate mt-0.5">{n.sub}</p>
            </div>
            <span className="text-xs text-gray-400 shrink-0">{n.time}</span>
          </div>
        ))}
      </div>
      <div className="px-4 py-2.5 border-t border-gray-100">
        <button className="text-xs text-gray-500 hover:text-gray-700 w-full text-center">
          Ver todas las notificaciones
        </button>
      </div>
    </div>
  );
}

function Sidebar({
  current,
  onNavigate,
  collapsed,
  unreviewedCount,
}: {
  current: ViewId;
  onNavigate: (v: ViewId) => void;
  collapsed: boolean;
  unreviewedCount: number;
}) {
  return (
    <aside
      className="flex flex-col h-full border-r border-white/[0.06] transition-all duration-300 [&_button:not(:disabled)]:cursor-pointer"
      style={{ background: "#0C0C0D", width: collapsed ? 56 : 240 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/[0.06] shrink-0">
        <img
          src={sidebarLogo}
          alt="Mercaldas"
          className={`shrink-0 object-contain ${collapsed ? "w-7 h-7" : "h-6 w-auto"}`}
        />
        {!collapsed && (
          <div>
            <p className="text-white font-bold text-sm leading-tight">
              Mercaldas
            </p>
            <p className="text-white/60 text-xs">Admin Panel</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {NAV.map((section) => (
          <div key={section.title} className="mb-4">
            {!collapsed && (
              <p className="text-white/50 text-[10px] font-semibold uppercase tracking-widest px-2 mb-1">
                {section.title}
              </p>
            )}
            {section.items.map((item) => {
              const active = current === item.id;
              const badge = item.id === "orders" && unreviewedCount > 0 ? unreviewedCount : item.badge;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  title={collapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium transition-all mb-0.5 group relative ${
                    active
                      ? "bg-white/10 text-amber-400"
                      : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <item.icon size={15} className="shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && badge && (
                    <span className="ml-auto bg-amber-400 text-amber-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {badge}
                    </span>
                  )}
                  {collapsed && badge && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function TopBar({
  current,
  onOpenCommand,
  collapsed,
  onToggleCollapse,
  user,
  onLogout,
}: {
  current: ViewId;
  onOpenCommand: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  user: UserProfile | null;
  onLogout: () => void;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => {
    const handler = () => {
      setNotifOpen(false);
      setUserOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const initials = user
    ? [user.firstName, user.lastName]
        .filter(Boolean)
        .map((n) => n?.[0] ?? "")
        .join("")
        .toUpperCase() || user.username?.[0]?.toUpperCase() || "U"
    : "JR";
  const displayName = user?.fullName || "Jorge Ramírez";
  const displayEmail = user?.email || "jorge@mercaldas.com";

  return (
    <header className="h-14 bg-white border-b border-gray-100 flex items-center gap-3 px-4 shrink-0 z-30">
      <button
        onClick={onToggleCollapse}
        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
      >
        <Menu size={16} />
      </button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-gray-400">Mercaldas</span>
        <ChevronRight size={14} className="text-gray-300" />
        <span className="text-gray-800 font-semibold">{LABELS[current]}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Search trigger */}
        <button
          onClick={onOpenCommand}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
        >
          <Search size={14} />
          <span className="hidden sm:inline">Buscar...</span>
          <kbd className="hidden sm:inline text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-mono">
            ⌘K
          </kbd>
        </button>

        {/* Notifications */}
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              setNotifOpen(!notifOpen);
              setUserOpen(false);
            }}
            className="relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <Bell size={16} />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-amber-400 rounded-full" />
          </button>
          {notifOpen && <Notifications onClose={() => setNotifOpen(false)} />}
        </div>

        {/* User */}
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              setUserOpen(!userOpen);
              setNotifOpen(false);
            }}
            className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <span className="text-xs font-bold text-white">{initials}</span>
            </div>
            <ChevronDown size={13} className="text-gray-400" />
          </button>
          {userOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-60 rounded-xl shadow-xl border border-white/[0.08] py-1.5 z-40 overflow-hidden"
              style={{ background: "#0C0C0D" }}
            >
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.06]">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-white">{initials}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/90 truncate">
                    {displayName}
                  </p>
                  <p className="text-xs text-white/50 truncate">{displayEmail}</p>
                </div>
              </div>
              <div className="pt-1">
                {[
                  { icon: User, label: "Mi perfil" },
                  { icon: HelpCircle, label: "Ayuda y soporte" },
                ].map((item) => (
                  <button
                    key={item.label}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors"
                  >
                    <item.icon size={14} className="text-white/40" />
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="border-t border-white/[0.06] mt-1 pt-1">
                <button
                  onClick={onLogout}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut size={14} />
                  Cerrar sesión
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function ViewRenderer({ view, user, onNavigate }: { view: ViewId; user: UserProfile | null; onNavigate: (v: ViewId) => void }) {
  const userName = user?.firstName || user?.fullName?.split(" ")[0] || "Usuario";
  
  switch (view) {
    case "dashboard":
      return <Dashboard userName={userName} onNavigate={(v) => onNavigate(v as ViewId)} />;
    case "products":
      return <Products />;
    case "orders":
      return <Orders />;
    case "customers":
      return <Customers />;
    case "categories":
      return <Categories />;
    case "productTypes":
      return <ProductTypes />;
    case "brands":
      return <Brands />;
    case "suppliers":
      return <Suppliers />;
    case "promotions":
      return <Promotions />;
    case "homepage":
      return <HomepageEditor />;
    case "homeHero":
      return <HomeHeroSection />;
    case "homePromos":
      return <HomePromosSection />;
    case "homeProductTypes":
      return <HomeProductTypesSection />;
    case "homeBenefitsBar":
      return <HomeBenefitsBarSection />;
    case "homeFeatured":
      return <HomeFeaturedSection />;
    case "homeDeals":
      return <HomeDealsSection />;
    case "homeBrands":
      return <HomeBrandsSection />;
    case "homeBranches":
      return <HomeBranchesSection />;
    case "homeBenefits":
      return <HomeBenefitsSection />;
    case "homeFooter":
      return <HomeFooterSection />;
    case "marketplace":
      return <Marketplace />;
    case "branches":
      return <Branches />;
    case "general":
      return <General />;
    case "popups":
      return <Popups />;
    case "newsletter":
      return <Newsletter />;
    case "users":
      return <UsersView />;
    case "settings":
      return <SettingsView />;
    default:
      return <Dashboard />;
  }
}

export default function App() {
  const [view, navigate] = useViewFromUrl();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authState, setAuthState] = useState<"loading" | "out" | "in">("loading");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
      if (e.key === "Escape") setCmdOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Fetch unreviewed orders count (solo cuando hay sesión válida)
  useEffect(() => {
    if (authState !== "in") return;
    const fetchCount = () => {
      ordersService.getUnreviewedCount().then((r) => setUnreviewedCount(r.count)).catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [authState]);

  // Valida la sesión contra el backend. `initial` distingue la carga inicial
  // (cualquier fallo manda al login) de una revalidación (solo un 401/403
  // cierra la sesión; un fallo de red transitorio no debe sacar al usuario).
  const checkSession = useCallback(async (initial = false) => {
    try {
      const profile = await authService.getProfile();
      setUser(profile);
      setAuthState("in");
    } catch (err) {
      const unauthorized =
        err instanceof AuthApiError && (err.status === 401 || err.status === 403);
      if (initial || unauthorized) {
        setUser(null);
        setAuthState("out");
      }
    }
  }, []);

  // Al montar: si no hay token vigente, siempre al login.
  useEffect(() => {
    void checkSession(true);
  }, [checkSession]);

  // Revalidar al volver a la pestaña o cambiar de ruta, para expulsar al login
  // apenas el token deje de ser válido aunque no se haya hecho ninguna petición.
  const authStateRef = useRef(authState);
  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  useEffect(() => {
    if (authState !== "in") return;
    const revalidate = () => void checkSession();
    const onVisibility = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authState, checkSession]);

  useEffect(() => {
    if (authStateRef.current !== "in") return;
    void checkSession();
  }, [view, checkSession]);

  // Si cualquier petición al API responde 401, volver al login.
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setAuthState("out");
    };
    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", onUnauthorized);
  }, []);

  const handleLogout = async () => {
    await authService.logout();
    setUser(null);
    setAuthState("out");
  };

  if (authState === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-[3px] border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authState === "out") {
    return (
      <Login
        onSuccess={(profile) => {
          setUser(profile);
          setAuthState("in");
        }}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar current={view} onNavigate={navigate} collapsed={collapsed} unreviewedCount={unreviewedCount} />

      <div className="flex flex-col flex-1 min-w-0">
        <TopBar
          current={view}
          onOpenCommand={() => setCmdOpen(true)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          user={user}
          onLogout={handleLogout}
        />
        <main className="flex-1 overflow-y-auto">
          <ViewRenderer view={view} user={user} onNavigate={(v) => navigate(v as ViewId)} />
        </main>
        <AppFooter />
      </div>

      {cmdOpen && (
        <CommandPalette
          onNavigate={navigate}
          onClose={() => setCmdOpen(false)}
        />
      )}
    </div>
  );
}
