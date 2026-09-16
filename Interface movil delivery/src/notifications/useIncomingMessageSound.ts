import { useEffect } from "react";
import { useChatMessages } from "@/api/orders";
import { playIncomingMessageSound } from "./sound";

/**
 * Mensajes viejos (p. ej. al abrir la app después de un rato) no deben sonar:
 * solo se avisa de lo que llega de verdad mientras la app está en uso.
 */
const FRESH_MS = 60_000;

/**
 * Ids de los mensajes ya avisados.
 *
 * Vive en el módulo (y no en un `ref`) a propósito: el aviso no puede perderse
 * porque el componente se vuelva a montar, porque cambie el pedido en curso o
 * porque la consulta se invalide. Así el mismo mensaje nunca suena dos veces,
 * pero tampoco se queda sin sonar por un re-render.
 */
const alreadyNotified = new Set<string>();

/**
 * Suena el tono cuando el cliente escribe en el chat del pedido en curso.
 *
 * Usa la misma consulta que la pantalla de chat (`useChatMessages`, con su
 * sondeo), así que comparte caché y no añade peticiones extra: al montarlo en
 * la raíz de la app el aviso llega aunque el repartidor esté en otra pantalla.
 */
export function useIncomingMessageSound(orderId: number | string | undefined) {
  const messages = useChatMessages(orderId);

  // El último mensaje del cliente se deriva en cada render y el efecto depende
  // de su *id*, no de la identidad del arreglo: así el aviso no se pierde si la
  // caché entrega el mismo arreglo o si algo vuelve a montar el hook.
  const incoming = (messages.data ?? []).filter((m) => m.senderType === "customer");
  const last = incoming[incoming.length - 1];
  const lastId = last ? String(last.id) : null;
  const createdAt = last?.createdAt ?? null;

  useEffect(() => {
    if (!lastId || alreadyNotified.has(lastId)) return;
    alreadyNotified.add(lastId);

    const at = createdAt ? new Date(createdAt).getTime() : Date.now();
    const fresh = Date.now() - at < FRESH_MS;
    console.log(
      `[chat] mensaje del cliente #${lastId}: ${fresh ? "suena" : "antiguo, sin tono"}`,
    );
    if (fresh) playIncomingMessageSound();
  }, [lastId, createdAt]);
}
