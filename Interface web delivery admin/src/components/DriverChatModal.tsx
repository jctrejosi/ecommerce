import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, MessagesSquare, Search, Send, X } from 'lucide-react';
import type { DriverChatMessage, DriverConversation } from '../types';
import { api, ApiError } from '../services/api';
import { driverColor } from '../lib/driverColors';
import { initials, timeAgo } from '../lib/format';

/** Refresco de respaldo: el socket avisa al instante, esto cubre caídas. */
const POLL_MS = 4_000;

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function ChatAvatar({
  driverId,
  routeColor,
  name,
  size = 38,
}: {
  driverId: number;
  routeColor: string | null;
  name: string;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        background: driverColor({ id: driverId, routeColor }),
        fontSize: Math.max(10, size * 0.36),
      }}
    >
      {initials(name)}
    </div>
  );
}

interface Props {
  /** Bandeja (un renglón por repartidor), ya cargada por `App`. */
  chats: DriverConversation[];
  /** Si viene, se abre directo el hilo de ese repartidor. */
  initialDriverId: number | null;
  /** Cambia con cada mensaje recibido por socket (fuerza refresco). */
  liveTick: number;
  onClose: () => void;
  /** Pide a `App` recargar la bandeja (badges de no leídos). */
  onRefreshChats: () => void;
}

/**
 * Chat del panel con los repartidores: bandeja con todos y conversación 1 a 1.
 * Los mensajes quedan guardados en `driver_chat_messages` (un hilo por
 * repartidor), así que el historial se conserva entre sesiones.
 */
export default function DriverChatModal({
  chats,
  initialDriverId,
  liveTick,
  onClose,
  onRefreshChats,
}: Props) {
  const [activeId, setActiveId] = useState<number | null>(initialDriverId);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<DriverChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(
    () => chats.find((c) => c.driverId === activeId) ?? null,
    [chats, activeId],
  );

  /** Bandeja filtrada por nombre, usuario (código) o id del repartidor. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        (c.username ?? '').toLowerCase().includes(q) ||
        String(c.driverId) === q,
    );
  }, [chats, query]);

  const load = useCallback(async () => {
    if (activeId == null) return;
    try {
      setMessages(await api.chatMessages(activeId));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar el chat.');
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  // Al abrir un hilo: cargar y refrescar en intervalo (respaldo del socket).
  useEffect(() => {
    if (activeId == null) {
      setMessages([]);
      return;
    }
    setLoading(true);
    void load().then(onRefreshChats);
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
    // `onRefreshChats` estable en App; se omite para no reiniciar el intervalo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, load]);

  // Un mensaje nuevo (socket) refresca el hilo abierto.
  useEffect(() => {
    if (activeId != null && liveTick > 0) void load();
  }, [liveTick, activeId, load]);

  // Autoscroll al último mensaje.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, activeId]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || activeId == null || sending) return;
    setSending(true);
    try {
      const msg = await api.sendChatMessage(activeId, body);
      setMessages((prev) => [...prev, msg]);
      setText('');
      setError(null);
      onRefreshChats();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  }, [text, activeId, sending, onRefreshChats]);

  const totalUnread = chats.reduce((n, c) => n + c.unread, 0);

  return (
    <div
      className="fixed inset-0 z-1000 flex cursor-pointer items-center justify-center bg-overlay p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] max-h-180 w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Cabecera ── */}
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          {active ? (
            <>
              <button
                onClick={() => setActiveId(null)}
                title="Volver a la lista"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-3 hover:text-ink-soft"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <ChatAvatar
                driverId={active.driverId}
                routeColor={active.routeColor}
                name={active.fullName}
                size={36}
              />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-bold text-ink">
                  {active.fullName}
                </p>
                <p className="truncate text-[11px] text-ink-faint">
                  {active.username ? `@${active.username} · ` : ''}
                  {active.phone}
                  {active.isActive ? '' : ' · cuenta desactivada'}
                </p>
              </div>
            </>
          ) : (
            <>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <MessagesSquare className="h-4 w-4" />
              </span>
              <div className="flex-1 leading-tight">
                <p className="text-sm font-bold text-ink">Chat con repartidores</p>
                <p className="text-[11px] text-ink-faint">
                  {chats.length} repartidor{chats.length === 1 ? '' : 'es'}
                  {totalUnread > 0 ? ` · ${totalUnread} sin leer` : ''}
                </p>
              </div>
            </>
          )}
          <button
            onClick={onClose}
            title="Cerrar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-3 hover:text-ink-soft"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="shrink-0 bg-rose-50 px-4 py-1.5 text-xs font-semibold text-rose-600">
            {error}
          </div>
        )}

        {/* ── Bandeja ── */}
        {!active && (
          <>
            <div className="shrink-0 border-b border-line p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por nombre o código…"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-xl border border-line bg-surface-2 py-2 pl-9 pr-8 text-sm outline-none transition focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent-soft"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    title="Limpiar búsqueda"
                    className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-3 hover:text-ink-soft"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="relative min-h-0 flex-1">
              <div className="h-full overflow-y-auto pb-6">
                {chats.length === 0 && (
                  <p className="p-8 text-center text-xs text-ink-faint">
                    No hay repartidores registrados.
                  </p>
                )}
                {chats.length > 0 && visible.length === 0 && (
                  <p className="p-8 text-center text-xs text-ink-faint">
                    Ningún repartidor coincide con “{query}”.
                  </p>
                )}
                {visible.map((c) => (
                  <button
                    key={c.driverId}
                    onClick={() => setActiveId(c.driverId)}
                    className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-2"
                  >
                    <ChatAvatar
                      driverId={c.driverId}
                      routeColor={c.routeColor}
                      name={c.fullName}
                      size={38}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold text-ink">
                          {c.fullName}
                          {c.username && (
                            <span className="ml-1.5 text-[11px] font-normal text-ink-faint">
                              @{c.username}
                            </span>
                          )}
                        </p>
                        <span className="shrink-0 text-[10px] text-ink-faint">
                          {c.lastMessage ? timeAgo(c.lastMessage.createdAt) : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-ink-faint">
                          {c.lastMessage
                            ? `${c.lastMessage.senderType === 'admin' ? 'Tú: ' : ''}${c.lastMessage.body}`
                            : 'Sin mensajes · inicia la conversación'}
                        </p>
                        {c.unread > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                            {c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {/* Difumina las filas contra el borde mientras la lista scrollea. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-[linear-gradient(to_top,var(--t-surface),transparent)]"
              />
            </div>
          </>
        )}

        {/* ── Conversación ── */}
        {active && (
          <>
            <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-surface-2 p-4">
              {loading && messages.length === 0 && (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
                </div>
              )}
              {!loading && messages.length === 0 && (
                <p className="py-6 text-center text-xs text-ink-faint">
                  Aún no hay mensajes con {active.fullName}.
                </p>
              )}
              {messages.map((m) => {
                const mine = m.senderType === 'admin';
                return (
                  <div
                    key={m.id}
                    className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                        mine
                          ? 'rounded-br-sm bg-invert text-invert-ink'
                          : 'rounded-bl-sm bg-surface text-ink ring-1 ring-line'
                      }`}
                    >
                      <p className="whitespace-pre-wrap wrap-break-word">{m.body}</p>
                      <p
                        className={`mt-1 text-right text-[10px] ${
                          mine ? 'text-invert-ink/50' : 'text-ink-faint'
                        }`}
                      >
                        {timeLabel(m.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex shrink-0 items-end gap-2 border-t border-line p-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder={`Escribe a ${active.fullName}…`}
                className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-line px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
              />
              <button
                onClick={() => void send()}
                disabled={!text.trim() || sending}
                title="Enviar (Enter)"
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Enviar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
