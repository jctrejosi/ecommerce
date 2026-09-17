/**
 * Notificaciones del navegador para los avisos del cliente.
 *
 * Solo se muestran si el usuario ya dio permiso; el permiso se pide una vez, en
 * el primer gesto del usuario (los navegadores no dejan pedirlo sin
 * interacción). En WebViews que no exponen la API esto queda inactivo.
 */

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** El usuario ya concedió permiso para mostrar notificaciones. */
export function canShowNotifications(): boolean {
  return notificationsSupported() && Notification.permission === "granted";
}

/**
 * Pide el permiso si el usuario aún no ha decidido. Conviene llamarlo dentro de
 * un gesto; si no lo es, el navegador puede ignorarlo.
 */
export function requestNotificationPermission(): void {
  if (!notificationsSupported() || Notification.permission !== "default") return;
  try {
    void Notification.requestPermission().catch(() => {});
  } catch {
    /* el navegador no permite pedirlo en este contexto */
  }
}

/** Muestra el aviso del navegador (no hace nada si no hay permiso). */
export function showBrowserNotification(title: string, body: string): void {
  if (!canShowNotifications()) return;
  try {
    const notification = new Notification(title, {
      body,
      icon: "/favicon.svg",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    /* WebView sin soporte real para notificaciones */
  }
}
