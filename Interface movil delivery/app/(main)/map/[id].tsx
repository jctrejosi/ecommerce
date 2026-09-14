import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrder, useOrderRoute } from "@/api/orders";
import { DeliveryMap } from "@/maps/DeliveryMap";
import { openExternalNavigation } from "@/maps/navigation";
import { getCurrentPosition, startDeliveryTracking, stopDeliveryTracking } from "@/tracking/location";
import { api } from "@/api";
import { Button } from "@/ui/Button";
import { ErrorBox } from "@/ui/ErrorBox";
import { colors, radius, spacing } from "@/theme";
import type { LatLng, DeliveryStatus } from "@/api/types";

function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 60) return `≈ ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `≈ ${h} h ${m} min` : `≈ ${h} h`;
}

/** Fase del trayecto según el estado del pedido. */
function phaseOf(status: DeliveryStatus): "to-store" | "at-store" | "to-customer" {
  if (status === "ASSIGNED" || status === "ACCEPTED") return "to-store";
  if (status === "READY_FOR_PICKUP") return "at-store";
  return "to-customer"; // PICKED_UP / IN_DELIVERY (el resto no llega aquí)
}

export default function MapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading, isError, error } = useOrder(id);
  const insets = useSafeAreaInsets();

  const [origin, setOrigin] = useState<LatLng | null>(null);

  // Fase: mientras no se ha llegado a la tienda la ruta apunta a la tienda;
  // al confirmar "TENGO EL PEDIDO" (PICKED_UP) la ruta apunta al cliente.
  const phase = order ? phaseOf(order.status) : undefined;
  const routeTarget: "customer" | "store" | undefined =
    phase === "to-store"
      ? "store"
      : phase === "to-customer"
        ? "customer"
        : undefined;

  const from = origin ? `${origin.lng},${origin.lat}` : undefined;
  const { data: route, isPending: routePending } = useOrderRoute(
    order?.id,
    from,
    routeTarget,
  );

  const refreshPosition = async () => {
    const pos = await getCurrentPosition();
    if (pos) setOrigin(pos);
  };

  // Posición inicial + refresco cada 15 s.
  useEffect(() => {
    void refreshPosition();
    const t = setInterval(() => void refreshPosition(), 15_000);
    return () => clearInterval(t);
  }, []);

  // Tracking GPS en foreground solo durante la entrega (PICKED_UP / IN_DELIVERY).
  useEffect(() => {
    if (!order) return;
    const active = order.status === "PICKED_UP" || order.status === "IN_DELIVERY";
    if (active) {
      void startDeliveryTracking((ping) => api.sendLocation(ping));
    } else {
      stopDeliveryTracking();
    }
    return () => stopDeliveryTracking();
  }, [order?.status, order?.id]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError || !order) {
    return (
      <View style={styles.padded}>
        <ErrorBox message={error instanceof Error ? error.message : "Pedido no encontrado."} />
      </View>
    );
  }

  const destination = order.destination;
  const pickup =
    order.pickup.branch.lat != null && order.pickup.branch.lng != null
      ? { lat: order.pickup.branch.lat, lng: order.pickup.branch.lng }
      : null;

  const showCustomer = phase !== "to-store"; // el cliente se muestra al llegar a la tienda
  const navigateTo = phase === "to-store" ? pickup : destination;
  const distance = route?.distanceM != null ? route.distanceM / 1000 : null;

  return (
    <View style={styles.container}>
      <DeliveryMap
        destination={showCustomer ? destination : null}
        origin={origin}
        pickup={pickup}
        routePolyline={route?.polyline}
      />

      {/* Barra de información */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{phase === "to-store" ? "Tienda" : "Destino"}</Text>
          <Text style={styles.infoValue} numberOfLines={1}>
            {phase === "to-store"
              ? [order.pickup.branch.name, order.pickup.branch.address]
                  .filter(Boolean)
                  .join(" · ")
              : `${order.customer.name} · ${order.address.line1}`}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Distancia</Text>
          <Text style={styles.infoValue}>
            {route?.distanceM != null && distance != null
              ? `${distance.toFixed(1)} km (ruta real)`
              : phase === "at-store"
                ? "En la tienda"
                : routeTarget && routePending
                  ? "Calculando…"
                  : "Sin ruta"}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Tiempo estimado</Text>
          <Text style={styles.infoValue}>
            {route?.durationS != null
              ? formatDuration(route.durationS)
              : phase === "at-store"
                ? "—"
                : "—"}
          </Text>
        </View>
      </View>

      {/* Acciones (sobre el borde seguro para no quedar tras la barra de navegación) */}
      <View style={[styles.actions, { bottom: spacing(4) + insets.bottom }]}>
        <Button
          label="ABRIR NAVEGACIÓN"
          icon="navigate-outline"
          onPress={() =>
            navigateTo
              ? openExternalNavigation(navigateTo)
              : Alert.alert(
                  phase === "to-store"
                    ? "Sin coordenadas de tienda"
                    : "Sin coordenadas",
                  "No hay un punto GPS válido para navegar.",
                )
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  padded: { padding: spacing(4), flex: 1, backgroundColor: colors.background },
  infoCard: {
    position: "absolute",
    top: spacing(3),
    left: spacing(3),
    right: spacing(3),
    backgroundColor: "rgba(255,255,255,0.97)",
    borderRadius: radius.lg,
    padding: spacing(3),
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing(2), paddingVertical: 2 },
  infoLabel: { fontSize: 12, color: colors.textFaint, fontWeight: "600" },
  infoValue: { fontSize: 13, color: colors.text, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  actions: {
    position: "absolute",
    bottom: spacing(4),
    left: spacing(4),
    right: spacing(4),
    gap: spacing(2),
  },
});
