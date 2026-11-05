import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROMIUM_LAUNCH_OPTIONS } from "./tests/support/browser";

const here = path.dirname(fileURLToPath(import.meta.url));
const spaDir = (name: string) => path.resolve(here, "..", name);

/** URL de la SPA contra la que se corre el smoke de producción (sin mocks). */
const PROD_BASE_URL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const isProdMode = Boolean(PROD_BASE_URL);

const PORTS = {
  client: 5173,
  admin: 5273,
  picking: 5373,
  delivery: 5473,
} as const;

const localUrl = (port: number) => `http://localhost:${port}`;

/**
 * Servidores de desarrollo de las 4 SPAs.
 *
 * En modo producción (`PLAYWRIGHT_BASE_URL` definido) no se levanta ninguno:
 * el smoke apunta directo al host indicado y no se usan mocks.
 */
const webServer = isProdMode
  ? undefined
  : [
      {
        command: `npm run dev -- --port ${PORTS.client} --strictPort`,
        cwd: spaDir("Interface web client"),
        url: localUrl(PORTS.client),
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
      {
        command: `npm run dev -- --port ${PORTS.admin} --strictPort`,
        cwd: spaDir("Interface web admin"),
        url: localUrl(PORTS.admin),
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
      {
        command: `npm run dev -- --port ${PORTS.picking} --strictPort`,
        cwd: spaDir("Interface web picking admin"),
        url: localUrl(PORTS.picking),
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
      {
        command: `npm run dev -- --port ${PORTS.delivery} --strictPort`,
        cwd: spaDir("Interface web delivery admin"),
        url: localUrl(PORTS.delivery),
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
    ];

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  // Los tests de cada SPA se aíslan por proyecto; el smoke es global.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // En CI se permite un reintento: el arranque en frío de varios Vite en un
  // runner compartido provoca fallos transitorios (no del test).
  retries: process.env.CI ? 1 : 0,
  // Un solo worker: levantar 4 Vite + 4 Chromium en paralelo satura CPU/disco
  // en equipos modestos y provoca timeouts de navegación. La suite es corta.
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  outputDir: "test-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 30_000,
    navigationTimeout: 180_000,
    launchOptions: CHROMIUM_LAUNCH_OPTIONS,
  },
  webServer,
  projects: [
    {
      name: "client",
      testMatch: /client\/.*\.spec\.ts/,
      use: { baseURL: localUrl(PORTS.client), browserName: "chromium" },
    },
    {
      name: "admin",
      testMatch: /admin\/.*\.spec\.ts/,
      use: { baseURL: localUrl(PORTS.admin), browserName: "chromium" },
    },
    {
      name: "picking",
      testMatch: /picking\/.*\.spec\.ts/,
      use: { baseURL: localUrl(PORTS.picking), browserName: "chromium" },
    },
    {
      name: "delivery",
      testMatch: /delivery\/.*\.spec\.ts/,
      use: { baseURL: localUrl(PORTS.delivery), browserName: "chromium" },
    },
    {
      // Smoke: local recorre los 4 hosts; con PLAYWRIGHT_BASE_URL apunta al host
      // de producción indicado. No se mockea nada.
      name: "smoke",
      testMatch: /smoke\.spec\.ts/,
      use: {
        baseURL: PROD_BASE_URL || localUrl(PORTS.client),
        browserName: "chromium",
      },
    },
  ],
});
