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
      shouldShowList: false,
      shouldPlaySound: true,
      shouldSetBadge: false,
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
  }
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
