import { useEffect, useRef } from "react";
import { usePickerChatSummary } from "@/api/picker-chat";
import { useUnreviewedCount } from "@/picking/queries";
import { setPendingBadge } from "./push";

/**
 * Contador rojo del ícono de la app: las notificaciones sin leer del picker,
 * que son las dos cosas que puede tener pendientes:
 *   - mensajes de administración sin leer (badge del chat),
 *   - pedidos que siguen sin revisar en su cola.
 *
 * Se mantiene al día en cualquier pantalla (va montado en el layout de `(main)`)
 * y, como sale de datos reales y no de un contador acumulado, baja solo cuando
 * el picker lee el chat o marca los pedidos como revisados.
 */
export function useAppBadge(): void {
  const { data: chat } = usePickerChatSummary();
  const { data: unreviewed } = useUnreviewedCount();

  // Mientras alguna fuente no haya cargado no se toca el contador: un 0
  // prematuro borraría el aviso antes de saber cuántos pendientes hay.
  const ready = chat !== undefined && unreviewed !== undefined;
  const total = (chat?.unread ?? 0) + (unreviewed?.count ?? 0);

  const applied = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || applied.current === total) return;
    applied.current = total;
    console.log(`[badge] pendientes sin leer: ${total}`);
    void setPendingBadge(total);
  }, [ready, total]);
}
