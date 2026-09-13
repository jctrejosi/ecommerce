import { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, radius, spacing } from "@/theme";
import { formatMoney } from "@/lib/format";
import { isItemDone, scannedCount } from "@/picking/status";
import { useClaimOrder, useOrder } from "@/picking/queries";
import { saveSession } from "@/picking/sessionStore";
import { usePickerStore } from "@/picking/pickerStore";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { Button } from "@/ui/Button";
import { ProgressBar } from "@/ui/ProgressBar";
import { ProductRow } from "@/ui/ProductRow";
import { ErrorBox } from "@/ui/ErrorBox";

export default function OrderDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);

  const pickerId = usePickerStore((s) => s.pickerId);
  const { data: order, isLoading, error, refetch } = useOrder(id);
  const claim = useClaimOrder();
  const claimedRef = useRef(false);

  // Guarda la sesión para poder restaurarla si el SO mata la app.
  useEffect(() => {
    if (Number.isFinite(id)) void saveSession({ orderId: id, productId: null });
  }, [id]);

  // Reclama el pedido para el picker activo la primera vez que se abre.
  useEffect(() => {
    if (order && pickerId && !claimedRef.current) {
      claimedRef.current = true;
      claim.mutate({ orderId: order.id, pickerId });
    }
  }, [order, pickerId, claim]);

  if (isLoading && !order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.center}>
        <ErrorBox message="No se pudo cargar el pedido." onRetry={() => void refetch()} />
      </View>
    );
  }

  const items = order.items ?? [];
  const total = items.length;
  const scanned = scannedCount(items);
  const allDone = total > 0 && scanned === total;
  const firstPending = items.find((i) => !isItemDone(i)) ?? items[0];

  const openScanner = (itemId?: number) => {
    const target = itemId ?? firstPending?.id;
    router.push(`/(main)/scanner/${order.id}${target ? `?itemId=${target}` : ""}`);
  };

  const openMap = () => {
    router.push(`/(main)/map/${order.id}${firstPending ? `?itemId=${firstPending.id}` : ""}`);
  };

  return (
    <View style={styles.root}>
      <Header
        title={order.referenceCode}
        subtitle={order.customerName}
        onBack={() => router.back()}
        right={<Text style={styles.total}>{formatMoney(order.grandTotal)}</Text>}
      />

      <Screen>
        {/* Progreso */}
        <View style={styles.progressBox}>
          <View style={styles.progressHead}>
            <Text style={styles.progressLabel}>Progreso del alistamiento</Text>
            <Text style={styles.progressCount}>
              {scanned}/{total} productos
            </Text>
          </View>
          <ProgressBar value={total > 0 ? scanned / total : 0} />
        </View>

        <Text style={styles.sectionTitle}>Ordenado por ubicación</Text>

        {items.map((item) => (
          <ProductRow key={item.id} item={item} onPress={() => openScanner(item.id)} />
        ))}

        <View style={styles.ctas}>
          <Button label="Ver mapa de bodega" variant="secondary" icon="map-outline" onPress={openMap} />
          {allDone ? (
            <Button
              label="Ver checklist final"
              variant="success"
              icon="checkmark-done-outline"
              onPress={() => router.push(`/(main)/checklist/${order.id}`)}
            />
          ) : (
            <Button label="Escanear producto" icon="scan-outline" onPress={() => openScanner()} />
          )}
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: spacing(5) },
  total: { color: colors.text, fontSize: 15, fontWeight: "800" },
  progressBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing(4),
    marginBottom: spacing(5),
  },
  progressHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing(3) },
  progressLabel: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  progressCount: { color: colors.text, fontSize: 13, fontWeight: "800" },
  sectionTitle: {
    color: colors.textHint,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: spacing(3),
  },
  ctas: { gap: spacing(3), marginTop: spacing(4) },
});
