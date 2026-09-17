import { useEffect } from "react";
import { Vibration } from "react-native";
import { playIncomingMessageSound } from "./sound";
import { clearAppAlerts, publishNewOrderNotification, setAppBadge } from "./push";

/**
 * Aviso de pedido nuevo: tono, vibración, notificación del sistema (que es lo
 * que hace aparecer el punto rojo en el icono de la app) y contador.
 *
 * El tono y la vibración los dispara la app, no el canal de Android: así suenan
 * también con el teléfono en silencio y no se duplican con el sonido del canal.
 */

/** Dos pulsos seguidos: se nota más que una vibración suelta. */
const VIBRATION_PATTERN = [0, 400, 200, 400];

/**
 * Ids ya avisados. Vive en el módulo para que el aviso no se repita ni se
 * pierda: el pedido nuevo se detecta por dos vías (el socket y el sondeo de la
 * lista) y ambas llaman aquí.
 */
const alerted = new Set<string>();

/** Avisos pendientes de "ver", para el contador del icono. */
let pending = 0;

/** Avisa de un pedido recién asignado. Idempotente por id de pedido. */
export async function alertNewOrder(order: {
  id: number | string;
  referenceCode: string;
}): Promise<void> {
  const key = String(order.id);
  if (alerted.has(key)) return;
  alerted.add(key);

  console.log(`[pedido-nuevo] ${order.referenceCode}: suena y vibra`);
  playIncomingMessageSound();
  try {
    Vibration.vibrate(VIBRATION_PATTERN);
  } catch {
    /* el dispositivo puede no tener vibrador */
  }

  pending += 1;
  await publishNewOrderNotification(order);
  await setAppBadge(pending);
}

/** Al volver la app a primer plano se entiende que el aviso ya se vio. */
export async function acknowledgeNewOrderAlerts(): Promise<void> {
  if (pending === 0) return;
  pending = 0;
  await clearAppAlerts();
}

interface AlertableOrder {
  id: number | string;
  referenceCode: string;
  status: string;
}

/** Ids ya listados; el primer listado solo siembra (no avisa de lo que ya estaba). */
const seen = new Set<string>();
let primed = false;

/**
 * Red de seguridad del sondeo: si el socket está caído (cambio de red, app
 * recién abierta), el pedido nuevo se detecta igual al refrescar la lista
 * (cada 5 s). El aviso duplicado lo evita `alertNewOrder`.
 */
export function useNewOrderAlert(orders: AlertableOrder[] | undefined) {
  useEffect(() => {
    if (!orders) return;

    // Lo que ya estaba asignado al abrir la app no debe sonar.
    if (!primed) {
      for (const o of orders) seen.add(String(o.id));
      primed = true;
      return;
    }

    for (const o of orders) {
      const key = String(o.id);
      if (seen.has(key)) continue;
      seen.add(key);
      if (o.status === "ASSIGNED") void alertNewOrder(o);
    }
  }, [orders]);
}

/** Solo para pruebas/depuración: deja el módulo como recién arrancado. */
export function resetNewOrderAlertsForTests(): void {
  alerted.clear();
  seen.clear();
  primed = false;
  pending = 0;
}
