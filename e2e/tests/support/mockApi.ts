import type { Page, Route } from "@playwright/test";
import { API_ORIGIN } from "./urls";

/**
 * Mock de la API para las 4 SPAs.
 *
 * Las SPAs apuntan a `http://localhost:3000` (VITE_API_URL) y llaman rutas
 * raíz (`/catalog/products`, `/auth/login`…), NO bajo `/api`. Por eso se
 * intercepta el origen completo del API y, además, `**\/api/**` por si el
 * despliegue monta el backend detrás de ese prefijo.
 *
 * Todo lo que necesita el UI se responde con fixtures en memoria; no se toca
 * el backend real ni la base de datos.
 */

export type ApiMockState = {
  /** Se pone en true al responder POST /auth/login. */
  loggedIn: boolean;
  /** Repartidores que devuelve /delivery/admin/drivers. */
  drivers: unknown[];
};

/** Usuario que satisface el perfil de admin, picking y delivery. */
export const MOCK_ADMIN_USER = {
  id: 1,
  email: "admin@mercaldas.test",
  username: "admin-ecommerce",
  firstName: "Ana",
  lastName: "Admin",
  fullName: "Ana Admin",
  phone: "3001234567",
  avatarUrl: null,
  isSuperuser: true,
  isActive: true,
  branchId: null,
  branchName: null,
  roles: ["superuser"],
  permissions: ["*"],
  lastLoginAt: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

export const MOCK_CUSTOMER = {
  id: 10,
  email: "cliente@mercaldas.test",
  firstName: "Cliente",
  lastName: "Prueba",
  fullName: "Cliente Prueba",
  phone: "3009876543",
  isVerified: true,
  isActive: true,
  provider: null,
  avatarUrl: null,
  acceptsMarketing: false,
};

export const MOCK_PRODUCTS = [
  {
    id: 101,
    externalId: "LEC-101",
    slug: "leche-entera-test-1l",
    name: "Leche Entera Test 1L",
    description: "Leche entera de prueba",
    price: 4500,
    originalPrice: 5000,
    image: "",
    images: [],
    category: "Lácteos",
    categoryId: 1,
    brandId: 1,
    brandName: "Marca Test",
    productTypeCode: "LACTEOS",
    productTypeName: "Lácteos",
    badge: "Oferta",
    unit: "1 L",
    stock: 10,
    isActive: true,
    isFeatured: true,
  },
  {
    id: 102,
    externalId: "ARR-102",
    slug: "arroz-premium-test-1kg",
    name: "Arroz Premium Test 1kg",
    description: "Arroz de prueba",
    price: 3200,
    image: "",
    images: [],
    category: "Granos",
    categoryId: 2,
    brandId: null,
    brandName: null,
    productTypeCode: "GRANOS",
    productTypeName: "Granos",
    unit: "1 kg",
    stock: 5,
    isActive: true,
  },
];

export const MOCK_CATALOG_CATEGORIES = [
  {
    id: 1,
    parentId: null,
    level: 0,
    slug: "lacteos",
    name: "Lácteos",
    description: "Lácteos y derivados",
    image: null,
    productTypeCode: "LACTEOS",
    isActive: true,
    count: 1,
  },
  {
    id: 2,
    parentId: null,
    level: 0,
    slug: "granos",
    name: "Granos",
    description: "Arroz, frijol y más",
    image: null,
    productTypeCode: "GRANOS",
    isActive: true,
    count: 1,
  },
];

export const MOCK_FEATURED_CATEGORIES = [
  {
    id: 1,
    code: "LACTEOS",
    name: "Lácteos",
    slug: "lacteos",
    imagePath: null,
    count: 1,
  },
  {
    id: 2,
    code: "GRANOS",
    name: "Granos",
    slug: "granos",
    imagePath: null,
    count: 1,
  },
];

export const MOCK_HERO_BANNERS = [
  {
    id: 1,
    title: "Bienvenido a Mercaldas Test",
    subtitle: "Calidad y frescura",
    description: "Productos mockeados para la suite E2E.",
    ctaText: "Ver catálogo",
    linkUrl: "",
    image: "",
    mobileImage: "",
    bgColor: "#1A1A2E",
    accentColor: "#FFF200",
  },
];

export const MOCK_ADMIN_ORDER = {
  id: "ORD-1001",
  orderId: 1001,
  customer: "Cliente Prueba",
  phone: "3009876543",
  address: "Calle 10 # 5-20",
  total: 45000,
  payment: "Efectivo",
  status: "pendiente",
  itemsCount: 2,
  date: "2025-01-01",
  time: "10:30",
  note: "",
  pickerName: null,
  driverName: null,
  pickedAt: null,
  completedAt: null,
  totalPieces: 2,
  scannedPieces: 0,
  remainingPieces: 2,
  remainingItems: 2,
};

export const MOCK_ADMIN_STATS = {
  todayRevenue: 0,
  todayOrders: 0,
  activeCustomers: 0,
  activeProducts: 0,
  pendingDeliveries: 0,
  lowStockAlerts: 0,
  activePromotions: 0,
  activeBanners: 0,
  activePopups: 0,
  newCustomersToday: 0,
  yesterdayRevenue: 0,
  yesterdayOrders: 0,
  todayPaidOrders: 0,
  avgTicketToday: 0,
  ordersByStatus: {},
};

export const MOCK_BRANCH = {
  id: 1,
  code: "01",
  name: "Sucursal Centro",
  city: "Cali",
  address: "Calle 1 # 2-3",
  phone: "3000000000",
  email: "centro@mercaldas.test",
  isActive: true,
};

export const MOCK_PICKING_SHELF = {
  id: 1,
  branchId: 1,
  code: "A1",
  name: "Estantería Lácteos",
  type: "wall",
  color: "#f59e0b",
  width: 100,
  height: 40,
  posX: 0,
  posY: 0,
  rotation: 0,
  categories: [{ id: 1, name: "Lácteos" }],
  productCount: 1,
};

export const MOCK_PICKING_ORDER = {
  id: 1001,
  referenceCode: "ORD-1001",
  customerName: "Cliente Prueba",
  customerPhone: "3009876543",
  status: "pendiente",
  grandTotal: 45000,
  createdAt: "2025-01-01T10:30:00.000Z",
  pickerId: null,
  pickerName: null,
  pickedAt: null,
  completedAt: null,
  deliveredAt: null,
  itemsCount: 2,
  totalPieces: 2,
  scannedPieces: 0,
  remainingPieces: 2,
  remainingItems: 2,
};

export const MOCK_DRIVER = {
  id: 7,
  fullName: "Carlos Repartidor",
  phone: "3001112233",
  email: "carlos@mercaldas.test",
  username: "carlos",
  vehicleType: "moto",
  vehiclePlate: "ABC123",
  vehicleBrand: "Honda",
  vehicleModel: "125",
  vehicleColor: "Rojo",
  routeColor: null,
  avatarUrl: null,
  cargoVolumeCm3: null,
  load: null,
  isAvailable: true,
  isActive: true,
  location: null,
  lastLocationAt: null,
  lastSeenAt: new Date().toISOString(),
  createdAt: "2025-01-01T00:00:00.000Z",
  activeAssignment: null,
  branchId: 1,
  branchName: "Sucursal Centro",
};

export const MOCK_FLEET_ORDER = {
  assignmentId: 1,
  driverId: 7,
  driverName: "Carlos Repartidor",
  driverPlate: "ABC123",
  driverAvailable: true,
  orderId: 1001,
  referenceCode: "ORD-1001",
  status: "ASSIGNED",
  assignedAt: "2025-01-01T10:30:00.000Z",
  acceptedAt: null,
  readyForPickupAt: null,
  pickedUpAt: null,
  inDeliveryAt: null,
  completedAt: null,
  customerName: "Cliente Prueba",
  customerPhone: "3009876543",
  addressLine1: "Calle 10 # 5-20",
  city: "Cali",
  notes: null,
  destination: { lat: 3.4516, lng: -76.532 },
  branchName: "Sucursal Centro",
  branchAddress: "Calle 1 # 2-3",
  branchLocation: { lat: 3.44, lng: -76.52 },
  totals: { value: 45000, currency: "COP" },
  payment: { method: "CASH", label: "Efectivo" },
  volume: { cm3: null, estimated: false },
};

/**
 * Repartidor con GPS y pedido activo: el mapa de flota pinta los tres pines
 * (moto, casa de destino y sucursal de recogida), todos en puntos distintos.
 * Se usa en `tests/map` para ejercitar MapLibre de verdad.
 */
export const MOCK_DRIVER_ACTIVE = {
  ...MOCK_DRIVER,
  location: { lat: 5.067, lng: -75.517 },
  lastLocationAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  activeAssignment: {
    assignmentId: 1,
    orderId: 1001,
    referenceCode: MOCK_FLEET_ORDER.referenceCode,
    status: "ASSIGNED",
    assignedAt: "2025-01-01T10:30:00.000Z",
    acceptedAt: null,
    pickedUpAt: null,
    inDeliveryAt: null,
    customerName: MOCK_FLEET_ORDER.customerName,
    customerPhone: MOCK_FLEET_ORDER.customerPhone,
    // Manizales: el mapa tiene maxBounds sobre la ciudad, así que los pines
    // deben caer dentro para poder interactuar con ellos.
    destination: { lat: 5.055, lng: -75.505 },
    addressLine1: MOCK_FLEET_ORDER.addressLine1,
    city: "Manizales",
    branchName: MOCK_FLEET_ORDER.branchName,
    branchLocation: { lat: 5.08, lng: -75.53 },
  },
};

const API_HOST_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1):3000(?:\/|$)/;

function corsHeaders(route: Route): Record<string, string> {
  const request = route.request();
  const origin = request.headers()["origin"];
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      request.headers()["access-control-request-headers"] || "*",
    vary: "Origin",
  };
}

async function respond(
  route: Route,
  body: unknown,
  status = 200,
): Promise<true> {
  await route.fulfill({
    status,
    headers: {
      ...corsHeaders(route),
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return true;
}

function productsForRequest(route: Route) {
  let payload: Record<string, unknown> = {};
  try {
    payload = (route.request().postDataJSON() as Record<string, unknown>) ?? {};
  } catch {
    payload = {};
  }

  // La landing pide las ofertas del día con onSale:true. Se devuelve vacío para
  // que el único "Agregar" visible en el home sea el de Productos Destacados.
  if (payload.onSale === true) return [];

  const search =
    typeof payload.search === "string" ? payload.search.toLowerCase() : "";
  const limit = typeof payload.limit === "number" ? payload.limit : undefined;
  const filtered = search
    ? MOCK_PRODUCTS.filter((p) => p.name.toLowerCase().includes(search))
    : MOCK_PRODUCTS;
  return limit ? filtered.slice(0, limit) : filtered;
}

async function handleApi(
  route: Route,
  state: ApiMockState,
  url: URL,
): Promise<boolean> {
  const method = route.request().method();
  let path = url.pathname;
  // Soporta despliegues con el API montado bajo /api.
  if (path.startsWith("/api/")) path = path.slice(4);

  // ── Sesión / autenticación (admin, picking y delivery comparten rutas) ──
  if (path === "/auth/login" && method === "POST") {
    state.loggedIn = true;
    return respond(route, {
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresIn: 3600,
      user: MOCK_ADMIN_USER,
    });
  }
  if (path === "/auth/me" && method === "GET") {
    if (!state.loggedIn) {
      return respond(route, { message: "Unauthorized" }, 401);
    }
    return respond(route, MOCK_ADMIN_USER);
  }
  if (path === "/auth/logout") {
    state.loggedIn = false;
    return respond(route, { success: true });
  }

  // ── Cliente: salud, catálogo, landing y carrito ──
  if (path === "/api-status") return respond(route, { status: "ok" });

  if (path === "/catalog/categories" && method === "GET") {
    return respond(route, MOCK_CATALOG_CATEGORIES);
  }
  if (path === "/catalog/categories/counts") {
    return respond(route, [{ categoryId: 1, count: 1 }]);
  }
  if (path === "/catalog/products" && method === "POST") {
    return respond(route, productsForRequest(route));
  }
  if (path === "/catalog/products/count") {
    return respond(route, { total: MOCK_PRODUCTS.length });
  }
  if (/^\/catalog\/products\/\d+\/related$/.test(path)) {
    return respond(route, []);
  }
  if (path === "/catalog/branches") return respond(route, [MOCK_BRANCH]);
  if (path === "/catalog/brands/featured") return respond(route, []);
  if (path === "/catalog/brands") return respond(route, []);
  if (path === "/catalog/product-types") return respond(route, []);
  if (path === "/catalog/favorites") return respond(route, []);
  if (path.startsWith("/catalog/shopping-lists")) return respond(route, []);

  if (path === "/landing/general") {
    return respond(route, { url: null, title: "Mercaldas Test" });
  }
  if (path === "/landing/daily-deals") {
    return respond(route, { featuredItems: [], carousel: [] });
  }
  if (path === "/landing/categories") {
    return respond(route, MOCK_FEATURED_CATEGORIES);
  }
  if (path === "/landing/brands") return respond(route, []);
  if (path === "/landing/product-types") return respond(route, []);

  if (path === "/featured/tabs") {
    return respond(route, [
      { id: 1, name: "Destacados", slug: "destacados", position: 0 },
    ]);
  }
  if (/^\/featured\/tabs\/[^/]+\/products$/.test(path)) {
    return respond(route, [MOCK_PRODUCTS[0]]);
  }

  if (path === "/banners") {
    const type = url.searchParams.get("bannerType");
    return respond(route, type === "hero" ? MOCK_HERO_BANNERS : []);
  }

  if (path === "/qr/config") {
    return respond(route, {
      enabled: false,
      url: null,
      format: null,
      text: null,
      updatedAt: null,
    });
  }

  if (path === "/customer-auth/login" && method === "POST") {
    return respond(route, {
      accessToken: "mock-customer-token",
      customer: MOCK_CUSTOMER,
    });
  }
  if (path === "/customer-auth/me") {
    return respond(route, { message: "Unauthorized" }, 401);
  }
  if (path.startsWith("/customer-auth/addresses")) {
    return respond(route, []);
  }

  if (path === "/cart" && method === "GET") {
    return respond(route, { items: [] });
  }
  if (path === "/cart/quote" && method === "POST") {
    return respond(route, {
      items: [],
      subtotal: 0,
      discountTotal: 0,
      total: 0,
      shipping: 0,
      promotions: [],
    });
  }

  // ── Admin ──
  if (path === "/admin/orders/unreviewed-count") {
    return respond(route, { count: 0 });
  }
  if (path === "/admin/orders" && method === "GET") {
    return respond(route, [MOCK_ADMIN_ORDER]);
  }
  if (/^\/admin\/orders\/[^/]+$/.test(path) && method === "GET") {
    return respond(route, {
      ...MOCK_ADMIN_ORDER,
      items: [
        { name: "Leche Entera Test 1L", qty: 1, price: 4500 },
        { name: "Arroz Premium Test 1kg", qty: 1, price: 3200 },
      ],
      statusHistory: [],
    });
  }
  if (path === "/admin/landing/general-logo") {
    return respond(route, { url: null, title: "Mercaldas Test" });
  }
  if (path === "/admin/dashboard/stats") {
    return respond(route, MOCK_ADMIN_STATS);
  }
  if (
    path.startsWith("/admin/dashboard/revenue-by-day") ||
    path.startsWith("/admin/dashboard/sales-by-") ||
    path.startsWith("/admin/dashboard/low-stock") ||
    path.startsWith("/admin/dashboard/recent-orders") ||
    path.startsWith("/admin/dashboard/active-customers") ||
    path.startsWith("/admin/dashboard/pending-deliveries") ||
    path.startsWith("/admin/dashboard/today-orders")
  ) {
    return respond(route, []);
  }

  // ── Picking admin ──
  if (path === "/picking-admin/branches") return respond(route, [MOCK_BRANCH]);
  if (path === "/picking-admin/categories") {
    return respond(route, [
      { id: 1, name: "Lácteos", parentId: null, level: 0, productCount: 1 },
    ]);
  }
  if (/^\/picking-admin\/categories\/\d+\/organization$/.test(path)) {
    return respond(route, {
      category: { id: 1, name: "Lácteos", level: 0, parentId: null },
      shelves: [
        {
          id: 1,
          branchId: 1,
          code: "A1",
          name: "Estantería Lácteos",
          color: "#f59e0b",
          productCount: 1,
        },
      ],
      products: [],
    });
  }
  if (path === "/picking-admin/shelves" && method === "GET") {
    return respond(route, [MOCK_PICKING_SHELF]);
  }
  if (path === "/picking-admin/products") {
    return respond(route, {
      total: 1,
      products: [
        {
          productVariantId: 1,
          productId: 101,
          productName: "Leche Entera Test 1L",
          sku: "LEC-101",
          barcode: null,
          stock: 10,
          categories: [{ id: 1, name: "Lácteos" }],
          shelves: [
            { id: 1, code: "A1", name: "Estantería Lácteos", color: "#f59e0b" },
          ],
        },
      ],
    });
  }
  if (path === "/picking-admin/orders") {
    return respond(route, {
      branchId: null,
      total: 1,
      counts: { pendiente: 1 },
      limit: 50,
      offset: 0,
      orders: [MOCK_PICKING_ORDER],
    });
  }
  if (path === "/picking-admin/metrics") return respond(route, []);
  if (path === "/picking-admin/chats") return respond(route, []);
  if (path === "/picking-admin/users") return respond(route, []);
  if (/^\/picking-admin\/branches\/\d+\/schedule$/.test(path)) {
    return respond(route, { branchId: 1, schedule: {} });
  }
  if (path === "/picking-admin/settings") {
    return respond(route, {
      breakDurationMinutes: 15,
      maxBreaksPerDay: 2,
      dailyGoalOrders: 20,
    });
  }

  // ── Delivery admin ──
  if (path === "/delivery/admin/branches") return respond(route, [MOCK_BRANCH]);
  if (path === "/delivery/admin/drivers") return respond(route, state.drivers);
  if (path === "/delivery/admin/chats") return respond(route, []);
  if (path === "/delivery/admin/orders") {
    return respond(route, {
      items: [MOCK_FLEET_ORDER],
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
  }
  if (/^\/delivery\/admin\/drivers\/\d+\/history$/.test(path)) {
    return respond(route, []);
  }
  if (/^\/delivery\/admin\/drivers\/\d+\/messages$/.test(path)) {
    return respond(route, []);
  }
  if (/^\/delivery\/admin\/orders\/\d+\/route$/.test(path)) {
    return respond(route, { polyline: "", distanceM: 0, durationS: 0 });
  }

  return false;
}

/**
 * Instala los mocks de API en la página. Devuelve el estado para que el test
 * pueda inspeccionar/forzar la sesión si lo necesita.
 */
export async function installApiMocks(
  page: Page,
  options: { loggedIn?: boolean; activeDriver?: boolean } = {},
): Promise<ApiMockState> {
  const state: ApiMockState = {
    loggedIn: options.loggedIn ?? false,
    drivers: options.activeDriver ? [MOCK_DRIVER_ACTIVE] : [MOCK_DRIVER],
  };

  const handler = async (route: Route) => {
    const request = route.request();

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders(route) });
      return;
    }

    const url = new URL(request.url());

    // Sin backend de sockets: se corta el handshake para que no reintente.
    if (url.pathname.startsWith("/socket.io")) {
      await route.fulfill({ status: 503, body: "" });
      return;
    }

    const handled = await handleApi(route, state, url);
    if (handled) return;

    // Fallback: listas vacías para GET y objeto vacío para escrituras.
    if (request.method() === "GET") {
      await respond(route, []);
    } else {
      await respond(route, {});
    }
  };

  await page.route(API_HOST_PATTERN, handler);
  // Red de seguridad para despliegues donde el API vive bajo /api/**.
  await page.route("**/api/**", handler);

  // Las SPAs importan Google Fonts en su CSS. Sin red (o con la red lenta) esa
  // petición retrasa el evento `load` y hace fallar el goto: se responde vacío.
  await page.route(
    /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//,
    (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );

  return state;
}

/** Estilo mínimo de MapLibre para tests: sólo fondo, sin capas que pidan red. */
const OFFLINE_MAP_STYLE = {
  version: 8,
  name: "e2e-offline",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#e5e7eb" },
    },
  ],
};

/** Evita que MapLibre salga a internet durante los tests. */
export async function blockMapTiles(page: Page): Promise<void> {
  await page.route("**/ofm/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    // El estilo base (`/ofm/styles/…`) se sirve offline con un spec válido:
    // MapLibre inicializa el canvas y la cámara sin descargar tiles ni sprites.
    if (pathname.startsWith("/ofm/styles/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OFFLINE_MAP_STYLE),
      });
    }
    // El estilo lee el TileJSON de `/ofm/planet` y exige al menos una URL de
    // tiles para aceptar el estilo. Se devuelve una plantilla local que el
    // test bloquea con 404: MapLibre pinta el fondo y los pines igual.
    if (pathname === "/ofm/planet") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tiles: ["/ofm/planet/{z}/{x}/{y}.pbf"] }),
      });
    }
    return route.fulfill({
      status: 404,
      contentType: "text/plain",
      body: "sin tiles en E2E",
    });
  });
}

export { API_ORIGIN };
