import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from './services/api'
import type { PickerChatConversation, PickerChatMessage } from './types'
import { onPickingEvent } from './services/pickingSocket'

const fmtTime = (s: string | null) => {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Hilos abiertos en pantalla (el modal de la pestaña Pickers o el del header).
 * El aviso de mensaje nuevo lo consulta para no avisar de algo que el
 * administrador está leyendo en ese momento.
 */
const openThreads = new Set<number>()

export function isChatThreadOpen(pickerId: number): boolean {
  return openThreads.has(pickerId)
}

/**
 * Avisa cuando cambian los no leídos (un hilo quedó leído o se envió algo).
 *
 * El badge del header y las tarjetas de la pestaña Pickers se refrescan con
 * esto, sin tener que pasar callbacks de arriba abajo.
 */
const chatsChangedHandlers = new Set<() => void>()

export function onChatsChanged(handler: () => void): () => void {
  chatsChangedHandlers.add(handler)
  return () => {
    chatsChangedHandlers.delete(handler)
  }
}

function emitChatsChanged(): void {
  chatsChangedHandlers.forEach((h) => h())
}

// ─── Hilo de un picker ────────────────────────────────────────────────────────

interface ChatThreadProps {
  pickerId: number
  name: string
  /** Vuelve a la lista de conversaciones (bandeja del header). */
  onBackToList?: () => void
  /** Cierra el chat. */
  onClose: () => void
  /** Se llama cuando el hilo quedó leído, para refrescar contadores. */
  onRead?: () => void
}

/**
 * Conversación con un picker: mensajes y caja de escritura.
 *
 * Es el mismo componente para el modal de la pestaña Pickers y para la bandeja
 * del header, así el comportamiento (marcar leído, mensajes en vivo, envío) es
 * idéntico en los dos sitios.
 */
export function ChatThread({
  pickerId,
  name,
  onBackToList,
  onClose,
  onRead,
}: ChatThreadProps) {
  const [messages, setMessages] = useState<PickerChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  // `onRead` puede venir como flecha nueva en cada render: se guarda en un ref
  // para que no dispare recargas en bucle.
  const onReadRef = useRef(onRead)
  useEffect(() => {
    onReadRef.current = onRead
  })

  const load = useCallback(async () => {
    try {
      // El GET marca como leído lo que envió el picker.
      setMessages(await api.chatMessages(pickerId))
      setError(null)
      onReadRef.current?.()
      // Los no leídos bajaron: que el badge del header se entere.
      emitChatsChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar la conversación')
    } finally {
      setLoading(false)
    }
  }, [pickerId])

  useEffect(() => {
    setLoading(true)
    setMessages([])
    void load()
  }, [load])

  // Mientras el hilo está abierto no se avisa de sus mensajes nuevos.
  useEffect(() => {
    openThreads.add(pickerId)
    return () => {
      openThreads.delete(pickerId)
    }
  }, [pickerId])

  // Mensajes en vivo: los del picker se releen (el GET los marca leídos); los
  // que escriba otra pestaña del panel se añaden tal cual.
  useEffect(
    () =>
      onPickingEvent<{ pickerId?: number; message?: PickerChatMessage }>(
        'picking:chat',
        (payload) => {
          if (payload?.pickerId !== pickerId || !payload.message) return
          const message = payload.message
          if (message.senderType === 'picker') {
            void load()
          } else {
            setMessages((prev) =>
              prev.some((m) => m.id === message.id) ? prev : [...prev, message],
            )
          }
        },
      ),
    [pickerId, load],
  )

  // Mantiene el hilo pegado al final cuando llegan mensajes.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, loading])

  async function send(e: FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const msg = await api.sendChatMessage(pickerId, body)
      setDraft('')
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo enviar el mensaje')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-white/8 flex items-center gap-3 shrink-0">
        {onBackToList ? (
          <button
            onClick={onBackToList}
            aria-label="Volver a la lista"
            className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
        <span className="w-9 h-9 rounded-full bg-amber-400 text-[#0C0C0D] flex items-center justify-center font-extrabold shrink-0">
          {name[0]?.toUpperCase() ?? '?'}
        </span>
        <div className="min-w-0">
          <h2 className="font-extrabold truncate">{name}</h2>
          <p className="text-white/40 text-xs font-medium">Conversación del picker</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Cerrar chat"
          className="ml-auto w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <p className="text-white/40 text-sm text-center py-10">Cargando…</p>
        ) : messages.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-10">
            Aún no hay mensajes con {name}.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.senderType === 'admin' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                  m.senderType === 'admin'
                    ? 'bg-amber-400 text-[#0C0C0D]'
                    : 'bg-white/5 border border-white/10'
                }`}
              >
                <p className="text-sm font-medium whitespace-pre-wrap break-words">{m.body}</p>
                <p
                  className={`text-[10px] font-bold mt-1 ${
                    m.senderType === 'admin' ? 'text-[#0C0C0D]/60' : 'text-white/35'
                  }`}
                >
                  {fmtTime(m.createdAt)}
                  {m.senderType === 'admin' && m.readAt ? ' · leído' : ''}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {error ? (
        <p className="px-4 pb-2 text-red-400 text-xs font-semibold">{error}</p>
      ) : null}

      <form
        onSubmit={send}
        className="p-3 border-t border-white/8 flex items-center gap-2 shrink-0"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe un mensaje…"
          className="flex-1 min-w-0 bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-amber-400/50"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="px-4 py-2.5 rounded-xl bg-amber-400 text-[#0C0C0D] text-sm font-extrabold disabled:opacity-40 shrink-0"
        >
          {sending ? 'Enviando…' : 'Enviar'}
        </button>
      </form>
    </>
  )
}

// ─── Bandeja: una conversación por picker ─────────────────────────────────────

interface PickerChatDrawerProps {
  open: boolean
  onClose: () => void
}

/**
 * Bandeja de chat del header: lista los pickers con su último mensaje y sus no
 * leídos, y al elegir uno abre el hilo. El chat es uno por picker, así que
 * siempre se entra por esta lista.
 */
export function PickerChatDrawer({ open, onClose }: PickerChatDrawerProps) {
  const [chats, setChats] = useState<PickerChatConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null)
  // Filtro de la bandeja: por nombre, usuario (código) o email.
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      setChats(await api.chatConversations())
    } catch {
      /* noop: no tumbar la bandeja por un fallo del endpoint */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    void load()
    // Respaldo por polling; el evento `picking:chat` refresca al instante.
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [open, load])

  useEffect(() => {
    if (!open) return
    return onPickingEvent('picking:chat', () => void load())
  }, [open, load])

  // Al cerrar se vuelve siempre a la lista y se limpia el filtro.
  useEffect(() => {
    if (!open) {
      setSelected(null)
      setQuery('')
    }
  }, [open])

  if (!open) return null

  const totalUnread = chats.reduce((n, c) => n + (c.unread ?? 0), 0)

  const q = query.trim().toLowerCase()
  const filtered = q
    ? chats.filter(
        (c) =>
          c.fullName.toLowerCase().includes(q) ||
          c.username.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          String(c.pickerId).includes(q),
      )
    : chats

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-[#161618] border border-white/10 rounded-t-3xl sm:rounded-2xl max-h-[88dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {selected ? (
          <ChatThread
            pickerId={selected.id}
            name={selected.name}
            onBackToList={() => setSelected(null)}
            onClose={onClose}
            onRead={load}
          />
        ) : (
          <>
            <div className="px-5 pt-4 pb-3 border-b border-white/8 flex items-center gap-3 shrink-0">
              <div className="min-w-0">
                <h2 className="font-extrabold">Mensajes de pickers</h2>
                <p className="text-white/40 text-xs font-medium">
                  {totalUnread > 0
                    ? `${totalUnread} sin leer`
                    : 'Todo leído · un hilo por picker'}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="ml-auto w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="px-4 sm:px-5 pb-3 shrink-0">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar picker por nombre o código…"
                autoComplete="off"
                className="w-full bg-[#0C0C0D] border border-white/10 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:border-amber-400/50"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {loading ? (
                <p className="text-white/40 text-sm text-center py-10">Cargando…</p>
              ) : chats.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-10">
                  Aún no hay pickers con conversación.
                </p>
              ) : filtered.length === 0 ? (
                <p className="text-white/30 text-sm text-center py-10">
                  Sin coincidencias para “{query.trim()}”.
                </p>
              ) : (
                filtered.map((c) => {
                  const unread = c.unread ?? 0
                  return (
                    <button
                      key={c.pickerId}
                      onClick={() => setSelected({ id: c.pickerId, name: c.fullName })}
                      className="w-full text-left flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5 transition-colors"
                    >
                      <span className="w-10 h-10 rounded-full bg-white/5 border border-white/10 text-white/80 flex items-center justify-center font-extrabold shrink-0">
                        {c.fullName[0]?.toUpperCase() ?? '?'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-bold text-sm truncate">{c.fullName}</span>
                          <span className="text-white/35 text-[11px] font-semibold shrink-0">@{c.username}</span>
                          {unread > 0 ? (
                            <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-extrabold flex items-center justify-center">
                              {unread > 9 ? '9+' : unread}
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-white/40 text-xs font-medium truncate">
                          {c.lastMessage
                            ? `${c.lastMessage.senderType === 'admin' ? 'Tú: ' : ''}${c.lastMessage.body}`
                            : 'Sin mensajes'}
                        </span>
                      </span>
                      <span className="text-white/30 text-[10px] font-bold shrink-0 self-start mt-1">
                        {fmtTime(c.lastMessage?.createdAt ?? null)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
