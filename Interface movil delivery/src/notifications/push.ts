import Constants from "expo-constants";
import { Platform } from "react-native";
import { api, USE_MOCK } from "@/api";

/**
 * Push (expo-notifications) NO existe en Expo Go desde SDK 53 ni en web: el
 * módulo lanza un error solo al importarse. Por eso se carga dinámicamente y
 * solo en dev build / build de producción nativo.
 */
const IS_EXPO_GO = Constants.executionEnvironment === "storeClient";
const IS_WEB = Platform.OS === "web";

/**
 * Canal Android de los avisos que publica la propia app (pedido nuevo).
 *
 * Es **silencioso** a propósito: el tono y la vibración los dispara la app a
 * mano (ver `newOrderAlert.ts`), porque el sonido de un canal lo ignora el modo
 * silencio del teléfono. Así no se duplican (canal + app) y suena siempre.
 */
const ORDER_CHANNEL = "delivery-orders";

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
      shouldShowBanner: true,
      // En la lista (bandeja) es lo que hace que el lanzador pinte el punto rojo
      // en el icono de la app.
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  if (Platform.OS === "android") {
    // El canal se recrea para que tome el tono propio: Android ignora los
    // cambios de sonido en un canal que ya existe.
    await Notifications.deleteNotificationChannelAsync("delivery").catch(() => {});
    await Notifications.setNotificationChannelAsync("delivery", {
      name: "Pedidos y mensajes",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      // Tono "rockerito" (android/app/src/main/res/raw/rockerito.wav).
      sound: "rockerito.wav",
    });

    // El canal de los avisos propios se crea UNA vez: recrearlo en cada arranque
    // borraría las notificaciones ya publicadas (y con ellas el punto rojo).
    const ordersChannel = await Notifications.getNotificationChannelAsync(
      ORDER_CHANNEL,
    ).catch(() => null);
    if (!ordersChannel) {
      await Notifications.setNotificationChannelAsync(ORDER_CHANNEL, {
        name: "Pedidos nuevos",
        importance: Notifications.AndroidImportance.HIGH,
        sound: null,
        vibrationPattern: null,
        enableVibrate: false,
        showBadge: true,
      });
    }
  }
}

/**
 * Permiso de notificaciones (Android 13+ lo exige). Devuelve si quedó concedido.
 */
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
 * Publica el aviso de "pedido nuevo" en la bandeja del sistema.
 *
 * Va por el canal silencioso: el objetivo es que quede una notificación viva
 * (punto rojo en el icono de la app) y que al tocarla se abra el pedido.
 */
export async function publishNewOrderNotification(order: {
  id: number | string;
  referenceCode: string;
}): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  if (!(await ensureNotificationPermission())) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Nuevo pedido asignado",
        body: `${order.referenceCode} · ábrelo para aceptarlo`,
        data: { orderId: String(order.id) },
        sound: false,
      },
      // `null` = inmediata.
      trigger: null,
    });
  } catch (err) {
    console.warn("⚠️ no se pudo publicar el aviso de pedido nuevo:", err);
  }
}

/** Contador del icono (los lanzadores que lo soportan muestran el número). */
export async function setAppBadge(count: number): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    /* el lanzador puede no soportarlo */
  }
}

/** Quita el contador y las notificaciones de la bandeja (y con ellas el punto). */
export async function clearAppAlerts(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.setBadgeCountAsync(0);
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    /* sin notificaciones no hay nada que limpiar */
  }
}

/**
 * Al tocar una notificación se abre el pedido al que se refiere.
 *
 * Cubre los dos caminos: la app ya abierta (listener) y la app lanzada por el
 * toque (respuesta pendiente), que es el caso normal desde el icono.
 */
export async function setNotificationTapHandler(
  onOrder: (orderId: string) => void,
): Promise<() => void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return () => {};

  const open = (response: { notification: { request: { content: { data?: unknown } } } } | null) => {
    const data = response?.notification.request.content.data as
      | { orderId?: unknown }
      | undefined;
    if (typeof data?.orderId === "string" && data.orderId) onOrder(data.orderId);
  };

  const subscription = Notifications.addNotificationResponseReceivedListener(open);

  // App lanzada (o traída al frente) por el toque de la notificación.
  try {
    open(await Notifications.getLastNotificationResponseAsync());
  } catch {
    /* sin respuesta pendiente */
  }

  return () => subscription.remove();
}

/**
 * Pide permisos y registra el token FCM en el backend.
 * En modo mock o Expo Go devuelve null sin romper.
 */
export async function registerPushToken(): Promise<string | null> {
  if (USE_MOCK) return null;
  const Notifications = await loadNotifications();
  if (!Notifications) return null;

  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return null;

    const projectId = Constants.easConfig?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await api.setPushToken(token.data);
    return token.data;
  } catch (err) {
    console.warn("⚠️ No se pudo registrar el token push:", err);
    return null;
  }
}
