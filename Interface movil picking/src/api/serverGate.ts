import { create } from "zustand";
import { getApiUrl, loadApiUrl, setApiUrl } from "./apiConfig";
import { probeBackend, sweepLocalNetwork } from "./discovery";
import { connectPickingSocket, disconnectPickingSocket } from "@/socket";
import { getTokens } from "@/auth/session";
import { queryClient } from "@/lib/queryClient";

/**
 * Estado del backend local. La app busca el servidor en la red local al
 * arrancar y, además, cada vez que vuelve a primer plano o cambia la
 * conectividad (otra red Wi-Fi, se cayó el Wi-Fi, etc.).
 */
export type ServerStatus = "checking" | "ok" | "missing";

interface ServerGateState {
  status: ServerStatus;
  /** URL activa del backend (la última que respondió). */
  url: string;
  /**
   * Asegura que la URL activa siga respondiendo; si no, vuelve a barrer la
   * subred actual. `force` ignora el intervalo mínimo entre chequeos.
   */
  ensureServer: (force?: boolean) => Promise<void>;
}

/** No repetir el chequeo si acaba de correr (evita barridos en ráfaga). */
const MIN_INTERVAL_MS = 8_000;

let inFlight: Promise<void> | null = null;
let lastCheckAt = 0;

export const useServerGate = create<ServerGateState>((set) => ({
  status: "checking",
  url: getApiUrl(),

  ensureServer: async (force = false) => {
    // Un solo barrido a la vez, sin importar cuántos disparadores lo pidan.
    if (inFlight) return inFlight;

    const now = Date.now();
    const { status } = useServerGate.getState();
    if (!force && status === "ok" && now - lastCheckAt < MIN_INTERVAL_MS) return;

    inFlight = (async () => {
      lastCheckAt = Date.now();
      await loadApiUrl();

      // 1) Camino rápido: la URL guardada sigue respondiendo (misma red).
      if (await probeBackend(getApiUrl())) {
        set({ status: "ok", url: getApiUrl() });
        return;
      }

      // 2) Cambió la red o el servidor: vuelve a buscarlo en la subred actual.
      set({ status: "checking" });
      const previous = getApiUrl();
      const found = await sweepLocalNetwork();
      if (!found) {
        set({ status: "missing", url: previous });
        return;
      }

      await setApiUrl(found);
      set({ status: "ok", url: found });

      // El socket y lo cacheado apuntan al servidor anterior.
      if (found !== previous) {
        disconnectPickingSocket();
        // El socket necesita el token vigente: sin sesión no hay a qué conectarse.
        void getTokens().then((tokens) => {
          if (tokens?.accessToken) connectPickingSocket(tokens.accessToken);
        });
        queryClient.clear();
        void queryClient.invalidateQueries();
      }
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  },
}));
