import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/theme";
import { formatMoney, parseDate } from "@/lib/format";
import { useHistory } from "@/picking/queries";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { ErrorBox } from "@/ui/ErrorBox";
import type { PickingHistoryOrder } from "@/api";

/** "28 sept, 3:53 p. m." para la fecha de cierre del pedido. */
function fmtDateTime(iso: string | null): string {
  const d = parseDate(iso);
  if (!d) return "";
  return d.toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Tiempo de alistamiento entre el reclamo y el cierre ("12 min" / "1h 05m"). */
function fmtDuration(from: string | null, to: string | null): string | null {
  const a = parseDate(from)?.getTime();
  const b = parseDate(to)?.getTime();
  if (a == null || b == null || b < a) return null;
  const mins = Math.round((b - a) / 60_000);
  if (mins < 1) return "menos de 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

function HistoryRow({ order }: { order: PickingHistoryOrder }) {
  const duration = fmtDuration(order.pickedAt, order.completedAt);
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.code}>{order.referenceCode}</Text>
        <Text style={styles.date}>{fmtDateTime(order.completedAt)}</Text>
      </View>
      <Text style={styles.customer} numberOfLines={1}>
        {order.customerName}
      </Text>
      <View style={styles.rowBetween}>
        <Text style={styles.meta}>
          {order.itemsCount} producto(s) · {order.totalPieces} pieza(s)
          {duration ? ` · ${duration}` : ""}
        </Text>
        <Text style={styles.total}>{formatMoney(order.grandTotal)}</Text>
      </View>
    </View>
  );
}

/**
 * Historial del picker: todos los pedidos que alistó (cerrados en caja), del más
 * reciente al más antiguo, con lazy load de a 10 al llegar al final.
 */
export default function HistoryScreen() {
  const router = useRouter();
  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useHistory();

  const orders = useMemo(() => (data?.pages ?? []).flatMap((p) => p.orders), [data]);
  const total = data?.pages[0]?.total ?? 0;

  return (
    <View style={styles.root}>
      <Header
        title="Historial de pedidos"
        subtitle={total > 0 ? `${total} pedido(s) alistados` : undefined}
        onBack={() => router.back()}
      />

      <Screen
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
      >
        {error ? (
          <View style={styles.mb}>
            <ErrorBox message="No se pudo cargar el historial." onRetry={() => void refetch()} />
          </View>
        ) : null}

        {isLoading && orders.length === 0 ? (
          <ActivityIndicator color={colors.accent} style={styles.loader} />
        ) : orders.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="file-tray-outline" size={34} color={colors.textHint} />
            <Text style={styles.emptyTitle}>Aún no tienes pedidos alistados</Text>
            <Text style={styles.emptyText}>
              Cuando cierres un pedido en caja aparecerá aquí.
            </Text>
          </View>
        ) : (
          <>
            {orders.map((o) => (
              <HistoryRow key={o.id} order={o} />
            ))}
            {isFetchingNextPage ? (
              <ActivityIndicator color={colors.accent} style={styles.footer} />
            ) : hasNextPage ? (
              <Text style={styles.more}>Desliza para ver más…</Text>
            ) : (
              <Text style={styles.more}>Fin del historial · {orders.length} pedido(s)</Text>
            )}
          </>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  mb: { marginBottom: spacing(4) },
  loader: { paddingVertical: spacing(12) },
  footer: { paddingVertical: spacing(4) },
  more: {
    color: colors.textHint,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: spacing(4),
  },
  empty: { alignItems: "center", gap: spacing(2), paddingVertical: spacing(12) },
  emptyTitle: { color: colors.textMuted, fontSize: 15, fontWeight: "700" },
  emptyText: { color: colors.textHint, fontSize: 13, fontWeight: "500", textAlign: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(4),
    marginBottom: spacing(3),
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing(2),
  },
  code: { color: colors.text, fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
  date: { color: colors.textFaint, fontSize: 12, fontWeight: "600" },
  customer: { color: colors.textMuted, fontSize: 14, fontWeight: "500", marginTop: spacing(2) },
  meta: { color: colors.textHint, fontSize: 12, fontWeight: "500", flexShrink: 1 },
  total: { color: colors.text, fontSize: 14, fontWeight: "700" },
});
