import icono from '../assets/delivery.png';

/**
 * Notificaciones del navegador (Notification API).
 *
 * Mientras el panel está abierto —aunque esté en otra pestaña o minimizado— el
 * socket sigue recibiendo los mensajes, así que una notificación del sistema
 * avisa al administrador sin tener que mirar la pantalla.
 *
 * No es push: si se cierra el navegador no hay aviso (eso exigiría Web Push con
 * service worker y claves VAPID). Además la API exige contexto seguro, así que
 * solo funciona en `https://` o en `localhost`; servido por IP en http queda
 * bloqueada por el navegador y aquí se reporta como `insecure`.
 */

export type NotificationPermissionState =
  | 'unsupported'
  | 'insecure'
  | 'default'
  | 'granted'
  | 'denied';

/** ¿El navegador puede mostrar notificaciones en este contexto? */
export function notificationsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    window.isSecureContext !== false
  );
}

/** Estado actual del permiso, con los motivos de "no se puede" separados. */
export function notificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (!window.isSecureContext) return 'insecure';
  return Notification.permission;
}

/**
 * Pide permiso al usuario. Debe invocarse desde un clic: los navegadores
 * ignoran la petición si no hay gesto previo.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!notificationsSupported()) return notificationPermission();
  try {
    await Notification.requestPermission();
  } catch {
    /* Safari y algunos móviles lo rechazan: se devuelve el estado real */
  }
  return notificationPermission();
}

export interface NotifyOptions {
  title: string;
  body?: string;
  /** Reemplaza la notificación previa del mismo hilo en vez de apilar. */
  tag?: string;
  /** Al pulsarla: enfoca la pestaña y ejecuta esto. */
  onClick?: () => void;
}

/** Muestra una notificación del sistema. Devuelve `true` si se pudo mostrar. */
export function notify({ title, body, tag, onClick }: NotifyOptions): boolean {
  if (notificationPermission() !== 'granted') return false;
  try {
    const notification = new Notification(title, { body, tag, icon: icono });
    notification.onclick = () => {
      window.focus();
      notification.close();
      onClick?.();
    };
    return true;
  } catch {
    // Algunos navegadores lanzan si no hay gesto de usuario de por medio.
    return false;
  }
}
