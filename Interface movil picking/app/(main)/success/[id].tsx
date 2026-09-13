import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/theme";
import { formatMoney } from "@/lib/format";
import { useOrder } from "@/picking/queries";
import { Button } from "@/ui/Button";

export default function SuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const orderId = Number(params.id);
  const { data: order } = useOrder(orderId);

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <View style={styles.check}>
          <Ionicons name="checkmark" size={54} color="#04120A" />
        </View>
        <Text style={styles.title}>¡Entregado!</Text>
        {order ? (
          <Text style={styles.subtitle}>
            Pedido {order.referenceCode} entregado exitosamente en caja
          </Text>
        ) : null}
      </View>

      {order ? (
        <View style={styles.card}>
          <Row label="Cliente" value={order.customerName} />
          <Row label="Total" value={formatMoney(order.grandTotal)} />
          <Row label="Productos" value={`${order.items?.length ?? order.itemsCount} items`} />
          <Row label="Sucursal" value={`#${order.branchId}`} />
        </View>
      ) : null}

      <View style={styles.cta}>
        <Button label="Volver a la lista" onPress={() => router.replace("/(main)")} />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: spacing(5), justifyContent: "center" },
  hero: { alignItems: "center", gap: spacing(3), marginBottom: spacing(8) },
  check: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: colors.textMuted, fontSize: 14, fontWeight: "500", textAlign: "center" },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing(4),
    gap: spacing(3),
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing(3) },
  rowLabel: { color: colors.textFaint, fontSize: 13, fontWeight: "500" },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  cta: { marginTop: spacing(8) },
});
