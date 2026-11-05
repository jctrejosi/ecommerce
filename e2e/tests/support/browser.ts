import fs from "node:fs";

/**
 * Opciones de lanzamiento de Chromium compartidas por la config y el warm-up.
 *
 * En algunos Linux (p. ej. Kali) el Chromium empaquetado por Playwright no
 * completa el handshake CDP y el launch se cuelga. Si existe un Chromium del
 * sistema se usa ese; si no, cae al binario de
 * `npx playwright install chromium`.
 */
export const SYSTEM_CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (["/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) =>
    fs.existsSync(p),
  ) as string | undefined);

export const CHROMIUM_LAUNCH_OPTIONS = {
  ...(SYSTEM_CHROMIUM ? { executablePath: SYSTEM_CHROMIUM } : {}),
  // Necesario en contenedores/CI y en equipos donde el sandbox de Chromium no
  // está configurado (setuid). No afecta a la app bajo prueba.
  // `--disable-webgl`: el mapa de delivery (MapLibre + SwiftShader) bloquea el
  // hilo principal y vuelve inestable el panel. Sin WebGL la app muestra su
  // fallback de "mapa no disponible" y el resto del panel funciona igual.
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-webgl"],
};
