import { useEffect } from "react";
import { Platform, Vibration } from "react-native";
import { create } from "zustand";
import type { PickingOrder } from "@/api";
import { useQueue } from "@/picking/queries";
import { playNewOrderSound } from "./sound";

export interface NewOrderAlert {
  order: PickingOrder;
  /** Cuándo llegó: la lista solo muestra su toast si el aviso es reciente. */
  at: number;
}

interface NewOrderAlertState {
  alert: NewOrderAlert | null;
  notify: (order: PickingOrder) => void;
}

/** Último pedido nuevo; la lista de pedidos lo lee para mostrar su toast. */
export const useNewOrderAlertStore = create<NewOrderAlertState>((set) => ({
  alert: null,
  notify: (order) => set({ alert: { order, at: Date.now() } }),
}));

/**
 * Ids ya vistos. Vive a nivel de módulo (no en el estado del componente) para
 * que cambiar de pantalla no reenganche como "nuevo" lo que ya se avisó.
 */
const knownIds = new Set<number>();
let primed = false;

/** Vibración de aviso: doble pulso corto en Android; un pulso simple en iOS. */
function vibrate(): void {
  if (Platform.OS === "ios") Vibration.vibrate(300);
  else Vibration.vibrate([0, 160, 110, 160]);
}

/**
 * Avisa con sonido y vibración cuando entra un pedido nuevo, esté el picker en
 * la pantalla que esté (el hook va montado en el layout de `(main)`).
 *
 * La cola se refresca al instante por socket, así que el pedido recién creado
 * ya aparece en `orders` y aquí se detecta por su id. El primer lote (lo que
 * estaba en la cola al abrir la app) no avisa: no hay nada nuevo que anunciar.
 */
export function useNewOrderAlerts(): void {
  const { data: orders } = useQueue();

  useEffect(() => {
    if (!orders) return;

    const fresh = orders.filter((o) => !o.reviewed && !knownIds.has(o.id));
    for (const o of orders) knownIds.add(o.id);

    if (!primed) {
      primed = true;
      return;
    }
    if (fresh.length === 0) return;

    // Si entran varios a la vez se anuncia el último (el tono tiene anti-ráfaga
    // para no pisarse); en pantalla igual se ven todos.
    const order = fresh[fresh.length - 1];
    console.log(`[aviso] pedido nuevo ${order.referenceCode}: suena y vibra`);
    playNewOrderSound();
    vibrate();
    useNewOrderAlertStore.getState().notify(order);
  }, [orders]);
}
