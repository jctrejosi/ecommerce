/** Client ID de OAuth 2.0 (Web) de Google. Vacío = login con Google desactivado. */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as
  | string
  | undefined;

/**
 * `redirect_uri` del flujo de código.
 *
 * En producción la web se sirve por HTTPS en su propio dominio, así que se usa
 * ese origen (p. ej. https://mercaldas.jcti.xyz). Google debe tenerlo registrado
 * en "URIs de redireccionamiento autorizados".
 *
 * En desarrollo/LAN por HTTP se mantiene `http://localhost:4173` (modo loopback
 * autorizado); en la APK el WebView intercepta esa navegación y la reescribe al
 * origen real desde el que está cargada la web.
 *
 * `VITE_GOOGLE_REDIRECT_URI` permite forzar un valor concreto (útil si el
 * redirect vive en otro host/path).
 */
const CONFIGURED_REDIRECT_URI = (
  import.meta.env.VITE_GOOGLE_REDIRECT_URI as string | undefined
)?.trim();

export const GOOGLE_REDIRECT_URI =
  CONFIGURED_REDIRECT_URI ||
  (typeof window !== "undefined" && window.location.protocol === "https:"
    ? window.location.origin
    : "http://localhost:4173");

const PENDING_KEY = "mercaldas-google-oauth-state";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Inicia el login con Google por **redirección de página completa** (no popup).
 *
 * El popup de Google Identity Services no funciona dentro del WebView de la APK
 * (`setSupportMultipleWindows=false` hace que navegue en la misma ventana, sin
 * `window.opener`), así que se usa el flujo de código con redirección.
 */
export function startGoogleLogin(): void {
  if (!GOOGLE_CLIENT_ID) return;
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    sessionStorage.setItem(PENDING_KEY, state);
  } catch {
    /* sin sessionStorage: se omite la verificación de `state` */
  }
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid profile email",
    include_granted_scopes: "true",
    prompt: "select_account",
    state,
  });
  window.location.assign(`${AUTH_ENDPOINT}?${params.toString()}`);
}

/**
 * Si la URL actual trae `?code=…` (retorno de Google), devuelve el código y
 * limpia la URL. Devuelve `null` si no hay un retorno válido.
 */
export function consumeGoogleRedirect(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error =
    url.searchParams.get("error") ??
    new URLSearchParams(url.hash.replace(/^#/, "")).get("error");
  if (!code && !error) return null;

  // Quita los parámetros del OAuth de la URL (sin recargar).
  const clean = new URL(url.toString());
  for (const key of ["code", "state", "scope", "authuser", "prompt", "hd", "error"]) {
    clean.searchParams.delete(key);
  }
  window.history.replaceState(
    null,
    "",
    clean.pathname + clean.search + clean.hash,
  );
  if (error || !code) return null;

  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignorar */
  }
  if (expected && state !== expected) return null;
  return code;
}
