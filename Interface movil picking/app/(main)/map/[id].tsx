import { useMemo } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, radius, spacing } from "@/theme";
import { isItemDone, scannedCount } from "@/picking/status";
import { useLocations, useOrder, useShelves } from "@/picking/queries";
import { Header } from "@/ui/Header";
import { Button } from "@/ui/Button";
import { ErrorBox } from "@/ui/ErrorBox";
import { PickingMap, type MapSpot } from "@/ui/PickingMap";

export default function MapScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; itemId?: string }>();
  const orderId = Number(params.id);
  const { width: windowWidth } = useWindowDimensions();

  const { data: order, isLoading, error, refetch } = useOrder(orderId);
  const branchId = order?.branchId;
  const items = useMemo(() => order?.items ?? [], [order]);
  const variantIds = useMemo(
    () => items.map((i) => i.productVariantId).filter((v): v is number => v != null),
    [items],
  );

  const shelvesQuery = useShelves(branchId);
  const locationsQuery = useLocations(branchId, variantIds);

  const activeItem =
    items.find((i) => i.id === Number(params.itemId)) ??
    items.find((i) => !isItemDone(i)) ??
    items[0];

  const locByVariant = useMemo(() => {
    const map = new Map<number, { shelfId: number; rowNumber: number }>();
    (locationsQuery.data ?? []).forEach((l) =>
      map.set(l.productVariantId, { shelfId: l.shelfId, rowNumber: l.rowNumber }),
    );
    return map;
  }, [locationsQuery.data]);

  const activeSpot: MapSpot | undefined =
    activeItem?.productVariantId != null ? locByVariant.get(activeItem.productVariantId) : undefined;

  const otherSpots: MapSpot[] = items
    .filter((i) => i.id !== activeItem?.id && i.productVariantId != null)
    .map((i) => locByVariant.get(i.productVariantId!))
    .filter((s): s is MapSpot => !!s);

  const total = items.length;
  const scanned = scannedCount(items);
  const allDone = total > 0 && scanned === total;
  const loading = isLoading || shelvesQuery.isLoading || locationsQuery.isLoading;
  const mapError = error || shelvesQuery.error || locationsQuery.error;

  if (loading && shelvesQuery.data == null) {
    return (
      <View style={styles.root}>
        <Header title="Mapa de bodega" subtitle={order?.referenceCode} onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header title="Mapa de bodega" subtitle={order?.referenceCode} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content}>
        {mapError ? (
          <ErrorBox
            message="No se pudo cargar el mapa de bodega."
            onRetry={() => {
              void shelvesQuery.refetch();
              void locationsQuery.refetch();
            }}
          />
        ) : allDone ? (
          <View style={styles.stateBox}>
            <Text style={styles.stateTitle}>Pedido completado</Text>
            <Text style={styles.stateText}>Todos los productos fueron escaneados.</Text>
            <Button label="Volver al pedido" variant="secondary" onPress={() => router.back()} />
          </View>
        ) : !activeSpot ? (
          <View style={styles.stateBox}>
            <Text style={styles.stateWarn}>Sin ubicación asignada</Text>
            {activeItem ? (
              <Text style={styles.stateText} numberOfLines={3}>
                {activeItem.name}
              </Text>
            ) : null}
            <Button
              label="Ir al escáner"
              onPress={() =>
                router.push(`/(main)/scanner/${orderId}${activeItem ? `?itemId=${activeItem.id}` : ""}`)
              }
            />
          </View>
        ) : (
          <>
            <Text style={styles.hint}>
              La franja verde indica la fila donde está el producto; en rojo las demás
              ubicaciones del pedido.
            </Text>
            <PickingMap
              shelves={shelvesQuery.data ?? []}
              active={activeSpot}
              others={otherSpots}
              width={windowWidth - spacing(8)}
            />
          </>
        )}
      </ScrollView>

      {!allDone && activeSpot && activeItem ? (
        <View style={styles.footer}>
          <View style={styles.footerInfo}>
            <Text style={styles.footerLabel}>Producto a buscar</Text>
            <Text style={styles.footerName} numberOfLines={1}>
              {activeItem.name}
            </Text>
          </View>
          <Button
            label="Escanear producto"
            icon="scan-outline"
            fullWidth={false}
            compact
            onPress={() => router.push(`/(main)/scanner/${orderId}?itemId=${activeItem.id}`)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing(4), gap: spacing(3) },
  hint: { color: colors.textFaint, fontSize: 12, fontWeight: "500" },
  stateBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing(5),
    gap: spacing(3),
    alignItems: "center",
  },
  stateTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  stateWarn: { color: colors.accent, fontSize: 16, fontWeight: "800" },
  stateText: { color: colors.textMuted, fontSize: 13, fontWeight: "500", textAlign: "center" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(3),
    padding: spacing(4),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  footerInfo: { flex: 1, minWidth: 0 },
  footerLabel: { color: colors.textHint, fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  footerName: { color: colors.text, fontSize: 14, fontWeight: "700" },
});
