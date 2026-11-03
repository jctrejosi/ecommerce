import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router";
import { useCustomerAuth } from "../hooks/useCustomerAuth";
import { consumeGoogleRedirect } from "./lib/googleAuth";
import { catalogService } from "../services/catalog.service";
import { ordersService } from "../services/orders.service";
import {
  customerAddressService,
  type CustomerAddress,
} from "../services/customer-auth.service";
import { useOrderSocket } from "../hooks/useOrderSocket";
import { useCustomerOrderEvents } from "../hooks/useCustomerOrderEvents";
import { useNotifications, isMobileDevice } from "../hooks/useNotifications";
import { useBackendStatus } from "../hooks/useBackendStatus";
import type { ThemeConfig } from "../hooks/useTheme";
import { ChatbotWidget } from "../components/ChatbotWidget";
import { OrderChatWidget } from "./components/OrderChatWidget";
import type { BotCart } from "../services/chatbot.service";
import { cartService, type CartQuote } from "../services/cart.service";
import { apiStatusService } from "../services/api-status.service";
import type {
  Brand,
  Branch,
  CartItem,
  CatalogCategory,
  Order,
  Product,
} from "./types";
import type { WompiConfigResponse } from "../services/orders.service";
import { ProductDetailModal } from "./ProductDetailModal";
import { CatalogPage } from "./Views/CatalogView";
import { UserAdminView } from "./Views/AccountView";
import type { AccountSection } from "./Views/AccountView";
import { LandingView } from "./Views/LandingView";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { CartDrawer } from "./components/CartDrawer";
import { AuthModal } from "./components/AuthModal";
import { CheckoutModal } from "./components/CheckoutModal";
import { ErrorPage } from "./components/ErrorPage";
import { OrdersPanel } from "./components/OrdersPanel";
import { OrderTrackingModal } from "./components/OrderTrackingModal";
import { PopupDisplay } from "./components/PopupDisplay";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(n);

type CatalogProductsQuery = {
  categories?: number[];
  categoryIds?: number[];
  productTypeCode?: string;
  onSale?: boolean;
  priceRange?: string;
  sort?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

let initialDataLoaded = false;

/** Clave del carrito del invitado en `localStorage` (el backend exige sesión para `/cart`). */
const CART_STORAGE_KEY = "mercaldas_cart_v1";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [currentView, setCurrentView] = useState<
    "home" | "catalog" | "account"
  >(
    location.pathname === "/catalog"
      ? "catalog"
      : location.pathname.startsWith("/account")
        ? "account"
        : "home",
  );

  useEffect(() => {
    if (location.pathname === "/catalog") setCurrentView("catalog");
    else if (location.pathname.startsWith("/account"))
      setCurrentView("account");
    else if (location.pathname === "/") setCurrentView("home");
    else {
      // Ruta inexistente → redirigir al home (reemplaza la URL)
      navigate("/", { replace: true });
    }
  }, [location.pathname, navigate]);

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartHydrated, setCartHydrated] = useState(false);
  /** Descuentos vigentes del carrito (los calcula el backend). */
  const [cartQuote, setCartQuote] = useState<CartQuote | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("");
  const [catalogCategory, setCatalogCategory] = useState<number[]>([]);
  const [catalogProductIds, setCatalogProductIds] = useState<number[]>([]);
  const [catalogOnSale, setCatalogOnSale] = useState(false);
  const [catalogPriceRange, setCatalogPriceRange] = useState<string>("all");
  const [catalogSort, setCatalogSort] = useState("relevancia");

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogBrand, setCatalogBrand] = useState<number | null>(null);
  const [catalogBranch, setCatalogBranch] = useState<number | null>(null);
  const [catalogProductType, setCatalogProductType] = useState("");
  const [loginModal, setLoginModal] = useState(false);
  const [modalView, setModalView] = useState<"choice" | "login" | "register">(
    "choice",
  );
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState(1);
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [checkoutAddress, setCheckoutAddress] = useState(() => {
    try {
      const a = localStorage.getItem("checkout_address");
      return a
        ? JSON.parse(a)
        : {
            name: "",
            phone: "",
            email: "",
            address: "",
            city: "Manizales",
            notes: "",
            lat: null,
            lng: null,
          };
    } catch {
      return {
        name: "",
        phone: "",
        email: "",
        address: "",
        city: "Manizales",
        notes: "",
        lat: null,
        lng: null,
      };
    }
  });
  /**
   * El cliente confirmó, en el mapa del checkout, que el marcador coincide con
   * su dirección. Es por pedido: no se persiste, para que cada compra vuelva a
   * validar el punto de entrega.
   */
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [checkoutShipping, setCheckoutShipping] = useState<
    "standard" | "express"
  >(() => {
    const s = localStorage.getItem("checkout_shipping");
    return s === "express" ? "express" : "standard";
  });
  const [checkoutPayment, setCheckoutPayment] = useState<
    "efectivo" | "tarjeta" | "nequi" | "pse" | "breb"
  >(() => {
    const p = localStorage.getItem("checkout_payment");
    return p === "tarjeta" || p === "nequi" || p === "pse" ? p : "efectivo";
  });
  const [checkoutCouponCode, setCheckoutCouponCode] = useState("");
  const [cardPayment, setCardPayment] = useState({
    cardholderName: "",
    cardNumber: "",
    expiryMonth: "",
    expiryYear: "",
    cvv: "",
    installments: "1",
  });
  const [psePayment, setPsePayment] = useState({
    bank: "",
    personType: "natural" as "natural" | "juridica",
  });
  const [nequiPayment, setNequiPayment] = useState({ phone: "" });
  const [lastOrderId, setLastOrderId] = useState("");
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [orderPending, setOrderPending] = useState(false);
  const [orderDeclineReason, setOrderDeclineReason] = useState<string | null>(
    null,
  );
  const watch = useOrderSocket(pendingOrderId);

  // Update order status from WebSocket
  useEffect(() => {
    if (watch.status) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === pendingOrderId
            ? {
                ...o,
                status: watch.status as
                  | "pendiente"
                  | "preparando"
                  | "en camino"
                  | "entregado"
                  | "cancelado",
              }
            : o,
        ),
      );
      if (watch.reason) setOrderDeclineReason(watch.reason);
      // La suscripción se mantiene hasta el estado final: así el cliente ve en
      // vivo "listo" (picking), "en camino" y "entregado" (repartidor).
      if (watch.status === "entregado" || watch.status === "cancelado")
        setPendingOrderId(null);
    }
  }, [watch.status, watch.reason, pendingOrderId]);

  const [wompiConfig, setWompiConfig] = useState<WompiConfigResponse | null>(
    null,
  );
  const [wompiEnabled, setWompiEnabled] = useState(true);
  const [brebEnabled, setBrebEnabled] = useState(true);
  const [brebKey, setBrebKey] = useState("@davi3148853458");
  const [brebBank, setBrebBank] = useState("Davivienda");

  const [efectivoEnabled, setEfectivoEnabled] = useState(true);
  const [wompiMethods, setWompiMethods] = useState({ card: true, pse: true, nequi: true });
  const [wompiAcceptance, setWompiAcceptance] = useState({
    terms: false,
    personalData: false,
  });
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Pedido que se está rastreando en el mapa (modal global).
  const [trackingOrderCode, setTrackingOrderCode] = useState<string | null>(null);
  const openTracker = useCallback((code: string) => {
    setOrdersOpen(false);
    setTrackingOrderCode(code);
  }, []);

  const [landingCategories, setLandingCategories] = useState<CatalogCategory[]>(
    [],
  );
  const [landingProducts, setLandingProducts] = useState<Product[]>([]);

  // Persistir datos de checkout
  useEffect(() => {
    localStorage.setItem("checkout_address", JSON.stringify(checkoutAddress));
  }, [checkoutAddress]);
  useEffect(() => {
    localStorage.setItem("checkout_shipping", checkoutShipping);
  }, [checkoutShipping]);
  useEffect(() => {
    localStorage.setItem("checkout_payment", checkoutPayment);
  }, [checkoutPayment]);
  const [landingLoading, setLandingLoading] = useState(true);
  const [dealProducts, setDealProducts] = useState<Product[]>([]);
  const [dailyDeals, setDailyDeals] = useState<{
    featuredItems: any[];
    carousel: Product[];
  } | null>(null);
  const [generalLogo, setGeneralLogo] = useState<{
    url?: string;
    title?: string;
    favicon?: string;
    /** Paletas claro/oscuro configuradas en el admin (/contenido/general). */
    theme?: ThemeConfig | null;
  } | null>(null);
  const [featuredBrands, setFeaturedBrands] = useState<Brand[]>([]);
  const [landingBranches, setLandingBranches] = useState<Branch[]>([]);
  const [landingFeaturedCategories, setLandingFeaturedCategories] = useState<
    { id: number; code: string; name: string; slug: string; imagePath: string | null; count: number }[]
  >([]);
  const [featuredTabs, setFeaturedTabs] = useState<
    { id: number; name: string; slug: string; position: number }[]
  >([]);
  const [apiError, setApiError] = useState<number | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);

  const {
    customer,
    loading: customerLoading,
    login,
    register,
    socialLogin,
    loginWithGoogleCode,
    updateProfile,
  } = useCustomerAuth();

  // Retorno del login con Google (redirección de página completa): la URL trae
  // `#access_token=…`. Se completa la sesión y se limpia el hash.
  const googleRedirectHandledRef = useRef(false);
  useEffect(() => {
    if (googleRedirectHandledRef.current) return;
    googleRedirectHandledRef.current = true;
    const accessToken = consumeGoogleRedirect();
    if (!accessToken) return;
    void (async () => {
      try {
        await loginWithGoogleCode(accessToken);
      } catch (error) {
        console.error("Login con Google falló:", error);
      }
    })();
  }, [loginWithGoogleCode]);
  // Cargar direcciones guardadas al abrir el checkout y sugerir la default
  useEffect(() => {
    if (checkoutOpen && customer) {
      customerAddressService
        .getAddresses()
        .then((addrs) => {
          setSavedAddresses(addrs);
          const suggested =
            addrs.find((a) => a.isDefault) ?? addrs[0] ?? null;
          // Prellenar datos de contacto desde el perfil y la dirección sugerida
          setCheckoutAddress((prev) => ({
            ...prev,
            name: prev.name || customer.fullName || "",
            phone: prev.phone || customer.phone || "",
            email: prev.email || customer.email || "",
            address: prev.address || suggested?.addressLine1 || "",
            city: prev.city || suggested?.city || "",
            notes: prev.notes || suggested?.deliveryInstructions || "",
          }));
        })
        .catch(() => setSavedAddresses([]));
    }
  }, [checkoutOpen, customer]);
  const { notifications, unreadCount, markAsRead, requestPhoneLocation } =
    useNotifications(customer?.id ?? null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [pendingPostLoginAction, setPendingPostLoginAction] = useState<
    null | "addresses" | "checkout"
  >(null);

  // Redirect /account to / if not logged in
  useEffect(() => {
    if (customerLoading) return;
    if (location.pathname.startsWith("/account") && !customer) {
      navigate("/", { replace: true });
    }
  }, [location.pathname, customer, customerLoading]);

  // ── Monitor de disponibilidad del backend ────────────────
  // Vía WebSocket (`/status`): socket.io reconecta solo cuando el backend
  // vuelve a estar disponible y el servidor emite `backend:online`.
  // Si estaba caído y vuelve, avisa al usuario y recarga el sitio.
  const { online } = useBackendStatus();
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [reloadingSite, setReloadingSite] = useState(false);
  const prevOnline = useRef<boolean | null>(null);

  useEffect(() => {
    if (online === null) return;

    const wasOffline = prevOnline.current === false;
    prevOnline.current = online;
    setBackendOnline(online);

    // Transición caído → disponible: alerta + recarga.
    // (Los side effects van fuera del updater de estado: un updater debe ser
    // puro, React puede invocarlo más de una vez.)
    if (wasOffline && online === true) {
      setReloadingSite(true);
      setTimeout(() => window.location.reload(), 1500);
    }
  }, [online]);

  // Título de la pestaña del navegador: configurable en el admin, siempre con sufijo "| DSI".
  useEffect(() => {
    const base = (generalLogo?.title || "Mercaldas").trim();
    document.title = `${base} | DSI`;
  }, [generalLogo]);

  // Favicon de la pestaña: configurable en el admin. Si no hay favicon propio,
  // se usa el logo de la empresa; si tampoco, se deja el /favicon.png estático.
  useEffect(() => {
    const href = (generalLogo?.favicon || generalLogo?.url || "").trim();
    if (!href) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.type = "image/png";
    link.href = href;
  }, [generalLogo]);

  useEffect(() => {
    if (initialDataLoaded) return;
    initialDataLoaded = true;

    // Health check first — must succeed before loading data
    apiStatusService
      .waitUntilReady()
      .then(() => {
        setHealthChecked(true);
        void catalogService
          .getCategories()
          .then(setLandingCategories)
          .catch(() => {});
        void catalogService
          .getProducts({ onSale: true, sort: "descuento", limit: 60 })
          .then((ps) => setDealProducts(ps.filter((p) => p.image).slice(0, 12)))
          .catch(() => {});
        // Config de Ofertas del día (display rotativo + carousel administrados)
        void fetch(`${(import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"))}/landing/daily-deals`)
          .then((r) => (r.ok ? r.json() : null))
          .then(setDailyDeals)
          .catch(() => setDailyDeals(null));
        void fetch(`${(import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"))}/landing/general`)
          .then((r) => (r.ok ? r.json() : null))
          .then(setGeneralLogo)
          .catch(() => setGeneralLogo(null));
        // Marcas de la landing (configuradas en admin; fallback: destacadas)
        void fetch(`${(import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"))}/landing/brands`)
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then(setFeaturedBrands)
          .catch(() =>
            catalogService
              .getFeaturedBrands()
              .then(setFeaturedBrands)
              .catch(() => {}),
          );
        void catalogService
          .getBranches()
          .then((list) => {
            setLandingBranches(list);
            // Por defecto se muestra el precio de la sucursal 1 del ERP.
            setCatalogBranch((prev) => {
              if (prev != null) return prev;
              const primary = list.find(
                (b) => String(b.code ?? "").replace(/^0+/, "") === "1",
              );
              return primary?.id ?? list[0]?.id ?? null;
            });
          })
          .catch(() => {});
        void catalogService
          .getFeaturedCategories()
          .then(setLandingFeaturedCategories)
          .catch(() => {});
        void catalogService
          .getFeaturedTabs()
          .then((tabs) => {
            setFeaturedTabs(tabs);
            if (tabs.length > 0) setActiveTab(tabs[0].slug);
          })
          .catch(() => {});
      })
      .catch(() => {
        setHealthChecked(true); // salir del loading para mostrar ErrorPage
        setApiError(502);
      });
  }, []);

  const fetchLandingProducts = useCallback(async (tab: string) => {
    setLandingLoading(true);
    try {
      if (tab) {
        setLandingProducts(
          await catalogService.getFeaturedTabProducts(
            tab,
            catalogBranch ?? undefined,
          ),
        );
      } else {
        setLandingProducts([]);
      }
    } catch {
      setLandingProducts([]);
    } finally {
      setLandingLoading(false);
    }
  }, [catalogBranch]);

  useEffect(() => {
    void fetchLandingProducts(activeTab);
  }, [activeTab, fetchLandingProducts]);

  const handleLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      await login(fd.get("email") as string, fd.get("password") as string);
      setLoginModal(false);
      const action = pendingPostLoginAction;
      setPendingPostLoginAction(null);
      if (action === "addresses") {
        setCurrentView("account");
        navigate("/account?tab=addresses");
      } else if (action === "checkout" || cartItems.length > 0) {
        setCheckoutStep(1);
        setCheckoutOpen(true);
      }
    } catch (err: any) {
      setAuthError(err.message || "Error");
    } finally {
      setAuthLoading(false);
    }
  };
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    try {
      await register({
        email: fd.get("email") as string,
        password: fd.get("password") as string,
        firstName: fd.get("firstName") as string,
        lastName: fd.get("lastName") as string,
        phone: fd.get("phone") as string,
        acceptsTerms: true,
      });
      setLoginModal(false);
      setAuthLoading(false);
    } catch (err: any) {
      setAuthError(err.message || "Error");
      setAuthLoading(false);
    }
  };

  // Carrito persistente. Invitado → `localStorage` (el backend exige sesión para
  // `/cart`). Usuario logueado → el servidor es la fuente de verdad; al iniciar
  // sesión se migra el carrito de invitado y se limpia la copia local.
  const localHydratedRef = useRef(false);

  useEffect(() => {
    if (customerLoading) return;

    if (customer) {
      // Con sesión, la copia local del invitado ya no aplica.
      try {
        localStorage.removeItem(CART_STORAGE_KEY);
      } catch {
        /* almacenamiento no disponible */
      }

      void cartService
        .getCart()
        .then((r) => {
          setCartItems((prev) => {
            const m = new Map<number, CartItem>();
            r.items
              .filter((i) => i.id && Number(i.id) > 0)
              .forEach((i) => m.set(i.id, { ...i }));
            prev.forEach((i) => {
              const e = m.get(i.id);
              if (e) m.set(i.id, { ...e, quantity: e.quantity + i.quantity });
              else m.set(i.id, i);
            });
            return [...m.values()];
          });
          setCartHydrated(true);
        })
        .catch(() => setCartHydrated(true));
      return;
    }

    // Invitado: restaurar el carrito guardado una sola vez por carga de página.
    if (!localHydratedRef.current) {
      localHydratedRef.current = true;
      try {
        const raw = localStorage.getItem(CART_STORAGE_KEY);
        if (raw) {
          const items = (JSON.parse(raw) as CartItem[]).filter(
            (i) => i && Number(i.id) > 0 && Number(i.quantity) > 0,
          );
          setCartItems(items);
        }
      } catch {
        /* carrito guardado corrupto: se ignora */
      }
    }
    setCartHydrated(true);
  }, [customer, customerLoading]);

  // Persistir el carrito del invitado en cada cambio (solo tras hidratar).
  useEffect(() => {
    if (!cartHydrated || customerLoading || customer) return;
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems));
    } catch {
      /* almacenamiento no disponible */
    }
  }, [cartItems, cartHydrated, customer, customerLoading]);

  useEffect(() => {
    if (customer && cartHydrated) {
      const valid = cartItems.filter((i) => i.id && Number(i.id) > 0);
      if (valid.length > 0)
        void cartService.updateCart(
          valid.map((i) => ({ productId: Number(i.id), quantity: i.quantity })),
        );
    }
  }, [cartHydrated, cartItems, customer]);

  // Cotización del carrito (promociones vigentes) para mostrar el descuento sin
  // esperar al checkout. Se debounce para no consultar en cada clic.
  useEffect(() => {
    const valid = cartItems.filter(
      (i) => i.id && Number(i.id) > 0 && i.quantity > 0,
    );
    if (valid.length === 0) {
      setCartQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      cartService
        .quote(
          valid.map((i) => ({
            productId: Number(i.id),
            quantity: i.quantity,
          })),
        )
        .then((quote) => {
          if (!cancelled) setCartQuote(quote);
        })
        .catch(() => {
          if (!cancelled) setCartQuote(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cartItems]);

  // Load orders
  const refreshOrders = useCallback(
    () =>
      ordersService
        .getOrders()
        .then(setOrders)
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    if (customer && !customerLoading) {
      void refreshOrders();
    }
  }, [customer, customerLoading, refreshOrders]);

  // En vivo: cualquier cambio de estado de MIS pedidos (picking, reparto o
  // pagos) refresca la lista, con un pequeño debounce para no disparar en
  // ráfaga cuando el picker escanea varios productos seguidos.
  const ordersLiveTimer = useRef<number | null>(null);
  useCustomerOrderEvents(customer?.id ?? null, () => {
    if (ordersLiveTimer.current) window.clearTimeout(ordersLiveTimer.current);
    ordersLiveTimer.current = window.setTimeout(() => {
      ordersLiveTimer.current = null;
      void refreshOrders();
    }, 900);
  });

  useEffect(() => {
    return () => {
      if (ordersLiveTimer.current) window.clearTimeout(ordersLiveTimer.current);
    };
  }, []);

  const addToCart = (p: Product, q: number = 1) => {
    if (!p.id || Number(p.id) <= 0) return;
    setCartItems((prev) => {
      const e = prev.find((c) => c.id === p.id);
      return e
        ? prev.map((c) =>
            c.id === p.id ? { ...c, quantity: c.quantity + q } : c,
          )
        : [...prev, { ...p, quantity: q }];
    });
  };
  const removeFromCart = (id: number) =>
    setCartItems((prev) => {
      const e = prev.find((c) => c.id === id);
      return !e
        ? prev
        : e.quantity === 1
          ? prev.filter((c) => c.id !== id)
          : prev.map((c) =>
              c.id === id ? { ...c, quantity: c.quantity - 1 } : c,
            );
    });
  const deleteFromCart = (id: number) =>
    setCartItems((prev) => prev.filter((c) => c.id !== id));
  const replaceCart = (
    items: Array<{
      id: number;
      name: string;
      price: number;
      image?: string;
      quantity: number;
    }>,
  ) => setCartItems(items.map((i) => ({ ...i, quantity: i.quantity })));

  // Carrito armado por el chatbot → lo carga en el carrito del sitio y lo abre.
  const applyBotCart = (cart: BotCart) => {
    replaceCart(
      cart.items.map((it) => ({
        id: it.product_id,
        name: it.name,
        price: it.price,
        image: it.image ?? undefined,
        quantity: it.quantity,
      })),
    );
    setCartOpen(true);
  };

  const openCatalog = (categoryId?: number) => {
    if (typeof categoryId === "number") {
      // El dropdown "Nuestros productos" pasa la categoría: aplicarla en el catálogo.
      setCatalogCategory([categoryId]);
      setCatalogProductIds([]);
      setCatalogBrand(null);
      setCatalogProductType("");
      setCatalogSearch("");
    } else {
      // Vista completa ("Ver catálogo completo" / "Ver todos los productos"):
      // limpiar TODOS los filtros para que el catálogo no salga vacío.
      setCatalogCategory([]);
      setCatalogProductIds([]);
      setCatalogBrand(null);
      setCatalogProductType("");
      setCatalogOnSale(false);
      setCatalogPriceRange("all");
      setCatalogSearch("");
    }
    setCurrentView("catalog");
    navigate("/catalog");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  /**
   * Búsqueda desde el header: abre el catálogo CON el término buscado.
   * No debe pasar por openCatalog(), porque ese limpia la búsqueda.
   */
  const openCatalogWithSearch = (search: string) => {
    setCatalogCategory([]);
    setCatalogProductIds([]);
    setCatalogBrand(null);
    setCatalogProductType("");
    setCatalogOnSale(false);
    setCatalogPriceRange("all");
    setCatalogSearch(search);
    setCurrentView("catalog");
    navigate("/catalog");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openModal = (v: "choice" | "login" | "register") => {
    if (customer) {
      setLoginModal(false);
      return;
    }
    setModalView(v);
    setLoginModal(true);
  };
  const closeModal = () => setLoginModal(false);
  const cartTotal = cartItems.reduce((s, c) => s + c.price * c.quantity, 0);
  const cartCount = cartItems.reduce((s, c) => s + c.quantity, 0);
  const handleCategoryClick = (n: string) => {
    setCatalogSearch(n);
    setCatalogBrand(null);
    setCatalogProductIds([]);
    setCurrentView("catalog");
    navigate("/catalog");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const handleBrandClick = (brandId: number) => {
    setCatalogBrand(brandId);
    setCatalogCategory([]);
    setCatalogProductIds([]);
    setCatalogSearch("");
    setCurrentView("catalog");
    navigate("/catalog");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const handleApplyFilter = (f: {
    categoryIds?: number[];
    productIds?: number[];
    brandId?: number | null;
    productTypeCode?: string;
    onSale?: boolean;
    search?: string;
    sort?: string;
    priceMin?: number;
    priceMax?: number;
  }) => {
    if (f.categoryIds?.length) setCatalogCategory(f.categoryIds);
    else setCatalogCategory([]);
    setCatalogProductIds(f.productIds?.length ? f.productIds : []);
    setCatalogBrand(f.brandId ?? null);
    setCatalogProductType(f.productTypeCode ?? "");
    setCatalogOnSale(f.onSale ?? false);
    setCatalogSearch(f.search ?? "");
    if (f.sort) setCatalogSort(f.sort);
    if (f.priceMin !== undefined || f.priceMax !== undefined) {
      setCatalogPriceRange("custom");
    } else {
      setCatalogPriceRange("all");
    }
    setCurrentView("catalog");
    navigate("/catalog");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleFeaturedCategoryClick = (categoryId: number) => {
    handleApplyFilter({ categoryIds: [categoryId] });
  };

  const handleAddressClick = () => {
    if (customer) {
      setCurrentView("account");
      navigate("/account?tab=addresses");
      return;
    }
    setPendingPostLoginAction("addresses");
    openModal("login");
  };

  const placeOrder = async (options?: { skipPayment?: boolean }) => {
    try {
      setCheckoutLoading(true);
      setCheckoutError(null);

      // Tokenize card with Wompi
      let cardToken = "";
      let last4 = "";
      let brand = "";
      if (checkoutPayment === "tarjeta" && !options?.skipPayment) {
        if (!wompiConfig || !wompiConfig.publicKey) {
          setCheckoutError(
            "El pago con tarjeta no está disponible en este momento. Intenta con otro medio de pago o recarga la página.",
          );
          setCheckoutLoading(false);
          return;
        }
        const tokenized = await ordersService.tokenizeWompiCard({
          publicKey: wompiConfig.publicKey,
          number: cardPayment.cardNumber.replace(/\s/g, ""),
          cvc: cardPayment.cvv,
          expMonth: cardPayment.expiryMonth,
          expYear: cardPayment.expiryYear,
          cardHolder: cardPayment.cardholderName,
        });
        cardToken = tokenized.id;
        last4 = tokenized.last_four;
        brand = tokenized.brand;
      }

      const payload = {
        items: cartItems
          .filter((i) => i.id && Number(i.id) > 0)
          .map((i) => ({ productId: Number(i.id), quantity: i.quantity })),
        address: {
          name: checkoutAddress.name,
          phone: checkoutAddress.phone,
          email: checkoutAddress.email || undefined,
          address: checkoutAddress.address,
          city: checkoutAddress.city,
          notes: checkoutAddress.notes,
          // Punto confirmado en el mapa: sin él el repartidor no tiene a dónde
          // trazar la ruta (el backend lo guarda como POINT).
          lat: checkoutAddress.lat ?? undefined,
          lng: checkoutAddress.lng ?? undefined,
        },
        shippingType: checkoutShipping,
        // Si el cupón cubre el total no hay pasarela: se registra como efectivo
        // para que el backend no exija datos de tarjeta/PSE/Nequi.
        paymentMethod: options?.skipPayment ? "efectivo" : checkoutPayment,
        couponCode: checkoutCouponCode.trim() || undefined,
      };
      if (checkoutPayment === "tarjeta" && !options?.skipPayment) {
        payload.paymentDetails = {
          card: {
            provider: "wompi",
            cardholderName: cardPayment.cardholderName,
            cardToken,
            last4,
            brand,
            installments: parseInt(cardPayment.installments) || 1,
            acceptanceToken: wompiConfig?.acceptanceToken ?? "",
            acceptPersonalAuth: wompiConfig?.personalDataAuthToken ?? "",
          },
        };
      }
      if (checkoutPayment === "pse") {
        payload.paymentDetails = { pse: psePayment };
      }
      if (checkoutPayment === "nequi") {
        payload.paymentDetails = { nequi: nequiPayment };
      }

      if (payload.items.length === 0) {
        setCheckoutError(
          "El carrito está vacío o contiene productos no disponibles",
        );
        setCheckoutLoading(false);
        return;
      }

      // Compra sin iniciar sesión: el backend crea la sesión invitado sola.
      const response = customer
        ? await ordersService.checkout(payload)
        : await ordersService.checkoutGuest(payload);
      const o = {
        id: response.referenceCode,
        date: new Date().toLocaleDateString("es-CO", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        }),
        items: [...cartItems],
        total: response.grandTotal,
        shipping: response.shippingCost,
        address: response.address.address + ", " + response.address.city,
        paymentMethod: response.paymentMethod,
        status: ((s) =>
          s === "payment_pending" || s === "created"
            ? "pendiente"
            : "preparando")(response.status),
      };
      setOrders((prev) => [o, ...prev]);
      setLastOrderId(response.referenceCode);
      setCartItems([]);
      setCheckoutCouponCode("");
      setOrderPending(response.status === "payment_pending");
      setCheckoutStep(4);

      // Subscribe to WebSocket for real-time updates
      setPendingOrderId(response.referenceCode);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Error");
    } finally {
      setCheckoutLoading(false);
    }
  };

  useEffect(() => {
    // Cargar medios de pago habilitados primero
    fetch(`${(import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"))}/payments/methods`)
      .then((r) => r.json())
      .then((d) => {
        const wompiOn = d?.wompi?.enabled ?? true;
        setWompiEnabled(wompiOn);
        setBrebEnabled(d?.breb?.enabled ?? true);
        setBrebKey(d?.breb?.key ?? "@davi3148853458");
        setBrebBank(d?.breb?.bank ?? "Davivienda");
        setEfectivoEnabled(d?.efectivo?.enabled ?? true);
        setWompiMethods({
          card: d?.wompi?.methods?.card ?? true,
          pse: d?.wompi?.methods?.pse ?? true,
          nequi: d?.wompi?.methods?.nequi ?? true,
        });
        // Solo cargar config de Wompi si está habilitado
        if (wompiOn) {
          void ordersService
            .getWompiConfig()
            .then((cfg) => {
              if (cfg && cfg.publicKey) {
                setWompiConfig(cfg);
              } else {
                // Sin llave pública no se puede tokenizar ni ofrecer el método
                setWompiConfig(null);
                setWompiEnabled(false);
              }
            })
            .catch(() => {
              setWompiConfig(null);
              setWompiEnabled(false);
            });
        }
      })
      .catch(() => {});
  }, []);
  const handleSocialSuccess = () => {
    setLoginModal(false);
    const action = pendingPostLoginAction;
    setPendingPostLoginAction(null);
    if (action === "addresses") {
      setCurrentView("account");
      navigate("/account?tab=addresses");
    } else if (cartItems.length > 0) {
      setCheckoutStep(1);
      setCheckoutOpen(true);
    }
  };
  const handleSocialError = (e: unknown) =>
    setAuthError(e instanceof Error ? e.message : "Error");

  const headerProps: any = {
    cartCount,
    categories: landingCategories,
    customer,
    customerLoading,
    ordersCount: orders.length,
    cartItems,
    onCartOpen: () => setCartOpen(true),
    onOrdersOpen: () => {
      setSelectedOrder(null);
      setOrdersOpen(true);
    },
    onLoginModal: openModal,
    onCatalogSearch: openCatalogWithSearch,
    onOpenCatalog: openCatalog,
    onAddToCart: addToCart,
    onRemoveFromCart: removeFromCart,
    currentView,
    onHome: () => {
      setCurrentView("home");
      navigate("/");
    },
    onAccount: customer
      ? () => {
          setCurrentView("account");
          navigate("/account");
        }
      : undefined,
    onNavigateNotifs: customer
      ? () => {
          setCurrentView("account");
          navigate("/account?tab=notifications");
        }
      : undefined,
    onAddressClick: handleAddressClick,
    notifications,
    unreadNotifCount: unreadCount,
    onMarkNotifRead: markAsRead,
    onTrackOrder: openTracker,
    fmt,
    generalLogo,
  };

  // Health check -- must be AFTER all hooks
  if (!healthChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground font-medium">
            Conectando...
          </p>
        </div>
      </div>
    );
  }

  if (apiError) {
    return (
      <ErrorPage
        statusCode={apiError >= 500 ? (apiError as 500 | 502 | 503) : 502}
        onRetry={() => {
          setApiError(null);
          setHealthChecked(false);
          window.location.reload();
        }}
        onGoHome={() => {
          window.location.href = "/";
        }}
      />
    );
  }

  return (
    <div
      className="min-h-screen bg-background overflow-x-clip pb-[var(--safe-bottom)]"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <Header {...headerProps} />

      {currentView === "catalog" && (
        <CatalogPage
          cartItems={cartItems}
          onAdd={addToCart}
          onRemove={removeFromCart}
          onBack={() => {
            navigate("/");
            setCurrentView("home");
            window.scrollTo(0, 0);
          }}
          onProductClick={setSelectedProduct}
          onOpenCategory={openCatalog}
          catalogCategory={catalogCategory}
          setCatalogCategory={setCatalogCategory}
          catalogProductIds={catalogProductIds}
          setCatalogProductIds={setCatalogProductIds}
          catalogOnSale={catalogOnSale}
          setCatalogOnSale={setCatalogOnSale}
          catalogPriceRange={catalogPriceRange}
          setCatalogPriceRange={setCatalogPriceRange}
          catalogSort={catalogSort}
          setCatalogSort={setCatalogSort}
          catalogSearch={catalogSearch}
          setCatalogSearch={setCatalogSearch}
          catalogBrand={catalogBrand}
          setCatalogBrand={setCatalogBrand}
          catalogBranch={catalogBranch}
          setCatalogBranch={setCatalogBranch}
          catalogProductType={catalogProductType}
          setCatalogProductType={setCatalogProductType}
          mobileFiltersOpen={mobileFiltersOpen}
          setMobileFiltersOpen={setMobileFiltersOpen}
          catalogCategories={landingCategories}
        />
      )}

      {currentView === "account" && (
        <UserAdminView
          appOrders={orders}
          cartItems={cartItems}
          customer={customer}
          onAdd={addToCart}
          onRemove={removeFromCart}
          onProductClick={setSelectedProduct}
          onBack={() => {
            setCurrentView("home");
            navigate("/");
            window.scrollTo(0, 0);
          }}
          onViewCatalog={openCatalog}
          initialSection={
            (new URLSearchParams(location.search).get(
              "tab",
            ) as AccountSection) || undefined
          }
          notifications={notifications}
          unreadNotifCount={unreadCount}
          onMarkNotifRead={markAsRead}
          onReplaceCart={replaceCart}
          onProfileUpdated={updateProfile}
          onOpenTracking={openTracker}
        />
      )}

      <main className={currentView !== "home" ? "hidden" : ""}>
        <LandingView
          categories={landingCategories}
          products={landingProducts}
          loading={landingLoading}
          activeTab={activeTab}
          dealProducts={dealProducts}
          dailyDeals={dailyDeals}
          cartItems={cartItems}
          onTabChange={setActiveTab}
          onAdd={addToCart}
          onRemove={removeFromCart}
          onProductClick={setSelectedProduct}
          onCategoryClick={openCatalog}
          onViewCatalog={openCatalog}
          featuredBrands={featuredBrands}
          branches={landingBranches}
          onBrandClick={handleBrandClick}
          featuredCategories={landingFeaturedCategories}
          onFeaturedCategoryClick={handleFeaturedCategoryClick}
          featuredTabs={featuredTabs}
          onApplyFilter={handleApplyFilter}
        />
      </main>

      {/* Los popups solo aparecen en la página de inicio (landing) */}
      {currentView === "home" && (
        <PopupDisplay onApplyFilter={handleApplyFilter} />
      )}
      <Footer
        categories={landingCategories}
        onCategoryClick={handleCategoryClick}
        generalLogo={generalLogo}
      />
      <CartDrawer
        cartOpen={cartOpen}
        cartItems={cartItems}
        cartCount={cartCount}
        cartTotal={cartTotal}
        discountTotal={cartQuote?.discountTotal ?? 0}
        promotions={cartQuote?.appliedPromotions ?? []}
        onClose={() => setCartOpen(false)}
        onAdd={addToCart}
        onRemove={removeFromCart}
        onDelete={deleteFromCart}
        onCheckout={() => {
          setCartOpen(false);
          setCheckoutStep(1);
          setCheckoutOpen(true);
        }}
        fmt={fmt}
      />
      <ProductDetailModal
        product={selectedProduct}
        branchId={catalogBranch}
        cartItems={cartItems}
        onAdd={addToCart}
        onRemove={removeFromCart}
        onClose={() => setSelectedProduct(null)}
      />
      <AuthModal
        loginModal={loginModal}
        modalView={modalView}
        authError={authError}
        authLoading={authLoading}
        cartItems={cartItems}
        socialLogin={socialLogin}
        onClose={closeModal}
        onSetModalView={setModalView}
        onLoginSubmit={handleLoginSubmit}
        onRegisterSubmit={handleRegisterSubmit}
        onSocialSuccess={handleSocialSuccess}
        onSocialError={handleSocialError}
      />
      <CheckoutModal
        checkoutOpen={checkoutOpen}
        checkoutStep={checkoutStep}
        cartItems={cartItems}
        cartTotal={cartTotal}
        promotionDiscount={cartQuote?.discountTotal ?? 0}
        checkoutAddress={checkoutAddress}
        addressConfirmed={addressConfirmed}
        onSetAddressConfirmed={setAddressConfirmed}
        savedAddresses={savedAddresses}
        customerName={customer?.fullName ?? ""}
        customerPhone={customer?.phone ?? ""}
        checkoutShipping={checkoutShipping}
        checkoutPayment={checkoutPayment}
        checkoutCouponCode={checkoutCouponCode}
        onSetCheckoutCouponCode={setCheckoutCouponCode}
        checkoutLoading={checkoutLoading}
        checkoutError={checkoutError}
        cardPayment={cardPayment}
        wompiAcceptance={wompiAcceptance}
        wompiConfig={wompiConfig}
        wompiEnabled={wompiEnabled}
        wompiMethods={wompiMethods}
        brebEnabled={brebEnabled}
        brebKey={brebKey}
        brebBank={brebBank}
        efectivoEnabled={efectivoEnabled}
        psePayment={psePayment}
        nequiPayment={nequiPayment}
        lastOrderId={lastOrderId}
        onClose={() => setCheckoutOpen(false)}
        onViewOrders={() => {
          // "Ver mis pedidos" desde la confirmación: cierra el checkout y abre la
          // lista de pedidos (el pedido recién creado ya está en `orders`).
          setCheckoutOpen(false);
          setSelectedOrder(null);
          setOrdersOpen(true);
        }}
        onSetCheckoutStep={setCheckoutStep}
        onSetCheckoutAddress={setCheckoutAddress}
        onSetCheckoutShipping={setCheckoutShipping}
        onSetCheckoutPayment={setCheckoutPayment}
        onSetCardPayment={setCardPayment}
        onSetWompiAcceptance={setWompiAcceptance}
        onSetPsePayment={setPsePayment}
        onSetNequiPayment={setNequiPayment}
        onPlaceOrder={placeOrder}
        orderPending={orderPending}
        orderDeclineReason={orderDeclineReason}
        onRequestLocation={requestPhoneLocation}
        isMobileDevice={isMobileDevice()}
        fmt={fmt}
      />
      <OrdersPanel
        ordersOpen={ordersOpen}
        orders={orders}
        selectedOrder={selectedOrder}
        onClose={() => {
          setOrdersOpen(false);
          setSelectedOrder(null);
        }}
        onSelectOrder={setSelectedOrder}
        onGoToCatalog={() => {
          // Cierra el panel y abre el catálogo SIN filtros (openCatalog() limpia).
          setOrdersOpen(false);
          setSelectedOrder(null);
          openCatalog();
        }}
        onTrackOrder={openTracker}
        fmt={fmt}
      />

      {/* Rastreo de pedido en el mapa (notificaciones, modal de pedidos, cuenta) */}
      {trackingOrderCode && (
        <OrderTrackingModal
          orderCode={trackingOrderCode}
          onClose={() => setTrackingOrderCode(null)}
        />
      )}

      {/* Acciones flotantes (chat de pedido + bot): un solo contenedor en la
          esquina inferior derecha, apilados para que no se solapen. */}
      <div className="fixed right-3 bottom-[calc(1rem_+_var(--safe-bottom))] sm:right-5 sm:bottom-[calc(1.25rem_+_var(--safe-bottom))] z-[90] flex flex-col items-center gap-[13px]">
        {/* Chat por pedido (repartidor ↔ cliente) cuando hay pedidos en camino */}
        <OrderChatWidget orders={orders} />

        {/* Chatbot de compras */}
        <ChatbotWidget
          onAddProduct={addToCart}
          onApplyCart={applyBotCart}
          pageCartItems={cartItems}
        />
      </div>

      {/* Aviso de backend caído */}
      {backendOnline === false && !reloadingSite && (
        <div className="fixed bottom-[calc(1rem_+_var(--safe-bottom))] left-1/2 -translate-x-1/2 z-[100] bg-secondary text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Sin conexión con el servidor — reintentando...
        </div>
      )}

      {/* Alerta de reconexión → recarga del sitio */}
      {reloadingSite && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl px-8 py-6 text-center max-w-sm mx-4">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <span className="w-5 h-5 rounded-full bg-green-500 animate-ping" />
            </div>
            <p className="font-bold text-foreground">Servidor disponible</p>
            <p className="text-xs text-muted-foreground mt-1">
              La conexión se restableció. Recargando el sitio...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
