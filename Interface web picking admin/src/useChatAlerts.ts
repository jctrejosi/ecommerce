import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './services/api'
import type { PickerChatConversation, PickerChatMessage } from './types'
import { onPickingEvent } from './services/pickingSocket'
import { isChatThreadOpen, onChatsChanged } from './PickerChat'
import { notifyBrowser } from './services/browserNotifications'

/**
 * Contador de no leídos del chat y aviso de mensajes nuevos.
 *
 * Va montado en el panel (no en una pestaña concreta) para que el administrador
 * se entere del mensaje de cualquier picker esté donde esté. El aviso es:
 *   - el punto con el número en el botón de chat (siempre),
 *   - la notificación del navegador (si el administrador la permitió).
 *
 * No hay popup propio: la notificación del sistema ya avisa.
 *
 * No avisa de los mensajes del propio administrador (los de otra pestaña) ni de
 * los del hilo que esté abierto en ese momento.
 */
export function useChatAlerts(enabled: boolean): { unread: number } {
  const [conversations, setConversations] = useState<PickerChatConversation[]>([])
  const namesRef = useRef(new Map<number, string>())

  const reload = useCallback(async () => {
    if (!enabled) return
    try {
      const list = await api.chatConversations()
      namesRef.current = new Map(list.map((c) => [c.pickerId, c.fullName]))
      setConversations(list)
    } catch {
      /* noop */
    }
  }, [enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  // Respaldo por polling: el socket refresca al instante, esto cubre una caída.
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => void reload(), 20_000)
    return () => clearInterval(t)
  }, [enabled, reload])

  // Cuando el administrador lee un hilo, los no leídos bajan.
  useEffect(() => onChatsChanged(() => void reload()), [reload])

  useEffect(() => {
    if (!enabled) return
    return onPickingEvent<{ pickerId?: number; message?: PickerChatMessage }>(
      'picking:chat',
      (payload) => {
        const pickerId = payload?.pickerId
        const message = payload?.message
        if (!pickerId || !message) return

        // El contador se refresca siempre (también con lo que envía el panel).
        void reload()

        if (message.senderType !== 'picker') return
        // Hilo abierto: el administrador ya lo está leyendo.
        if (isChatThreadOpen(pickerId)) return

        const name = namesRef.current.get(pickerId) ?? 'Un picker'
        notifyBrowser({
          title: `Mensaje de ${name}`,
          body: message.body,
          tag: `picker-chat-${pickerId}`,
        })
      },
    )
  }, [enabled, reload])

  const unread = conversations.reduce((n, c) => n + (c.unread ?? 0), 0)
  return { unread }
}
