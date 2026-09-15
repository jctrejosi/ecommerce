import { AppState } from "react-native";
import { api, USE_MOCK } from "@/api";

/**
 * Presencia del repartidor.
 *
 * Los pings GPS solo se envían mientras hay una entrega activa, así que un
 * repartidor conectado pero sin pedido era indistinguible de uno con la app
 * cerrada hace horas. Este heartbeat avisa al backend cada minuto que la app
 * sigue viva, y el panel de delivery usa esa marca para mostrar "Conectado" o
 * "Desconectado".
 */
const HEARTBEAT_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;

function ping() {
  void api.sendHeartbeat().catch(() => {
    // Sin red: el siguiente latido reintenta.
  });
}

export function startPresenceHeartbeat(): void {
  stopPresenceHeartbeat();
  if (USE_MOCK) return;
  ping();
  timer = setInterval(ping, HEARTBEAT_MS);
  // Al volver del segundo plano se avisa ya, sin esperar al siguiente tick.
  appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active") ping();
  });
}

export function stopPresenceHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  appStateSub?.remove();
  appStateSub = null;
}
