import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCartStore } from "../src/stores/cart";
import { colors, fmtCOP, radius, spacing } from "../src/theme";

export default function CartScreen() {
  const items = useCartStore((s) => s.items);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const remove = useCartStore((s) => s.remove);
  const subtotal = useCartStore((s) => s.subtotal());

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.emptyWrap}>
          <Ionicons name="cart-outline" size={64} color={colors.border} />
          <Text style={styles.emptyTitle}>Tu carrito está vacío</Text>
          <Text style={styles.emptyText}>
            Agrega productos desde el catálogo para empezar tu pedido.
          </Text>
          <Pressable
            style={styles.goCatalog}
            onPress={() => router.push("/catalog")}
          >
            <Text style={styles.goCatalogText}>Ir al catálogo</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Mi carrito</Text>
        <Text style={styles.itemCount}>{items.length} producto(s)</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            {item.image ? (
              <Image source={{ uri: item.image }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Ionicons name="basket-outline" size={20} color={colors.muted} />
              </View>
            )}
            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={styles.unitPrice}>
                {fmtCOP(item.price)} c/u
              </Text>
              <View style={styles.qtyPicker}>
                <Pressable
                  style={styles.qtyBtn}
                  onPress={() => setQuantity(item.id, item.quantity - 1)}
                >
                  <Ionicons name="remove" size={16} color={colors.foreground} />
                </Pressable>
                <Text style={styles.qtyText}>{item.quantity}</Text>
                <Pressable
                  style={styles.qtyBtn}
                  onPress={() => setQuantity(item.id, item.quantity + 1)}
                >
                  <Ionicons name="add" size={16} color={colors.foreground} />
                </Pressable>
              </View>
            </View>
            <View style={styles.rightCol}>
              <Text style={styles.lineTotal}>
                {fmtCOP(item.price * item.quantity)}
              </Text>
              <Pressable onPress={() => remove(item.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color={colors.muted} />
              </Pressable>
            </View>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Subtotal</Text>
          <Text style={styles.totalValue}>{fmtCOP(subtotal)}</Text>
        </View>
        <Pressable
          style={styles.checkoutBtn}
          onPress={() => router.push("/checkout")}
        >
          <Text style={styles.checkoutText}>Ir a pagar</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: "900", color: colors.foreground },
  itemCount: { fontSize: 12, color: colors.muted },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.foreground },
  emptyText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
  },
  goCatalog: {
    marginTop: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
  },
  goCatalogText: { fontWeight: "800", color: colors.foreground },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  thumb: { width: 64, height: 64, borderRadius: radius.sm },
  thumbPlaceholder: {
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  info: { flex: 1, gap: 4 },
  name: { fontSize: 13, fontWeight: "600", color: colors.foreground },
  unitPrice: { fontSize: 12, color: colors.muted },
  qtyPicker: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: "hidden",
    marginTop: 2,
  },
  qtyBtn: { padding: 6, backgroundColor: colors.surface },
  qtyText: {
    minWidth: 28,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "700",
    color: colors.foreground,
  },
  rightCol: {
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  lineTotal: { fontSize: 14, fontWeight: "800", color: colors.foreground },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalLabel: { fontSize: 14, color: colors.muted },
  totalValue: { fontSize: 18, fontWeight: "900", color: colors.foreground },
  checkoutBtn: {
    backgroundColor: colors.foreground,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  checkoutText: { color: colors.accent, fontWeight: "800", fontSize: 15 },
});
