import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useOrder } from "@/api/orders";
import { DeliveryMap } from "@/maps/DeliveryMap";
import { openExternalNavigation, openGenericNavigation } from "@/maps/navigation";
import { getCurrentPosition, startDeliveryTracking, stopDeliveryTracking } from "@/tracking/location";
import { api } from "@/api";
import { Button } from "@/ui/Button";
import { ErrorBox } from "@/ui/ErrorBox";
import { colors, radius, spacing } from "@/theme";
import type { LatLng } from "@/api/types";

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export default function MapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading, isError, error } = useOrder(id);

  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);

  const refreshPosition = async () => {
    setLocating(true);
    const pos = await getCurrentPosition();
    if (pos) setOrigin(pos);
    setLocating(false);
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

  const distance =
    origin && destination ? haversineKm(origin, destination) : null;

  return (
    <View style={styles.container}>
      <DeliveryMap destination={destination} origin={origin} pickup={pickup} />

      {/* Barra de información */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Destino</Text>
          <Text style={styles.infoValue} numberOfLines={1}>
            {order.customer.name} · {order.address.line1}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Distancia</Text>
          <Text style={styles.infoValue}>
            {distance != null ? `≈ ${distance.toFixed(1)} km (línea recta)` : "Calculando…"}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Tracking</Text>
          <Text style={styles.infoValue}>
            {order.status === "PICKED_UP" || order.status === "IN_DELIVERY"
              ? "🟢 activo (ping cada 15 s)"
              : "⚫ inactivo (fuera de entrega)"}
          </Text>
        </View>
      </View>

      {/* Acciones */}
      <View style={styles.actions}>
        <Button
          label="ABRIR NAVEGACIÓN"
          icon="navigate-outline"
          onPress={() =>
            destination
              ? openExternalNavigation(destination)
              : Alert.alert("Sin coordenadas", "Este pedido no tiene destino GPS.")
          }
        />
        <View style={styles.actionsRow}>
          <View style={styles.half}>
            <Button
              label={locating ? "Ubicando…" : "Mi posición"}
              icon="locate-outline"
              variant="secondary"
              loading={locating}
              onPress={() => void refreshPosition()}
            />
          </View>
          <View style={styles.half}>
            <Button
              label="App del sistema"
              icon="compass-outline"
              variant="secondary"
              onPress={() => destination && openGenericNavigation(destination)}
            />
          </View>
        </View>
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
  actionsRow: { flexDirection: "row", gap: spacing(2) },
  half: { flex: 1 },
});
