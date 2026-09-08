import * as Location from "expo-location";
import { enqueuePing } from "./queue";
import type { LatLng } from "@/api/types";

let subscription: Location.LocationSubscription | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;

export async function requestLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
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
 * Inicia el tracking en foreground (fase 1): ping cada 15 s o 20 m según
 * movimiento. Los pings se encolan y un flusher los envía cada 15 s.
 * Se detiene solo con `stopDeliveryTracking()`.
 */
export async function startDeliveryTracking(send: (ping: Parameters<typeof enqueuePing>[0]) => Promise<void>): Promise<boolean> {
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
        void enqueuePing({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed ?? null,
          heading: pos.coords.heading ?? null,
          timestamp: new Date(pos.timestamp).toISOString(),
        });
      },
    );
  } catch {
    // watch no disponible (p. ej. web sin permisos): se degrada sin romper.
    subscription = null;
    return true;
  }

  flushTimer = setInterval(() => {
    void import("@/tracking/queue").then(({ flushQueue }) =>
      flushQueue(async (ping) => {
        await send(ping);
      }),
    );
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

export function isTracking(): boolean {
  return subscription !== null;
}
