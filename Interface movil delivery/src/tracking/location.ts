import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { isRunningInExpoGo } from "expo";
import { enqueuePing, flushQueue } from "./queue";
import { api } from "@/api";
import type { LatLng } from "@/api/types";

export const BACKGROUND_LOCATION_TASK = "delivery-background-location";

/**
 * En Expo Go (SDK 53+) y en web no existe el background location. Al llamar
 * igual a `hasStartedLocationUpdatesAsync`/`stopLocationUpdatesAsync`,
 * expo-location emite un warning ruidoso en consola. Se evita invocarla ahí;
 * en dev build funciona normal.
 */
const BG_UNAVAILABLE = Platform.OS === "web" || isRunningInExpoGo();

let subscription: Location.LocationSubscription | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function toPing(pos: Location.LocationObject) {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    speed: pos.coords.speed ?? null,
    heading: pos.coords.heading ?? null,
    timestamp: new Date(pos.timestamp).toISOString(),
  };
}

/**
 * Tarea de ubicación en background (se registra al cargar el bundle).
 * Se ejecuta aunque la app esté cerrada o minimizada: encola cada lectura y
 * aprovecha la ventana de ejecución para intentar enviar la cola.
 * (En web no existe TaskManager: se omite el registro.)
 */
if (Platform.OS !== "web") {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn(`⚠️ [bg-location] ${error.message}`);
      return;
    }
    const { locations } = data as { locations: Location.LocationObject[] };
    for (const loc of locations ?? []) {
      void enqueuePing(toPing(loc));
    }
    // En background no corre el flusher de foreground: intentar enviar ya.
    await flushQueue((ping) => api.sendLocation(ping)).catch(() => {
      /* sin red: la cola se reintenta en la próxima lectura */
    });
  });
}

export async function requestLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

/** Permiso "siempre" (Android 11+ requiere primero el de primer plano). */
export async function requestBackgroundPermission(): Promise<boolean> {
  if (BG_UNAVAILABLE) return false;
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted") return false;
    const bg = await Location.requestBackgroundPermissionsAsync();
    return bg.status === "granted";
  } catch {
    return false;
  }
}

export async function getCurrentPosition(): Promise<LatLng | null> {
  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Tracking en primer plano (fase 1): ping cada 15 s o 20 m según movimiento.
 * Si el tracking en background ya está activo, no se duplica (la tarea cubre
 * también el primer plano).
 */
export async function startDeliveryTracking(
  send: (ping: Parameters<typeof enqueuePing>[0]) => Promise<void>,
): Promise<boolean> {
  try {
    if (!BG_UNAVAILABLE) {
      if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
        return true; // background activo: evita pings duplicados
      }
    }
  } catch {
    /* sigue con foreground */
  }

  const granted = await requestLocationPermission();
  if (!granted) return false;

  subscription = null;
  try {
    subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15_000, // ms entre lecturas
        distanceInterval: 20, // metros mínimos de movimiento
      },
      (pos) => {
        void enqueuePing(toPing(pos));
      },
    );
  } catch {
    // watch no disponible (p. ej. web sin permisos): se degrada sin romper.
    subscription = null;
    return true;
  }

  flushTimer = setInterval(() => {
    void flushQueue(send);
  }, 15_000);

  return true;
}

export function stopDeliveryTracking(): void {
  if (subscription) {
    subscription.remove();
    subscription = null;
  }
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

/**
 * Inicia las actualizaciones de ubicación en background con foreground service
 * (Android). Requiere dev build + permiso "siempre". En Expo Go/web no hace
 * nada (sin warnings).
 */
export async function startBackgroundTracking(): Promise<boolean> {
  if (BG_UNAVAILABLE) return false;

  const granted = await requestBackgroundPermission();
  if (!granted) {
    console.warn("⚠️ [bg-location] permiso de ubicación en background denegado");
    return false;
  }

  try {
    const running = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK,
    );
    if (!running) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15_000,
        distanceInterval: 20,
        pausesUpdatesAutomatically: true,
        foregroundService: {
          notificationTitle: "Delivery activo",
          notificationBody: "Enviando tu ubicación mientras entregas el pedido",
          notificationColor: "#2563EB",
        },
      });
    }
    return true;
  } catch (err) {
    console.warn("⚠️ [bg-location] no se pudo iniciar:", err);
    return false;
  }
}

export async function stopBackgroundTracking(): Promise<void> {
  if (BG_UNAVAILABLE) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch {
    /* noop */
  }
}

export function isTracking(): boolean {
  return subscription !== null;
}
