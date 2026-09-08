import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { DeliveryOrder } from "@/api/types";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime, formatMoney } from "@/lib/format";
import { colors, radius, spacing } from "@/theme";

interface OrderCardProps {
  order: DeliveryOrder;
  onPress: () => void;
}

/** Tarjeta compacta de pedido (lista activa e historial). */
export function OrderCard({ order, onPress }: OrderCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <Text style={styles.code}>Pedido {order.referenceCode}</Text>
        <StatusBadge status={order.status} />
      </View>

      <Text style={styles.customer}>{order.customer.name}</Text>
      <Text style={styles.address} numberOfLines={1}>
        {order.address.line1}
        {order.address.line2 ? `, ${order.address.line2}` : ""}
      </Text>

      <View style={styles.bottom}>
        <Text style={styles.total}>{formatMoney(order.totals.value)}</Text>
        <View style={styles.right}>
          <Text style={styles.meta}>{order.payment.label}</Text>
          <Text style={styles.meta}>{formatDateTime(order.assignedAt)}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing(4),
    marginBottom: spacing(3),
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.85 },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing(2),
  },
  code: { fontSize: 15, fontWeight: "800", color: colors.text },
  customer: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: 2 },
  address: { fontSize: 13, color: colors.textMuted },
  bottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing(3),
  },
  total: { fontSize: 16, fontWeight: "800", color: colors.primary },
  right: { flexDirection: "row", alignItems: "center", gap: spacing(2) },
  meta: { fontSize: 12, color: colors.textFaint },
});
