import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useOrder, useTransitionOrder } from "@/api/orders";
import type { OrderItem } from "@/api/types";
import { DeliveryProofModal } from "@/ui/DeliveryProofModal";
import type { DeliveryProofPayload } from "@/ui/DeliveryProofModal";
import { actionsFor } from "@/delivery/state-machine";
import type { StateAction } from "@/delivery/state-machine";
import { StatusBadge } from "@/ui/StatusBadge";
import { Button } from "@/ui/Button";
import { ErrorBox } from "@/ui/ErrorBox";
import { Screen } from "@/ui/Screen";
import { callPhone } from "@/maps/navigation";
import { formatDateTime, formatMoney } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: order, isLoading, isError, error } = useOrder(id);
  const transition = useTransitionOrder(id);

  const [reasonAction, setReasonAction] = useState<StateAction | null>(null);
  const [reason, setReason] = useState("");
  const [proofOpen, setProofOpen] = useState(false);

  const runAction = (action: StateAction) => {
    transition.mutate(
      { action: action.key },
      {
        onSuccess: (updated) => {
          Alert.alert("Listo ✅", `Pedido actualizado: ${updated.status}`);
          if (action.key === "deliver" || action.key === "fail" || action.key === "reject") {
            router.replace("/(main)");
          }
        },
        onError: (err) => {
          Alert.alert("No se pudo actualizar", err instanceof Error ? err.message : "Intenta de nuevo.");
        },
      },
    );
  };

  const runWithReason = () => {
    if (!reasonAction) return;
    transition.mutate(
      { action: reasonAction.key, payload: { reason: reason.trim() } },
      {
        onSuccess: (updated) => {
          setReasonAction(null);
          setReason("");
          Alert.alert("Registrado", `Pedido ${updated.status}.`);
          router.replace("/(main)");
        },
        onError: (err) => {
          Alert.alert("No se pudo actualizar", err instanceof Error ? err.message : "Intenta de nuevo.");
        },
      },
    );
  };

  const confirmDelivery = async (proof: DeliveryProofPayload) => {
    await transition.mutateAsync({
      action: "deliver",
      payload: {
        proofLocationUrl: proof.proofLocationUrl,
        proofPackageUrl: proof.proofPackageUrl,
        note: proof.note,
      },
    });
    // Al éxito la mutación ya refresca la caché; se cierra el modal aquí.
    setProofOpen(false);
  };

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (isError || !order) {
    return (
      <Screen>
        <ErrorBox message={error instanceof Error ? error.message : "Pedido no encontrado."} />
      </Screen>
    );
  }

  const actions = actionsFor(order.status);

  return (
    <Screen bottomInset>
      {/* Cabecera */}
      <View style={styles.headerRow}>
        <Text style={styles.code}>Pedido {order.referenceCode}</Text>
        <StatusBadge status={order.status} />
      </View>
      <Text style={styles.assigned}>Asignado: {formatDateTime(order.assignedAt)}</Text>

      {/* Cliente */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Cliente</Text>
        <Text style={styles.strong} numberOfLines={2}>
          {order.customer.name}
        </Text>
        <Text style={styles.muted}>{order.customer.phone}</Text>
        <View style={styles.customerActions}>
          {/* El chat solo se muestra mientras el pedido está en camino */}
          {(order.status === "PICKED_UP" || order.status === "IN_DELIVERY") && (
            <View style={styles.customerActionBtn}>
              <Button
                label="Chat"
                icon="chatbubble-outline"
                variant="primary"
                onPress={() => router.push(`/chat/${order.id}`)}
              />
            </View>
          )}
          <View style={styles.customerActionBtn}>
            <Button
              label="Llamar"
              icon="call-outline"
              variant="secondary"
              onPress={() => callPhone(order.customer.phone)}
            />
          </View>
        </View>
      </View>

      {/* Dirección */}
      <View style={styles.card}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardTitle, styles.cardTitleInRow]}>Dirección de entrega</Text>
          <Pressable
            onPress={() => router.push(`/map/${order.id}`)}
            style={({ pressed }) => [styles.mapLink, pressed && styles.mapLinkPressed]}
            accessibilityRole="button"
            accessibilityLabel="Ver la dirección en el mapa"
          >
            <Ionicons name="map-outline" size={15} color={colors.primary} />
            <Text style={styles.mapLinkText}>Ver mapa</Text>
          </Pressable>
        </View>
        <Text style={styles.strong}>
          {order.address.line1}
          {order.address.line2 ? `\n${order.address.line2}` : ""}
        </Text>
        {order.address.city ? <Text style={styles.muted}>{order.address.city}</Text> : null}
        {order.address.notes ? (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>Observaciones</Text>
            <Text style={styles.notesText}>{order.address.notes}</Text>
          </View>
        ) : null}
      </View>

      {/* Productos */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Productos</Text>
        {order.items.map((item, i) => (
          <View key={`${item.name}-${i}`} style={styles.itemRow}>
            <ProductThumb item={item} />
            <Text style={styles.itemQty}>{item.quantity}x</Text>
            <Text style={styles.itemName} numberOfLines={2}>
              {item.name}
            </Text>
          </View>
        ))}
      </View>

      {/* Totales y pago */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.muted}>Valor del pedido</Text>
          <Text style={styles.total}>{formatMoney(order.totals.value)}</Text>
        </View>
        {order.totals.shipping ? (
          <View style={styles.rowBetween}>
            <Text style={styles.muted}>Envío</Text>
            <Text style={styles.muted}>{formatMoney(order.totals.shipping)}</Text>
          </View>
        ) : null}
        <View style={styles.rowBetween}>
          <Text style={styles.muted}>Método de pago</Text>
          <Text style={styles.strong}>{order.payment.label}</Text>
        </View>
      </View>

      {/* Recogida */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recoger en</Text>
        <View style={styles.pickupRow}>
          <Ionicons name="storefront-outline" size={30} color={colors.primary} />
          <View style={styles.pickupText}>
            <Text style={styles.strong}>{order.pickup.branch.name}</Text>
            {order.pickup.branch.address ? (
              <Text style={styles.muted}>{order.pickup.branch.address}</Text>
            ) : null}
          </View>
        </View>
      </View>

      {/* Acciones del estado */}
      <View style={styles.actions}>
        <Button
          label="Ver mapa"
          icon="map-outline"
          variant="secondary"
          onPress={() => router.push(`/map/${order.id}`)}
        />
        {actions.map((action) => (
          <Button
            key={action.key}
            label={action.label}
            variant={action.variant === "danger" ? "danger" : action.variant === "secondary" ? "secondary" : "primary"}
            icon={action.key === "accept" ? "checkmark-circle-outline" : undefined}
            loading={transition.isPending && !action.requiresReason}
            disabled={transition.isPending}
            onPress={() => {
              if (action.key === "deliver") {
                setProofOpen(true);
                return;
              }
              action.requiresReason ? setReasonAction(action) : runAction(action);
            }}
          />
        ))}
      </View>

      {/* Modal de motivo (rechazar / falla de entrega) */}
      <Modal
        visible={reasonAction !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReasonAction(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {reasonAction?.key === "fail" ? "¿Qué pasó?" : "Motivo del rechazo"}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={reason}
              onChangeText={setReason}
              placeholder="Escribe el motivo…"
              multiline
            />
            <View style={styles.modalActions}>
              <View style={styles.modalBtn}>
                <Button
                  label="Cancelar"
                  variant="secondary"
                  onPress={() => setReasonAction(null)}
                />
              </View>
              <View style={styles.modalBtn}>
                <Button
                  label={reasonAction?.key === "fail" ? "Registrar falla" : "Rechazar pedido"}
                  variant="danger"
                  loading={transition.isPending}
                  onPress={runWithReason}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirmación de entrega con prueba fotográfica */}
      <DeliveryProofModal
        visible={proofOpen}
        orderReference={order.referenceCode}
        onCancel={() => setProofOpen(false)}
        onSubmit={confirmDelivery}
      />
    </Screen>
  );
}

/**
 * Miniatura del producto: usa la imagen cover del catálogo (media.path).
 * Si el ítem no trae imagen o la URL falla, muestra un placeholder.
 */
function ProductThumb({ item }: { item: OrderItem }) {
  const [broken, setBroken] = useState(false);
  if (!item.image || broken) {
    return (
      <View style={[styles.itemThumb, styles.itemThumbEmpty]}>
        <Ionicons name="bag-outline" size={20} color={colors.textFaint} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: item.image }}
      style={styles.itemThumb}
      resizeMode="cover"
      onError={() => setBroken(true)}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing(1),
  },
  code: { fontSize: 22, fontWeight: "800", color: colors.text, flexShrink: 1 },
  assigned: { fontSize: 13, color: colors.textFaint, marginBottom: spacing(3) },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(4),
    marginBottom: spacing(3),
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.textFaint,
    marginBottom: spacing(2),
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing(2),
    marginBottom: spacing(2),
  },
  cardTitleInRow: { marginBottom: 0, flexShrink: 1 },
  mapLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1.5),
    borderRadius: radius.md,
    backgroundColor: colors.infoBg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mapLinkPressed: { opacity: 0.7 },
  mapLinkText: { fontSize: 12, fontWeight: "800", color: colors.primary },
  strong: { fontSize: 15, fontWeight: "700", color: colors.text, flexShrink: 1 },
  muted: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing(2),
  },
  customerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "stretch",
    gap: spacing(2),
    marginTop: spacing(3),
  },
  /** Cada botón no baja de ~120dp: si no caben los dos, se apilan. */
  customerActionBtn: { flexGrow: 1, flexBasis: 120, minWidth: 0 },
  notes: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing(3),
    marginTop: spacing(3),
  },
  notesTitle: { fontSize: 12, fontWeight: "800", color: colors.warning },
  notesText: { fontSize: 13, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2),
    paddingVertical: spacing(1.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemThumb: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  itemQty: { fontSize: 14, fontWeight: "800", color: colors.primary, width: 32 },
  itemName: { fontSize: 14, color: colors.text, flex: 1 },
  total: { fontSize: 16, fontWeight: "800", color: colors.primary },
  pickupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(3),
  },
  pickupText: { flex: 1, gap: 2 },
  actions: { gap: spacing(2), marginBottom: spacing(6) },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing(5),
  },
  modalCard: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    padding: spacing(5),
    gap: spacing(3),
  },
  modalTitle: { fontSize: 17, fontWeight: "800", color: colors.text },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing(3),
    minHeight: 80,
    textAlignVertical: "top",
    fontSize: 14,
    color: colors.text,
  },
  modalActions: { flexDirection: "row", gap: spacing(2) },
  modalBtn: { flex: 1 },
});
