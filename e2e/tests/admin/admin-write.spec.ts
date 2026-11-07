import { test, expect, type Page, type Route } from "@playwright/test";
import { installApiMocks, MOCK_PRODUCTS } from "../support/mockApi";
import { IS_PROD_MODE } from "../support/urls";

/** Petición de escritura capturada por las rutas locales de este spec. */
type Captured = {
  method: string;
  url: string;
  body: unknown;
};

/** URL falsa que devuelve el endpoint de subida simulado. */
const UPLOADED_URL = "https://cdn.test/e2e-banner.webp";

/** Media id que devuelve el endpoint `upload-url` simulado. */
const CREATED_MEDIA_ID = 1234;

/**
 * Banner de referencia para los flujos de edición. No se reutiliza
 * `MOCK_HERO_BANNERS` porque ese fixture tiene forma de landing (sin id ni
 * estado), mientras que el panel espera un `Banner` completo.
 */
const SEED_BANNER = {
  id: 501,
  title: "Slide inicial E2E",
  subtitle: "Subtítulo inicial",
  description: "Descripción inicial",
  image: "https://cdn.test/seed-hero.webp",
  mobileImage: null,
  linkUrl: null,
  linkTarget: "_self",
  ctaText: "Ver más",
  altText: null,
  bgColor: "#1A1A2E",
  accentColor: "#FFF200",
  bannerType: "hero",
  position: 0,
  isActive: true,
  startDate: null,
  endDate: null,
  filterId: null,
  filter: null,
  clicks: 0,
  views: 0,
  status: "activo",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

/** Respuestas cross-origin (admin :5273 → API :3000) con credenciales. */
function corsHeaders(route: Route): Record<string, string> {
  const request = route.request();
  return {
    "access-control-allow-origin": request.headers()["origin"] || "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      request.headers()["access-control-request-headers"] || "*",
    vary: "Origin",
  };
}

async function respondJson(
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

/** Responde el preflight CORS. Devuelve `true` si la petición era OPTIONS. */
async function answerPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== "OPTIONS") return false;
  await route.fulfill({ status: 204, headers: corsHeaders(route) });
  return true;
}

/** Cuerpo de la petición: JSON cuando se puede, texto si es multipart. */
function requestBody(route: Route): unknown {
  try {
    return route.request().postDataJSON();
  } catch {
    return route.request().postData();
  }
}

/** Captura una escritura y responde con el cuerpo indicado. */
async function captureWrite(
  route: Route,
  captured: Captured[],
  response: unknown,
  status = 200,
): Promise<void> {
  if (await answerPreflight(route)) return;
  const request = route.request();
  captured.push({
    method: request.method(),
    url: request.url(),
    body: requestBody(route),
  });
  await respondJson(route, response, status);
}

async function login(page: Page): Promise<void> {
  await page.getByPlaceholder("admin-ecommerce").fill("admin-ecommerce");
  await page.getByPlaceholder("••••••••").fill("clave-segura");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Ana/ })).toBeVisible();
}

async function openProducts(page: Page): Promise<void> {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Productos", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toBeVisible();
}

async function openHeroBanners(page: Page): Promise<void> {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Banners publicitarios", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Banners publicitarios", exact: true }),
  ).toBeVisible();
}

/** Contenedor modal del formulario de producto. */
function productDrawer(page: Page, title: string) {
  return page
    .locator("div.fixed.inset-0")
    .filter({ has: page.getByRole("heading", { name: title }) });
}

/** Contenedor modal del editor de slides del carousel. */
function slideEditor(page: Page, title: string) {
  return page
    .locator("div.fixed.inset-0")
    .filter({ has: page.getByRole("heading", { name: title }) });
}

/**
 * Escrituras del panel admin (Interface web admin) sin backend real.
 *
 * Los endpoints se toman del código de la SPA, no se inventan:
 * - Productos: `POST {API}/catalog/products/create` y
 *   `POST {API}/catalog/products/:id/update` (ver `Products.tsx#handleSave`).
 * - Banners: `GET/POST {API}/admin/banners`, `PUT {API}/admin/banners/:id`,
 *   `POST {API}/upload/image` y `POST {API}/admin/banners/upload-url`.
 */
test.describe("Admin · escrituras", () => {
  test.skip(
    IS_PROD_MODE,
    "Modo producción (PLAYWRIGHT_BASE_URL): sólo corre el smoke sin mocks.",
  );

  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test("crea un producto y envía el POST con el payload esperado", async ({
    page,
  }) => {
    const writes: Captured[] = [];
    await page.route(/\/catalog\/products\/create$/, (route) =>
      captureWrite(route, writes, { id: 999 }, 201),
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);
    await openProducts(page);

    await page
      .getByRole("button", { name: "Nuevo producto", exact: true })
      .click();

    const drawer = productDrawer(page, "Crear Producto");
    await expect(drawer).toBeVisible();

    await drawer
      .getByPlaceholder("Ej: Leche Entera Alquería 1.1L")
      .fill("Producto E2E");
    // Primer `spinbutton` del formulario: Precio (el siguiente es Precio original).
    await drawer.getByRole("spinbutton").first().fill("4500");
    await drawer.getByPlaceholder("Buscar o elegir categoría...").click();
    await drawer.getByRole("button", { name: /Granos/ }).click();
    await drawer
      .getByRole("button", { name: "Publicar Producto", exact: true })
      .click();

    await expect(page.getByText("Producto creado correctamente")).toBeVisible();

    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("POST");
    expect(writes[0].url).toMatch(/\/catalog\/products\/create$/);
    expect(writes[0].body).toMatchObject({
      name: "Producto E2E",
      price: 4500,
      categoryId: 2,
      isActive: true,
    });
  });

  test("edita un producto existente y confirma con el endpoint de actualización", async ({
    page,
  }) => {
    const writes: Captured[] = [];
    // La SPA actualiza con POST /catalog/products/:id/update (no PUT/PATCH).
    await page.route(/\/catalog\/products\/\d+\/update$/, (route) =>
      captureWrite(route, writes, { ok: true }),
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);
    await openProducts(page);

    await page.getByText(MOCK_PRODUCTS[0].name).first().click();

    const drawer = productDrawer(page, "Editar Producto");
    await expect(drawer).toBeVisible();

    await expect(drawer.getByRole("spinbutton").first()).toHaveValue(
      String(MOCK_PRODUCTS[0].price),
    );
    await drawer.getByRole("spinbutton").first().fill("5200");
    await drawer
      .getByRole("button", { name: "Guardar Cambios", exact: true })
      .click();

    await expect(
      page.getByText("Producto actualizado correctamente"),
    ).toBeVisible();

    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("POST");
    expect(writes[0].url).toMatch(
      new RegExp(`/catalog/products/${MOCK_PRODUCTS[0].id}/update$`),
    );
    expect(writes[0].body).toMatchObject({
      name: MOCK_PRODUCTS[0].name,
      price: 5200,
    });
  });

  test("crea un banner con subida simulada y lo muestra en el carousel", async ({
    page,
  }) => {
    const uploads: Captured[] = [];
    const mediaWrites: Captured[] = [];
    const bannerWrites: Captured[] = [];
    const heroBanners: Array<Record<string, unknown>> = [];

    // Subida simulada: el endpoint devuelve una URL falsa.
    await page.route(/\/upload\/image$/, (route) =>
      captureWrite(
        route,
        uploads,
        { url: UPLOADED_URL, mediaType: "image/webp" },
        201,
      ),
    );
    // La SPA convierte esa URL en un media id antes de crear el banner.
    await page.route(/\/admin\/banners\/upload-url$/, (route) =>
      captureWrite(route, mediaWrites, { mediaId: CREATED_MEDIA_ID }, 201),
    );
    // Listado (por tipo) + alta de banners.
    await page.route(/\/admin\/banners(?:\?.*)?$/, async (route) => {
      if (await answerPreflight(route)) return;
      const request = route.request();
      if (request.method() === "GET") {
        const type = new URL(request.url()).searchParams.get("bannerType");
        await respondJson(route, type === "hero" ? heroBanners : []);
        return;
      }
      const payload = requestBody(route) as Record<string, unknown>;
      const created = {
        ...SEED_BANNER,
        ...payload,
        id: 900 + heroBanners.length,
        // El servidor resuelve mediaId → URL; aquí usamos la URL simulada.
        image: UPLOADED_URL,
        status: "activo",
      };
      bannerWrites.push({
        method: request.method(),
        url: request.url(),
        body: payload,
      });
      heroBanners.push(created);
      await respondJson(route, created, 201);
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);
    await openHeroBanners(page);

    await expect(
      page.getByText("No hay slides. Añade el primero con el botón de arriba."),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Añadir slide", exact: true })
      .click();

    const editor = slideEditor(page, "Nuevo Slide");
    await expect(editor).toBeVisible();

    await editor
      .getByPlaceholder(/^Frutas y Verduras/)
      .fill("Banner E2E");
    // Primer input de archivo del editor: imagen de escritorio.
    await editor.locator('input[type="file"]').first().setInputFiles({
      name: "banner-e2e.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    await editor.getByRole("button", { name: "Crear", exact: true }).click();

    // El banner creado aparece en el carousel con la imagen subida.
    await expect(page.getByText("Banner E2E")).toBeVisible();
    await expect(
      page.locator(`img[src="${UPLOADED_URL}"]`).first(),
    ).toBeVisible();

    expect(uploads).toHaveLength(1);
    expect(uploads[0].method).toBe("POST");
    expect(uploads[0].url).toMatch(/\/upload\/image$/);

    expect(mediaWrites).toHaveLength(1);
    expect(mediaWrites[0].body).toMatchObject({ url: UPLOADED_URL });

    expect(bannerWrites).toHaveLength(1);
    expect(bannerWrites[0].method).toBe("POST");
    expect(bannerWrites[0].url).toMatch(/\/admin\/banners$/);
    expect(bannerWrites[0].body).toMatchObject({
      title: "Banner E2E",
      mediaId: CREATED_MEDIA_ID,
      bannerType: "hero",
      isActive: true,
    });
  });

  test("edita un banner existente y verifica el PUT", async ({ page }) => {
    const writes: Captured[] = [];
    const heroBanners: Array<Record<string, unknown>> = [{ ...SEED_BANNER }];

    await page.route(/\/admin\/banners(?:\?.*)?$/, async (route) => {
      if (await answerPreflight(route)) return;
      const type = new URL(route.request().url()).searchParams.get("bannerType");
      await respondJson(route, type === "hero" ? heroBanners : []);
    });
    await page.route(/\/admin\/banners\/\d+$/, async (route) => {
      if (await answerPreflight(route)) return;
      const request = route.request();
      const payload = requestBody(route) as Record<string, unknown>;
      const id = Number(request.url().match(/\/admin\/banners\/(\d+)$/)?.[1]);
      writes.push({ method: request.method(), url: request.url(), body: payload });
      const index = heroBanners.findIndex((b) => b.id === id);
      if (index >= 0) heroBanners[index] = { ...heroBanners[index], ...payload };
      await respondJson(route, heroBanners[index] ?? payload);
    });
    // El editor re-sube/registra la imagen existente antes de guardar.
    await page.route(/\/admin\/banners\/upload-url$/, (route) =>
      captureWrite(route, [], { mediaId: CREATED_MEDIA_ID }, 201),
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);
    await openHeroBanners(page);

    await expect(page.getByText(SEED_BANNER.title)).toBeVisible();
    await page.getByRole("button", { name: "Editar", exact: true }).click();

    const editor = slideEditor(page, "Editar Slide");
    await expect(editor).toBeVisible();
    await editor
      .getByPlaceholder(/^Frutas y Verduras/)
      .fill("Slide editado E2E");
    await editor.getByRole("button", { name: "Guardar", exact: true }).click();

    await expect(page.getByText("Slide editado E2E")).toBeVisible();

    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("PUT");
    expect(writes[0].url).toMatch(
      new RegExp(`/admin/banners/${SEED_BANNER.id}$`),
    );
    expect(writes[0].body).toMatchObject({
      title: "Slide editado E2E",
      bannerType: "hero",
    });
  });

  test("no emite petición al guardar un producto sin obligatorios", async ({
    page,
  }) => {
    const writes: Captured[] = [];
    await page.route(/\/catalog\/products\/create$/, (route) =>
      captureWrite(route, writes, { id: 999 }, 201),
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);
    await openProducts(page);

    await page
      .getByRole("button", { name: "Nuevo producto", exact: true })
      .click();

    const drawer = productDrawer(page, "Crear Producto");
    await expect(drawer).toBeVisible();
    await drawer
      .getByRole("button", { name: "Publicar Producto", exact: true })
      .click();

    await expect(
      page.getByText("Nombre y precio son obligatorios"),
    ).toBeVisible();

    // La validación es local (`handleSave` retorna antes del fetch): margen
    // corto para descartar una petición diferida antes de la aserción negativa.
    await page.waitForTimeout(500);
    expect(writes).toHaveLength(0);
  });
});
