import { test, expect } from "@playwright/test";
import { IS_PROD_MODE, SMOKE_TARGETS } from "./support/urls";

/**
 * Smoke global.
 *
 * - Sin PLAYWRIGHT_BASE_URL recorre las 4 SPAs locales (los webServer del
 *   config las levantan).
 * - Con PLAYWRIGHT_BASE_URL=<url> verifica ese único host de producción y NO
 *   instala ningún mock.
 *
 * Sólo comprueba que el host responde, que se renderiza contenido y que no hay
 * errores de consola críticos. Se filtran los ruidos esperables en un smoke sin
 * backend (recursos de red, sockets y tiles del mapa).
 */

const NOISE = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /ERR_CONNECTION/i,
  /Failed to fetch/i,
  /Load failed/i,
  /NetworkError/i,
  /the server responded with a status of \d{3}/i,
  /socket\.io/i,
  /websocket/i,
  /WebGL/i,
  /maplibre/i,
  /TileJSON/i,
  /openfreemap/i,
  /\/ofm\//i,
  /favicon/i,
  /AbortError/i,
];

function isKnownNoise(message: string): boolean {
  return NOISE.some((re) => re.test(message));
}

test.describe("Smoke · hosts", () => {
  for (const target of SMOKE_TARGETS) {
    test(`${target.name} responde y renderiza`, async ({ page }) => {
      const critical: string[] = [];

      page.on("pageerror", (error) => {
        critical.push(`pageerror: ${error.message}`);
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (!isKnownNoise(text)) critical.push(`console: ${text}`);
      });

      const response = await page.goto(target.url, {
        waitUntil: "domcontentloaded",
      });

      expect(response, `Sin respuesta HTTP de ${target.url}`).not.toBeNull();
      expect(
        response!.status(),
        `Estado HTTP inesperado en ${target.url}`,
      ).toBeLessThan(500);

      // La SPA monta de forma asíncrona: se espera a que el body tenga texto.
      await expect
        .poll(
          async () => (await page.locator("body").innerText()).trim().length,
          { timeout: 20_000, message: `${target.name} no renderizó contenido` },
        )
        .toBeGreaterThan(20);

      await expect(page.locator("body")).toBeVisible();

      // Deja pasar un instante para capturar errores tardíos de arranque.
      await page.waitForTimeout(1_000);
      expect(
        critical,
        `Errores de consola críticos en ${target.url}:\n${critical.join("\n")}`,
      ).toEqual([]);
    });
  }

  test("el modo de ejecución es coherente", async () => {
    // Guardia: el smoke en producción no debe levantar servidores locales.
    expect(IS_PROD_MODE || SMOKE_TARGETS.length === 4).toBe(true);
  });
});
