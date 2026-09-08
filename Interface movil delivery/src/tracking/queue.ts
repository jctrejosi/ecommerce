import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LocationPing } from "@/api/types";

const QUEUE_KEY = "dsi_delivery_ping_queue";
const MAX_QUEUE = 200;

/**
 * Cola offline de pings GPS: se encola siempre; un flusher periódico los
 * envía al backend y solo los descarta cuando el envío tuvo éxito.
 */
export async function enqueuePing(ping: LocationPing): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: LocationPing[] = raw ? (JSON.parse(raw) as LocationPing[]) : [];
    queue.push(ping);
    while (queue.length > MAX_QUEUE) queue.shift();
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // almacenamiento no disponible: se descarta el ping (no es crítico)
  }
}

export async function peekQueue(): Promise<LocationPing[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as LocationPing[]) : [];
  } catch {
    return [];
  }
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

/** Envía todos los pings pendientes y borra solo los enviados. */
export async function flushQueue(send: (ping: LocationPing) => Promise<void>): Promise<void> {
  const queue = await peekQueue();
  if (queue.length === 0) return;

  const remaining: LocationPing[] = [];
  for (const ping of queue) {
    try {
      await send(ping);
    } catch {
      remaining.push(ping);
    }
  }
  if (remaining.length === queue.length) return; // sin red: conservar todo
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  } catch {
    /* noop */
  }
}
