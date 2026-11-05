/** Puertos y URLs locales compartidos por la config y los tests. */
export const PORTS = {
  client: 5173,
  admin: 5273,
  picking: 5373,
  delivery: 5473,
} as const;

export const LOCAL_URLS = {
  client: `http://localhost:${PORTS.client}`,
  admin: `http://localhost:${PORTS.admin}`,
  picking: `http://localhost:${PORTS.picking}`,
  delivery: `http://localhost:${PORTS.delivery}`,
} as const;

/** Host del backend en desarrollo (las SPAs leen su VITE_API_URL del .env). */
export const API_ORIGIN = "http://localhost:3000";

/**
 * Modo producción: los tests funcionales se saltan y solo corre el smoke
 * contra `PLAYWRIGHT_BASE_URL`, sin mocks.
 */
export const PROD_BASE_URL = process.env.PLAYWRIGHT_BASE_URL?.trim() || "";
export const IS_PROD_MODE = Boolean(PROD_BASE_URL);

/** Hosts que recorre el smoke cuando no se indicó PLAYWRIGHT_BASE_URL. */
export const SMOKE_TARGETS = IS_PROD_MODE
  ? [{ name: "production", url: PROD_BASE_URL }]
  : [
      { name: "client", url: LOCAL_URLS.client },
      { name: "admin", url: LOCAL_URLS.admin },
      { name: "picking", url: LOCAL_URLS.picking },
      { name: "delivery", url: LOCAL_URLS.delivery },
    ];
