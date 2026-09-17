import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Avisos del sistema (bandeja de notificaciones) de la app de picking.
 *
 * Sirven para una sola cosa: que el **ícono de la app muestre el contador rojo
 * de pendientes** (`showBadge` del canal + el número de la notificación). El
 * tono y la vibración los dispara la app por su cuenta (ver `sound.ts`), porque
 * el sonido de un canal de Android lo ignora el modo silencio del dispositivo.
 *
 * `expo-notifications` no existe en Expo Go desde SDK 53 ni en web (el módulo
 * revienta al importarse), así que se carga de forma dinámica.
 */
const IS_EXPO_GO = Constants.executionEnvironment === "storeClient";
const IS_WEB = Platform.OS === "web";

/** Canal silencioso: solo existe para que el launcher pueda pintar el contador. */
const PENDING_CHANNEL = "picking-pending";

/**
 * Id fijo de la notificación del contador: republicar con él ACTUALIZA la misma
 * notificación en lugar de acumular una por pedido en la bandeja.
 */
const PENDING_NOTIFICATION_ID = "dsi-picking-pending";

type NotificationsModule = typeof import("expo-notifications");

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (IS_EXPO_GO || IS_WEB) return null;
  try {
    return await import("expo-notifications");
  } catch (err) {
    console.warn("⚠️ expo-notifications no disponible:", err);
    return null;
  }
}

export async function configureNotifications(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // Sin banner ni tono: el aviso al picker lo da el tono propio + la
      // vibración. La notificación solo deja el rastro (y el contador) en la
      // bandeja, que es lo que el launcher usa para el badge.
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });

  if (Platform.OS === "android") {
    // El canal se crea UNA vez: recrearlo en cada arranque borraría las
    // notificaciones publicadas y, con ellas, el contador del ícono.
    const channel = await Notifications.getNotificationChannelAsync(
      PENDING_CHANNEL,
    ).catch(() => null);
    if (!channel) {
      await Notifications.setNotificationChannelAsync(PENDING_CHANNEL, {
        name: "Pendientes de picking",
        importance: Notifications.AndroidImportance.LOW,
        sound: null,
        vibrationPattern: null,
        enableVibrate: false,
        showBadge: true,
      });
    }
  }
}

/** Permiso de notificaciones (Android 13+ lo exige). Devuelve si quedó concedido. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const next = await Notifications.requestPermissionsAsync();
    return next.granted;
  } catch {
    return false;
  }
}

/**
 * Refleja en el ícono de la app cuántas notificaciones quedan sin leer.
 *
 * Publica (o actualiza) una única notificación silenciosa con ese número. Un
 * `count` de 0 la retira y con ella el contador.
 */
export async function setPendingBadge(count: number): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  const total = Math.max(0, Math.floor(count));
  try {
    if (total === 0) {
      await Notifications.setBadgeCountAsync(0);
      await Notifications.dismissNotificationAsync(PENDING_NOTIFICATION_ID);
      return;
    }
    if (!(await ensureNotificationPermission())) return;

    await Notifications.scheduleNotificationAsync({
      identifier: PENDING_NOTIFICATION_ID,
      content: {
        title: "Tienes pendientes",
        body:
          total === 1
            ? "1 pedido o mensaje sin leer"
            : `${total} pedidos o mensajes sin leer`,
        badge: total,
        sound: false,
      },
      trigger: null,
    });
    await Notifications.setBadgeCountAsync(total);
    console.log(`[badge] contador del ícono: ${total}`);
  } catch (err) {
    console.warn("⚠️ no se pudo actualizar el contador del ícono:", err);
  }
}
