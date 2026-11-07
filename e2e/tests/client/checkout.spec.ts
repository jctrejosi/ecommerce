import {
  test,
  expect,
  type Page,
  type Route,
  type WebSocketRoute,
} from "@playwright/test";
import { installApiMocks, MOCK_PRODUCTS } from "../support/mockApi";
import { IS_PROD_MODE } from "../support/urls";

/**
 * Checkout de la tienda (Interface web client), sin backend.
 *
 * Flujo real: catálogo → carrito → resumen → dirección (mapa + geocoder) →
 * método de pago → confirmación. La compra es de invitado: el cliente llama a
 * `/orders/guest-checkout`, así que no hace falta mockear login.
 *
 * Todo el API vive en `http://localhost:3000` (VITE_API_URL), por eso los
 * handlers locales se registran sobre el origen del backend y sobre `**\/api/**`
 * (igual que `support/mockApi.ts`). El resto de rutas cae con `route.fallback()`
 * en los mocks compartidos.
 *
 * Nota de selectores: los `<label>` del formulario de dirección y de la tarjeta
 * no están asociados con `htmlFor`, así que se usan sus placeholders reales.
 */

const API_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1):3000(?:\/|$)/;
const SANDBOX_WOMPI = /^https:\/\/sandbox\.wompi\.co\//;

const ADDRESS = {
  name: "Cliente Prueba",
  phone: "3001234567",
  email: "cliente@mercaldas.test",
  address: "Cra 23 #45-67, Barrio San José",
  city: "Manizales",
};

const GEO_PLACE = {
  label: `${ADDRESS.address}, ${ADDRESS.city}, Colombia`,
  address: ADDRESS.address,
  city: ADDRESS.city,
  lat: 5.06889,
  lng: -75.51738,
};

const APPROVED_REFERENCE = "MCK-APR-9001";
const DECLINED_REFERENCE = "MCK-DEC-9002";
const DECLINE_REASON = "Fondos insuficientes (DECLINED)";

type OrderMode = "approved" | "declined";

function corsHeaders(route: Route): Record<string, string> {
  const request = route.request();
  return {
    "access-control-allow-origin": request.headers()["origin"] || "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers":
      request.headers()["access-control-request-headers"] || "*",
    vary: "Origin",
  };
}

async function jsonResponse(
  route: Route,
  body: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    headers: {
      ...corsHeaders(route),
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
}

/** Respuesta de `POST /orders/guest-checkout` (o `/orders/checkout`). */
function orderResponse(mode: OrderMode) {
  const declined = mode === "declined";
  const reference = declined ? DECLINED_REFERENCE : APPROVED_REFERENCE;
  return {
    orderId: declined ? 9002 : 9001,
    referenceCode: reference,
    subtotal: MOCK_PRODUCTS[0].price,
    discountTotal: 0,
    couponDiscount: 0,
    couponBalanceApplied: 0,
    amountToCharge: MOCK_PRODUCTS[0].price + 4900,
    shippingCost: 4900,
    grandTotal: MOCK_PRODUCTS[0].price + 4900,
    paymentMethod: declined ? "tarjeta" : "efectivo",
    shippingType: "standard",
    address: ADDRESS,
    // La app muestra la confirmación salvo que el estado sea `payment_pending`.
    status: declined ? "payment_pending" : "APPROVED",
    ...(declined
      ? {
          cardTransaction: {
            status: "DECLINED",
            status_message: DECLINE_REASON,
          },
        }
      : {}),
  };
}

/** Pedido que devuelve el polling de seguimiento (`useOrderSocket`). */
function trackedOrder(mode: OrderMode) {
  const declined = mode === "declined";
  return {
    id: declined ? DECLINED_REFERENCE : APPROVED_REFERENCE,
    date: "2026-11-04T12:00:00.000Z",
    items: [
      {
        id: MOCK_PRODUCTS[0].id,
        name: MOCK_PRODUCTS[0].name,
        image: MOCK_PRODUCTS[0].image,
        quantity: 1,
        price: MOCK_PRODUCTS[0].price,
        category: MOCK_PRODUCTS[0].category,
      },
    ],
    total: MOCK_PRODUCTS[0].price + 4900,
    shipping: 4900,
    address: `${ADDRESS.address}, ${ADDRESS.city}`,
    paymentMethod: declined ? "tarjeta" : "efectivo",
    status: declined ? "cancelado" : "confirmado",
  };
}

/**
 * Mocks propios del checkout: geocoder del mapa, medios de pago y creación del
 * pedido. En `declined` se habilita tarjeta (Wompi) y el pedido nace pendiente
 * con `cardTransaction.status = DECLINED`, como lo haría el backend real.
 */
async function mockCheckoutApi(page: Page, mode: OrderMode): Promise<void> {
  const declined = mode === "declined";

  const handler = async (route: Route): Promise<void> => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname.replace(/^\/api(?=\/)/, "");

    if (pathname === "/geocode/search") {
      await jsonResponse(route, [GEO_PLACE]);
      return;
    }
    if (pathname === "/geocode/reverse") {
      await jsonResponse(route, GEO_PLACE);
      return;
    }
    if (pathname === "/payments/methods") {
      await jsonResponse(route, {
        efectivo: { enabled: true },
        wompi: {
          enabled: declined,
          methods: { card: declined, pse: false, nequi: false },
        },
        breb: { enabled: false },
      });
      return;
    }
    if (pathname === "/payments/wompi/config" && declined) {
      await jsonResponse(route, {
        publicKey: "pub_stag_mock_e2e",
        redirectUrl: null,
        acceptanceToken: "acceptance-token-mock",
        acceptancePermalink: null,
        personalDataAuthToken: "personal-data-token-mock",
        personalDataAuthPermalink: null,
      });
      return;
    }
    if (
      (pathname === "/orders/guest-checkout" || pathname === "/orders/checkout") &&
      request.method() === "POST"
    ) {
      await jsonResponse(route, orderResponse(mode));
      return;
    }
    if (pathname.startsWith("/orders/track/")) {
      await jsonResponse(route, trackedOrder(mode));
      return;
    }

    // Cualquier otra ruta la resuelven los mocks compartidos.
    await route.fallback();
  };

  await page.route(API_ORIGIN, handler);
  await page.route("**/api/**", handler);
}

/** La tokenización de la tarjeta va directa a Wompi, no al backend. */
async function mockWompiTokenization(page: Page): Promise<void> {
  await page.route(SANDBOX_WOMPI, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders(route) });
      return;
    }
    await jsonResponse(route, {
      status: "ok",
      data: { id: "tok_e2e", brand: "VISA", last_four: "4242" },
    });
  });
}

/**
 * Socket.IO de estados del pedido. La pantalla `Pago rechazado` solo aparece
 * cuando llega `order:status` con `cancelado` y un `reason` (así funciona el
 * rechazo real de Wompi), por eso se emula el protocolo Engine.IO/Socket.IO.
 *
 * Se responde el handshake de cualquier namespace (`/status`, `/orders`…) para
 * no romper el monitor de backend de la SPA.
 */
async function mockDeclinedOrderSocket(page: Page): Promise<void> {
  await page.routeWebSocket(/\/socket\.io\//, (ws: WebSocketRoute) => {
    ws.send(
      '0{"sid":"mock-e2e","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}',
    );

    ws.onMessage((message) => {
      const payload = message.toString();

      if (payload === "2") {
        ws.send("3");
        return;
      }

      const namespaceConnect = payload.match(/^40(\/[^,]*)?(?:,|$)/);
      if (namespaceConnect) {
        const namespace = namespaceConnect[1] ?? "";
        ws.send(`40${namespace},{"sid":"mock-e2e"}`);
        return;
      }

      if (payload.startsWith("42/orders,")) {
        const body = payload.slice("42/orders,".length);
        let event: unknown[] = [];
        try {
          event = JSON.parse(body) as unknown[];
        } catch {
          return;
        }
        if (event[0] === "subscribe:order") {
          const orderId =
            typeof event[1] === "string" ? event[1] : DECLINED_REFERENCE;
          ws.send(
            `42/orders,${JSON.stringify([
              "order:status",
              { orderId, status: "cancelado", reason: DECLINE_REASON },
            ])}`,
          );
        }
      }
    });
  });
}

/** Catálogo → carrito → resumen → paso de dirección. */
async function goToShippingStep(page: Page): Promise<void> {
  await page.goto("/catalog", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(MOCK_PRODUCTS[0].name).first()).toBeVisible();

  await page
    .getByRole("button", { name: "Agregar 1", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Carrito/ }).click();
  await expect(page.getByRole("heading", { name: "Mi Carrito" })).toBeVisible();
  await page.getByRole("button", { name: "Finalizar pedido →" }).click();

  await expect(
    page.getByRole("heading", { name: "Resumen del pedido" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continuar con la dirección →" }).click();

  await expect(
    page.getByRole("heading", { name: "Dirección de entrega" }),
  ).toBeVisible();
}

/**
 * Rellena la dirección y confirma el punto en el mapa. El geocoder mockeado
 * ubica la dirección y habilita "Continuar con el pago".
 */
async function fillShippingAndContinue(page: Page): Promise<void> {
  await page.getByPlaceholder("Carlos Ríos").fill(ADDRESS.name);
  await page.getByPlaceholder("300 123 4567").fill(ADDRESS.phone);
  await page.getByPlaceholder("correo@ejemplo.com").fill(ADDRESS.email);
  await page
    .getByPlaceholder("Cra 23 #45-67, Barrio San José")
    .fill(ADDRESS.address);
  await page.getByPlaceholder("Manizales").fill(ADDRESS.city);

  const confirmAddress = page.getByRole("button", {
    name: "Confirmar que la dirección es correcta en el mapa",
  });
  await expect(confirmAddress).toBeEnabled({ timeout: 30_000 });
  await confirmAddress.click();
  await expect(
    page.getByRole("button", { name: "Dirección confirmada en el mapa" }),
  ).toBeVisible();

  const continueToPayment = page.getByRole("button", {
    name: "Continuar con el pago →",
  });
  await expect(continueToPayment).toBeEnabled();
  await continueToPayment.click();
  await expect(
    page.getByRole("heading", { name: "Método de pago" }),
  ).toBeVisible();
}

test.describe("Cliente · checkout", () => {
  test.skip(
    IS_PROD_MODE,
    "Modo producción (PLAYWRIGHT_BASE_URL): sólo corre el smoke sin mocks.",
  );

  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test("compra completa con pago aprobado muestra la confirmación", async ({
    page,
  }) => {
    await mockCheckoutApi(page, "approved");

    await goToShippingStep(page);
    await fillShippingAndContinue(page);

    // Los radios son `sr-only`: se activa el método tocando el texto de su
    // <label> (el círculo decorativo intercepta el click sobre el input).
    await page.getByText("Efectivo contra entrega", { exact: true }).click();
    await page.getByRole("button", { name: "Confirmar pedido →" }).click();

    await expect(
      page.getByRole("heading", { name: "¡Pedido confirmado!" }),
    ).toBeVisible();
    await expect(
      page.getByText(`Tu pedido ${APPROVED_REFERENCE} ha sido recibido.`),
    ).toBeVisible();
    await expect(page.getByText(APPROVED_REFERENCE)).toBeVisible();
  });

  test("pago DECLINED muestra el rechazo y no confirma el pedido", async ({
    page,
  }) => {
    await mockCheckoutApi(page, "declined");
    await mockWompiTokenization(page);
    await mockDeclinedOrderSocket(page);

    await goToShippingStep(page);
    await fillShippingAndContinue(page);

    // Radios `sr-only`: se activa el método tocando el texto de su <label>.
    await page.getByText("Tarjeta débito / crédito", { exact: true }).click();
    await page
      .getByPlaceholder("Nombre como aparece en la tarjeta")
      .fill(ADDRESS.name);
    await page
      .getByPlaceholder("1234 5678 9012 3456")
      .fill("4242 4242 4242 4242");
    await page.getByPlaceholder("08/29").fill("1229");
    await page.getByPlaceholder("123", { exact: true }).fill("123");
    await page
      .getByRole("checkbox", { name: /términos y condiciones de Wompi/ })
      .check();
    await page
      .getByRole("checkbox", { name: /tratamiento de datos personales/ })
      .check();

    await page.getByRole("button", { name: "Confirmar pedido →" }).click();

    // El rechazo llega por el socket de estados del pedido.
    await expect(
      page.getByRole("heading", { name: "Pago rechazado" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(DECLINE_REASON)).toBeVisible();
    await expect(
      page.getByText(`Tu pedido ${DECLINED_REFERENCE} no pudo ser procesado.`),
    ).toBeVisible();

    // Nunca debe mostrarse la pantalla de confirmación.
    await expect(
      page.getByRole("heading", { name: "¡Pedido confirmado!" }),
    ).toHaveCount(0);
  });
});
