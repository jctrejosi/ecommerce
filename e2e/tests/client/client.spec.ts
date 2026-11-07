import { test, expect } from "@playwright/test";
import { installApiMocks, MOCK_PRODUCTS } from "../support/mockApi";
import { IS_PROD_MODE } from "../support/urls";

/**
 * Flujos críticos de la tienda (Interface web client).
 * Todas las llamadas al API se mockean: no hace falta backend ni BD.
 */
test.describe("Cliente · tienda", () => {
  test.skip(
    IS_PROD_MODE,
    "Modo producción (PLAYWRIGHT_BASE_URL): sólo corre el smoke sin mocks.",
  );

  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test("la home carga banner, categorías y productos destacados", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Productos Destacados" })).toBeVisible();
    await expect(page.getByText("Bienvenido a Mercaldas Test")).toBeVisible();
    await expect(
      page.getByText(MOCK_PRODUCTS[0].name).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Nuestros productos" }),
    ).toBeVisible();
  });

  test("el catálogo lista los productos mockeados y filtra por búsqueda", async ({
    page,
  }) => {
    await page.goto("/catalog", { waitUntil: "domcontentloaded" });

    await expect(page.getByText(MOCK_PRODUCTS[0].name).first()).toBeVisible();
    await expect(page.getByText(MOCK_PRODUCTS[1].name).first()).toBeVisible();

    // El input tiene 1s de debounce antes de consultar al API.
    await page.getByPlaceholder("Buscar en catálogo...").fill("Leche");

    await expect(page.getByText(MOCK_PRODUCTS[1].name)).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByText(MOCK_PRODUCTS[0].name).first()).toBeVisible();
  });

  test("la búsqueda del header sugiere y abre el catálogo filtrado", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Productos Destacados" })).toBeVisible();

    const search = page.getByPlaceholder(
      "Busca productos, marcas y categorías...",
    );
    await search.click();
    await search.fill("Leche");

    // El dropdown muestra los productos encontrados (debounce 400ms).
    await expect(page.getByText("Productos (1)")).toBeVisible();
    await expect(page.getByText(MOCK_PRODUCTS[0].name).first()).toBeVisible();

    await search.press("Enter");
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(page.getByPlaceholder("Buscar en catálogo...")).toHaveValue(
      "Leche",
    );
    await expect(page.getByText(MOCK_PRODUCTS[0].name).first()).toBeVisible();
  });

  test("añadir al carrito actualiza el contador y el subtotal", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(MOCK_PRODUCTS[0].name).first()).toBeVisible();

    await page.getByRole("button", { name: "Agregar 1", exact: true }).click();

    // Abre el drawer del carrito desde el header.
    await page.getByRole("button", { name: /Carrito/ }).click();

    await expect(
      page.getByRole("heading", { name: "Mi Carrito" }),
    ).toBeVisible();
    await expect(page.getByText("Subtotal (1 productos)")).toBeVisible();
    await expect(page.getByText(/4\.500/).first()).toBeVisible();
  });

  test("pantalla de login y login mockeado", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Productos Destacados" })).toBeVisible();

    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();

    // Vista de login dentro del modal. El footer también tiene un input de
    // newsletter con el mismo placeholder: se acota al formulario del modal.
    const loginForm = page
      .locator("form")
      .filter({ has: page.locator('input[name="email"]') });
    await expect(loginForm).toBeVisible();
    await expect(page.getByText("Bienvenido de nuevo a Mercaldas.")).toBeVisible();

    await loginForm
      .locator('input[name="email"]')
      .fill("cliente@mercaldas.test");
    await loginForm.locator('input[name="password"]').fill("clave-segura");

    await loginForm
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();

    // Tras el login el modal desaparece y el header muestra el nombre.
    await expect(loginForm).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Cliente/, exact: false }).first(),
    ).toBeVisible();
  });
});
