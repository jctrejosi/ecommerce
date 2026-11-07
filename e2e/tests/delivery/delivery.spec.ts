import { test, expect, type Page } from "@playwright/test";
import {
  blockMapTiles,
  installApiMocks,
  MOCK_DRIVER,
  MOCK_FLEET_ORDER,
} from "../support/mockApi";
import { IS_PROD_MODE } from "../support/urls";

async function login(page: Page) {
  await page.getByPlaceholder("admin@tienda.com").fill("admin");
  await page.getByPlaceholder("••••••••").fill("clave-segura");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mapa", exact: true }),
  ).toBeVisible();
}

/**
 * Flujos críticos del admin de delivery (Interface web delivery admin).
 * Los tiles del mapa se bloquean para no depender de internet.
 */
test.describe("Delivery admin", () => {
  test.skip(
    IS_PROD_MODE,
    "Modo producción (PLAYWRIGHT_BASE_URL): sólo corre el smoke sin mocks.",
  );

  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await blockMapTiles(page);
  });

  test("muestra la pantalla de login", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Mercaldas Delivery")).toBeVisible();
    await expect(page.getByPlaceholder("admin@tienda.com")).toBeVisible();
    await expect(page.getByPlaceholder("••••••••")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ingresar", exact: true }),
    ).toBeVisible();
  });

  test("login mockeado entra a la pantalla principal", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);

    await expect(
      page.getByRole("button", { name: "Repartidores", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pedidos", exact: true }),
    ).toBeVisible();
  });

  test("la pestaña Repartidores lista la flota mockeada", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);

    await page
      .getByRole("button", { name: "Repartidores", exact: true })
      .click();

    await expect(
      page.getByRole("heading", { name: "Repartidores", exact: true }),
    ).toBeVisible();
    // La tabla visible; el mapa (oculto) también contiene el nombre del driver.
    await expect(
      page.locator("table").getByText(MOCK_DRIVER.fullName).first(),
    ).toBeVisible();
    await expect(
      page.locator("table").getByText(MOCK_DRIVER.vehiclePlate).first(),
    ).toBeVisible();
  });

  test("la pestaña Pedidos lista el pedido mockeado", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);

    await page.getByRole("button", { name: "Pedidos", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Pedidos", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("table").getByText(MOCK_FLEET_ORDER.referenceCode).first(),
    ).toBeVisible();
    await expect(
      page.locator("table").getByText(MOCK_FLEET_ORDER.driverName).first(),
    ).toBeVisible();
  });
});
