import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, radius, spacing, useTheme } from "@/theme";
import { QUEUE_FILTERS, pickingApi, type QueueFilter } from "@/api";
import { useMarkReviewed, useQueue } from "@/picking/queries";
import { usePickerChatSummary } from "@/api/picker-chat";
import { useNewOrderAlertStore } from "@/notifications/newOrderAlerts";
import { isItemDone, orderStatus, sortQueue } from "@/picking/status";
import { clearSession, loadSession } from "@/picking/sessionStore";
import { useAuthStore } from "@/auth/authStore";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { OrderCard } from "@/ui/OrderCard";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorBox } from "@/ui/ErrorBox";
import { SettingsModal } from "@/ui/SettingsModal";
import { Toast } from "@/ui/Toast";

// Restaurar la sesión solo una vez por arranque del proceso (no al volver a la lista).
let restoredOnce = false;

/** Ventana en la que un aviso de pedido nuevo alcanza a mostrarse como toast. */
const ALERT_TOAST_MS = 30_000;

/** Pedidos que se renderizan por página (lazy load al llegar al final). */
const PAGE_SIZE = 10;

export default function OrderListScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const [filter, setFilter] = useState<QueueFilter>("nuevo");
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Cantidad de pedidos visibles de la pestaña actual (lazy load).
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const { data: orders, isLoading, error, refetch, isRefetching } = useQueue();
  const markReviewed = useMarkReviewed();
  // Badge del chat: no leídos que dejó administración (se refresca cada 15 s).
  const { data: chatSummary } = usePickerChatSummary();
  const unread = chatSummary?.unread ?? 0;

  const filtered = useMemo(
    () =>
      sortQueue(
        (orders ?? []).filter((o) => {
          if (orderStatus(o) !== filter) return false;
          // Con el sistema de colas cada pedido se asigna a un solo picker: las
          // tres pestañas muestran únicamente los pedidos del picker activo.
          return o.pickerId === user?.id;
        }),
      ),
    [orders, filter, user?.id],
  );

  // Al cambiar de pestaña se vuelve a empezar por la primera página.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filter]);

  const visible = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );
  const hasMore = visibleCount < filtered.length;

  // Aviso de pedido nuevo: lo detecta el hook global de la app (allí suenan el
  // tono y la vibración, esté donde esté el picker) y aquí solo se muestra el
  // toast, y únicamente si el aviso acaba de llegar.
  const newOrderAlert = useNewOrderAlertStore((s) => s.alert);
  useEffect(() => {
    if (!newOrderAlert) return;
    if (Date.now() - newOrderAlert.at > ALERT_TOAST_MS) return;
    setToast(`Nuevo pedido ${newOrderAlert.order.referenceCode} · Recibido ahora`);
  }, [newOrderAlert]);

  // Restaurar la sesión de trabajo (pedido + producto) si la app se reinició.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!restoredOnce) {
        restoredOnce = true;
        const s = await loadSession();
        if (s?.orderId) {
          try {
            const detail = await pickingApi.detail(s.orderId);
            const items = detail.items ?? [];
            const target = s.productId
              ? items.find((i) => String(i.id) === s.productId)
              : undefined;
            const pending = items.find((i) => !isItemDone(i));
            const next = target ?? pending;
            if (!cancelled) {
              if (next) router.push(`/(main)/scanner/${s.orderId}?itemId=${next.id}`);
              else router.push(`/(main)/order/${s.orderId}`);
              return;
            }
          } catch {
            /* sesión inválida: se queda en la lista */
          }
        }
      }
      if (!cancelled) await clearSession();
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Al abrir la app, si no hay sesión vigente el layout de (main) redirige a
  // /login. Si la sesión se vence en pleno uso (401/turno/inactividad), el
  // mismo guard expulsa al login.

  return (
    <View style={styles.root}>
      <Toast message={toast} onHide={() => setToast(null)} />
      <Header
        logo
        title="Picking | DSI"
        right={
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => router.push("/(main)/chat")}
              hitSlop={6}
              accessibilityLabel="Chat con administración"
              style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.text} />
              {unread > 0 ? (
                <View style={styles.chatBadge}>
                  <Text style={styles.chatBadgeText} allowFontScaling={false}>
                    {unread > 9 ? "9+" : unread}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => setShowSettings(true)}
              style={({ pressed }) => [styles.pickerBtn, pressed && { opacity: 0.8 }]}
            >
              <View style={styles.pickerAvatar}>
                <Text style={styles.pickerAvatarText}>
                  {(user?.name ?? "?").charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.pickerName} numberOfLines={1}>
                {user?.name ?? "Iniciar sesión"}
              </Text>
            </Pressable>
            {user ? (
              <Pressable
                onPress={() => void logout()}
                hitSlop={6}
                style={({ pressed }) => [styles.logOutBtn, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="log-out-outline" size={18} color={colors.dangerText} />
              </Pressable>
            ) : null}
          </View>
        }
      />

      <Screen
        scroll
        onEndReached={() => {
          if (hasMore) setVisibleCount((c) => c + PAGE_SIZE);
        }}
      >
        {/* Filtros (control segmentado, cabe en pantallas pequeñas) */}
        <View style={styles.tabs}>
          {QUEUE_FILTERS.map((t) => {
            const active = filter === t.key;
            const count = (orders ?? []).filter(
              (o) => orderStatus(o) === t.key && o.pickerId === user?.id,
            ).length;
            return (
              <Pressable
                key={t.key}
                onPress={() => setFilter(t.key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text
                  style={[styles.tabText, active && styles.tabTextActive]}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  {t.label}
                </Text>
                <View style={[styles.countBadge, active && styles.countBadgeActive]}>
                  <Text
                    style={[styles.countText, active && styles.countTextActive]}
                    allowFontScaling={false}
                  >
                    {count}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <View style={styles.mb}>
            <ErrorBox message="No se pudo cargar la cola de pedidos." onRetry={() => void refetch()} />
          </View>
        ) : null}

        {isLoading && !orders ? (
          <ActivityIndicator color={colors.accent} style={styles.loader} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={filter === "completado" ? "Aún no has completado pedidos" : "No hay pedidos pendientes"}
            message="Cuando lleguen pedidos aparecerán aquí"
            icon="file-tray-outline"
          />
        ) : (
          <>
            {isRefetching ? (
              <Text style={styles.refreshing}>Actualizando…</Text>
            ) : null}
            {visible.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onPress={() => router.push(`/(main)/order/${order.id}`)}
                onMarkReviewed={() => markReviewed.mutate(order.id)}
                marking={markReviewed.isPending && markReviewed.variables === order.id}
              />
            ))}
            {hasMore ? (
              <Text style={styles.moreHint}>
                Mostrando {visible.length} de {filtered.length} · desliza para ver más
              </Text>
            ) : null}
          </>
        )}
      </Screen>

      <SettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        onSwitchUser={() => {
          setShowSettings(false);
          void logout();
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2),
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingLeft: spacing(1),
    paddingRight: spacing(3),
    paddingVertical: 4,
    maxWidth: 150,
    // El header lleva 3 acciones: cede ancho antes que desbordar en pantallas
    // pequeñas (el nombre del picker se recorta).
    flexShrink: 1,
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing(2), flexShrink: 1 },
  chatBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  chatBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  logOutBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerAvatar: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerAvatarText: { color: colors.onAccent, fontSize: 12, fontWeight: "800" },
  pickerName: { color: colors.textMuted, fontSize: 12, fontWeight: "700", flexShrink: 1 },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing(4),
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: spacing(2.5),
    borderRadius: radius.sm,
  },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.textFaint, fontSize: 11, fontWeight: "700" },
  tabTextActive: { color: colors.onAccent },
  countBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  countBadgeActive: { backgroundColor: "rgba(12,12,13,0.22)" },
  countText: { color: colors.textFaint, fontSize: 10, fontWeight: "800" },
  countTextActive: { color: "#FFFFFF" },
  mb: { marginBottom: spacing(4) },
  loader: { paddingVertical: spacing(12) },
  refreshing: { color: colors.textHint, fontSize: 11, fontWeight: "600", marginBottom: spacing(2) },
  moreHint: {
    color: colors.textHint,
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: spacing(3),
  },
}));
