import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/theme";
import { QUEUE_FILTERS, pickingApi, type QueueFilter } from "@/api";
import { useMarkReviewed, useQueue } from "@/picking/queries";
import { isItemDone, orderStatus, sortQueue } from "@/picking/status";
import { clearSession, loadSession } from "@/picking/sessionStore";
import { useAuthStore } from "@/auth/authStore";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { OrderCard } from "@/ui/OrderCard";
import { EmptyState } from "@/ui/EmptyState";
import { ErrorBox } from "@/ui/ErrorBox";
import { LoginModal } from "@/ui/LoginModal";
import { Toast } from "@/ui/Toast";

// Restaurar la sesión solo una vez por arranque del proceso (no al volver a la lista).
let restoredOnce = false;

export default function OrderListScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<QueueFilter>("nuevo");
  const [showLogin, setShowLogin] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  const { data: orders, isLoading, error, refetch, isRefetching } = useQueue();
  const markReviewed = useMarkReviewed();

  const knownIds = useRef<Set<number>>(new Set());
  const firstLoad = useRef(true);

  const filtered = useMemo(
    () => sortQueue((orders ?? []).filter((o) => orderStatus(o) === filter)),
    [orders, filter],
  );

  // Aviso de pedido nuevo (no revisado y con id desconocido).
  useEffect(() => {
    if (!orders) return;
    const fresh = orders.filter((o) => !o.reviewed && !knownIds.current.has(o.id));
    orders.forEach((o) => knownIds.current.add(o.id));
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    if (fresh.length > 0) setToast(`Nuevo pedido ${fresh[0].referenceCode} · Recibido ahora`);
  }, [orders]);

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

  // Pedir login si aún no hay sesión.
  useEffect(() => {
    if (hydrated && !user) setShowLogin(true);
  }, [hydrated, user]);

  return (
    <View style={styles.root}>
      <Toast message={toast} onHide={() => setToast(null)} />
      <Header
        logo
        title="DSI Picking"
        subtitle="Alistamiento · Bodega"
        right={
          <Pressable
            onPress={() => setShowLogin(true)}
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
        }
      />

      <Screen scroll>
        {/* Filtros (control segmentado, cabe en pantallas pequeñas) */}
        <View style={styles.tabs}>
          {QUEUE_FILTERS.map((t) => {
            const active = filter === t.key;
            const count = (orders ?? []).filter((o) => orderStatus(o) === t.key).length;
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
            title={filter === "completado" ? "Sin pedidos completados" : "No hay pedidos pendientes"}
            message="Cuando lleguen pedidos aparecerán aquí"
            icon="file-tray-outline"
          />
        ) : (
          <>
            {isRefetching ? (
              <Text style={styles.refreshing}>Actualizando…</Text>
            ) : null}
            {filtered.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onPress={() => router.push(`/(main)/order/${order.id}`)}
                onMarkReviewed={() => markReviewed.mutate(order.id)}
                marking={markReviewed.isPending && markReviewed.variables === order.id}
              />
            ))}
          </>
        )}
      </Screen>

      <LoginModal
        visible={showLogin}
        onClose={user ? () => setShowLogin(false) : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
    maxWidth: 180,
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
});
