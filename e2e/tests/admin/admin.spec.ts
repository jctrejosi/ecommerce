import { test, expect, type Page } from "@playwright/test";
import {
  installApiMocks,
  MOCK_ADMIN_ORDER,
  MOCK_PRODUCTS,
} from "../support/mockApi";
import { IS_PROD_MODE } from "../support/urls";

async function login(page: Page) {
  await page.getByPlaceholder("admin-ecommerce").fill("admin-ecommerce");
  await page.getByPlaceholder("••••••••").fill("clave-segura");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Ana/ }),
  ).toBeVisible();
}

/**
 * Flujos críticos del panel administrativo (Interface web admin).
 */
test.describe("Admin · panel", () => {
  test.skip(
    IS_PROD_MODE,
    "Modo producción (PLAYWRIGHT_BASE_URL): sólo corre el smoke sin mocks.",
  );

  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test("muestra la pantalla de login", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Usuario o correo")).toBeVisible();
    await expect(page.getByPlaceholder("admin-ecommerce")).toBeVisible();
    await expect(page.getByPlaceholder("••••••••")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ingresar", exact: true }),
    ).toBeVisible();
  });

  test("login mockeado entra al dashboard", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);

    // El sidebar y el topbar del panel ya están disponibles.
    await expect(page.getByText("Dashboard", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Productos", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Pedidos", { exact: true }).first()).toBeVisible();
  });

  test("listado de pedidos con datos mockeados", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);

    // Navegación dentro de la app: evita un boot completo (health-check) y es
    // más estable que recargar /orders.
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Pedidos", exact: true })
      .click();
    await expect(page.getByText("Listado de pedidos")).toBeVisible();
    await expect(page.getByText(MOCK_ADMIN_ORDER.id).first()).toBeVisible();
    await expect(page.getByText(MOCK_ADMIN_ORDER.customer).first()).toBeVisible();
  });

  test("listado de productos con datos mockeados", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);

    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Productos", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Productos", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(MOCK_PRODUCTS[0].name).first()).toBeVisible();
    await expect(page.getByText(MOCK_PRODUCTS[1].name).first()).toBeVisible();
  });
});
