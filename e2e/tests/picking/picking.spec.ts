import { test, expect, type Page } from "@playwright/test";
import { installApiMocks, MOCK_PICKING_ORDER } from "../support/mockApi";
import { IS_PROD_MODE } from "../support/urls";

async function login(page: Page) {
  await page.getByPlaceholder("admin").fill("admin");
  await page.getByPlaceholder("••••••••").fill("clave-segura");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Picking Admin/ }),
  ).toBeVisible();
}

/**
 * Flujos críticos del admin de picking (Interface web picking admin).
 */
test.describe("Picking admin", () => {
  test.skip(
    IS_PROD_MODE,
    "Modo producción (PLAYWRIGHT_BASE_URL): sólo corre el smoke sin mocks.",
  );

  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test("muestra la pantalla de login", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByText("Inicia sesión con tu usuario administrador"),
    ).toBeVisible();
    await expect(page.getByPlaceholder("admin")).toBeVisible();
    await expect(page.getByPlaceholder("••••••••")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ingresar", exact: true }),
    ).toBeVisible();
  });

  test("login mockeado entra a la pantalla principal (estanterías)", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);

    await expect(
      page.getByRole("button", { name: "Estanterías", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pedidos", exact: true }),
    ).toBeVisible();
    // Datos de la sucursal y estanterías mockeadas.
    await expect(page.getByText("Sucursal Centro").first()).toBeVisible();
    await expect(page.getByText(/Estantería Lácteos/).first()).toBeVisible();
  });

  test("la pestaña Pedidos lista el pedido mockeado", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);

    await page.getByRole("button", { name: "Pedidos", exact: true }).click();
    await expect(page.getByText(MOCK_PICKING_ORDER.referenceCode)).toBeVisible();
    await expect(page.getByText(MOCK_PICKING_ORDER.customerName)).toBeVisible();
  });
});
