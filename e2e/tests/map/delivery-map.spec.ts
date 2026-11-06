import { test, expect, type Page } from "@playwright/test";
import { blockMapTiles, installApiMocks } from "../support/mockApi";
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
 * Busca un punto del canvas sin overlays ni pines encima. Arrastrar justo
 * sobre un pin no mueve la cámara (el pin corta la propagación), y los paneles
 * flotantes del mapa también bloquean el gesto.
 */
async function pointOnCanvas(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
) {
  const candidates: Array<[number, number]> = [
    [0.5, 0.85],
    [0.25, 0.85],
    [0.75, 0.85],
    [0.5, 0.2],
    [0.25, 0.2],
    [0.75, 0.2],
    [0.4, 0.7],
    [0.6, 0.7],
  ];
  for (const [fx, fy] of candidates) {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    const free = await page.evaluate(
      ([px, py]) => document.elementFromPoint(px, py)?.tagName === "CANVAS",
      [x, y],
    );
    if (free) return { x, y };
  }
  throw new Error("No hay un punto libre sobre el canvas del mapa");
}

/**
 * Mapa de flota con WebGL real (proyecto `map`).
 *
 * El resto de la suite corre con `--disable-webgl` porque SwiftShader es lento
 * y hace inestable el panel. Aquí se habilita a propósito para comprobar que
 * MapLibre pinta el canvas, crea los pines y responde a arrastre y zoom.
 *
 * Los tiles se bloquean (`blockMapTiles`): el estilo cae al fallback
 * empaquetado y la cámara sigue funcionando sin salir a internet.
 */
test.describe("Delivery admin · mapa", () => {
  test.skip(
    IS_PROD_MODE,
    "Modo producción (PLAYWRIGHT_BASE_URL): sólo corre el smoke sin mocks.",
  );

  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, { activeDriver: true });
    await blockMapTiles(page);
  });

  test("pinta los pines y responde a arrastre y zoom", async ({ page }) => {
    test.setTimeout(180_000);

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await login(page);

    await page.getByRole("button", { name: "Mapa", exact: true }).click();

    // No debe caer al fallback de "sin WebGL".
    await expect(page.getByText(/no permite dibujar el mapa/i)).toHaveCount(0);

    const canvas = page.locator("canvas.maplibregl-canvas");
    await expect(canvas).toBeVisible({ timeout: 60_000 });

    const box = await canvas.boundingBox();
    expect(box, "el canvas debe tener caja").not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);

    // Dos pines al abrir: moto del repartidor y casa de destino. La sucursal
    // sólo se pinta cuando hay un repartidor seleccionado.
    const driver = page.locator(".ml-pin");
    const destination = page.locator(".ml-dest");
    await expect(driver).toHaveCount(1, { timeout: 30_000 });
    await expect(destination).toHaveCount(1);
    await expect(page.locator(".maplibregl-marker")).toHaveCount(2);

    // ── Selección: al pulsar el pin aparece la sucursal de recogida ──
    await driver.click();
    await expect(page.locator(".ml-pin--sel")).toHaveCount(1);
    await expect(page.locator(".ml-branch")).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(page.locator(".maplibregl-marker")).toHaveCount(3);

    // Al seleccionar, el mapa hace `fitBounds` con animación (700 ms). Si se
    // arrastra antes de que acabe, la animación pisa el gesto y el pin vuelve a
    // su sitio: se espera a que el encuadre termine.
    await page.waitForTimeout(1_200);

    // ── Arrastre: la cámara se mueve y los pines cambian de posición ──
    const before = await driver.boundingBox();
    expect(before).not.toBeNull();

    const start = await pointOnCanvas(page, box!);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (const [dx, dy] of [
      [-35, -20],
      [-70, -45],
      [-105, -65],
      [-140, -90],
    ]) {
      await page.mouse.move(start.x + dx, start.y + dy);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();

    await expect
      .poll(
        async () => {
          const after = await driver.boundingBox();
          if (!after || !before) return false;
          // El gesto arrastra hacia arriba-izquierda: el pin debe acompañarlo.
          return after.x < before.x - 10 && after.y < before.y - 10;
        },
        { timeout: 15_000, message: "los pines deben desplazarse con el mapa" },
      )
      .toBe(true);

    // ── Zoom con rueda: los pines se separan entre sí ──
    const separation = async () => {
      const a = await driver.boundingBox();
      const b = await destination.boundingBox();
      if (!a || !b) return 0;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const separationBefore = await separation();

    const zoomPoint = await pointOnCanvas(page, box!);
    await page.mouse.move(zoomPoint.x, zoomPoint.y);
    await page.mouse.wheel(0, -700);

    await expect
      .poll(separation, {
        timeout: 15_000,
        message: "el zoom debe separar los pines",
      })
      .toBeGreaterThan(separationBefore + 10);

    expect(pageErrors).toEqual([]);
  });
});
