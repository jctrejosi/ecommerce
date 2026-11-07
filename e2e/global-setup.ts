import { chromium, type FullConfig } from "@playwright/test";
import { CHROMIUM_LAUNCH_OPTIONS } from "./tests/support/browser";
import { LOCAL_URLS, IS_PROD_MODE } from "./tests/support/urls";

/**
 * Warm-up de las SPAs antes de los tests.
 *
 * `webServer` sólo espera a que Vite responda el index.html, pero la primera
 * carga real dispara la optimización de dependencias de Vite (y en la tienda
 * `optimizeDeps.force` la repite en cada arranque). Si eso cae dentro del primer
 * test, el `page.goto` puede superar el timeout. Aquí se absorbe esa compilación
 * fuera del tiempo de los tests.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  if (IS_PROD_MODE) return;

  // Con `--project=client` sólo hace falta precalentar esa SPA. El smoke recorre
  // los 4 hosts, así que calienta todos.
  const selected = new Set(config.projects.map((project) => project.name));
  const warmAll = selected.has("smoke");
  const targets = Object.entries(LOCAL_URLS).filter(
    ([name]) => warmAll || selected.has(name),
  );

  if (targets.length === 0) return;

  const browser = await chromium.launch({
    headless: true,
    ...CHROMIUM_LAUNCH_OPTIONS,
  });

  try {
    for (const [name, url] of targets) {
      const page = await browser.newPage();
      // Sin backend ni internet: se bloquean fuentes y tiles para que la
      // precarga no dependa de la red.
      await page.route(
        /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//,
        (route) =>
          route.fulfill({ status: 200, contentType: "text/css", body: "" }),
      );
      await page.route("**/ofm/**", (route) =>
        route.fulfill({ status: 404, contentType: "text/plain", body: "" }),
      );

      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 300_000,
        });
        // Deja que React monte y que Vite termine de compilar los módulos
        // que se importan en la primera pantalla.
        await page.waitForTimeout(1_500);
      } catch (error) {
        console.warn(
          `[global-setup] No se pudo precalentar ${name} (${url}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}
