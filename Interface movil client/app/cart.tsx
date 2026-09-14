import { useEffect, useState } from "react";
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
import { catalogApi } from "../src/api/catalog";
import type { Product } from "../src/api/types";
import { ProductCard } from "../src/components/ProductCard";
import { useCartStore } from "../src/stores/cart";
import { colors, fmtCOP, fonts, radii, spacing, text } from "../src/theme";

export default function CartScreen() {
  const items = useCartStore((s) => s.items);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const remove = useCartStore((s) => s.remove);
  const clear = useCartStore((s) => s.clear);
  const subtotal = useCartStore((s) => s.subtotal());

  // Recomendaciones: productos relacionados al primer ítem del carrito.
  const [recommended, setRecommended] = useState<Product[]>([]);
  const firstItemId = items[0]?.id;

  useEffect(() => {
    if (firstItemId == null) {
      setRecommended([]);
      return;
    }
    let active = true;
    catalogApi
      .getRelatedProducts(firstItemId)
      .then((rows) => {
        if (active) setRecommended(rows.slice(0, 6));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [firstItemId]);

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons
              name="cart-outline"
              size={32}
              color={colors.mutedForeground}
            />
          </View>
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
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Mi Carrito</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{items.length}</Text>
          </View>
        </View>
        <Pressable onPress={clear} hitSlop={8} style={styles.clearBtn}>
          <Ionicons name="trash-outline" size={18} color={colors.mutedForeground} />
        </Pressable>
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
                <Ionicons
                  name="basket-outline"
                  size={20}
                  color={colors.mutedForeground}
                />
              </View>
            )}
            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={2}>
                {item.name}
              </Text>
              <View style={styles.bottomRow}>
                <Text style={styles.price}>
                  {fmtCOP(item.price * item.quantity)}
                </Text>
                <View style={styles.actions}>
                  <View style={styles.stepper}>
                    <Pressable
                      style={styles.stepperBtn}
                      onPress={() => setQuantity(item.id, item.quantity - 1)}
                    >
                      <Ionicons name="remove" size={14} color={colors.foreground} />
                    </Pressable>
                    <Text style={styles.qtyText}>{item.quantity}</Text>
                    <Pressable
                      style={styles.stepperBtn}
                      onPress={() => setQuantity(item.id, item.quantity + 1)}
                    >
                      <Ionicons name="add" size={14} color={colors.foreground} />
                    </Pressable>
                  </View>
                  <Pressable
                    onPress={() => remove(item.id)}
                    hitSlop={8}
                    style={styles.trashBtn}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.accent} />
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        )}
        ListFooterComponent={
          recommended.length > 0 ? (
            <View style={styles.recommendations}>
              <Text style={styles.recTitle}>Recomendaciones</Text>
              <View style={styles.recGrid}>
                {recommended.map((p) => (
                  <View key={p.id} style={styles.recItem}>
                    <ProductCard
                      product={p}
                      onPress={(pp) => router.push(`/product/${pp.id}`)}
                    />
                  </View>
                ))}
              </View>
            </View>
          ) : null
        }
      />

      <View style={styles.footer}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>{fmtCOP(subtotal)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Envío</Text>
          <Text style={styles.shippingValue}>Calculado al finalizar</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
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
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: { fontSize: text.lg, fontFamily: fonts.displayBlack, color: colors.foreground },
  countBadge: {
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  countBadgeText: {
    fontSize: text.xs,
    fontFamily: fonts.sansBold,
    color: colors.primaryForeground,
  },
  clearBtn: { padding: spacing.xs },

  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radii.twoXl,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: text.lg,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
  },
  emptyText: {
    fontSize: text.sm,
    fontFamily: fonts.sans,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  goCatalog: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  goCatalogText: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    color: colors.primaryForeground,
  },

  row: {
    flexDirection: "row",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.md,
  },
  thumb: { width: 64, height: 64, borderRadius: radii.lg, backgroundColor: colors.muted },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  info: { flex: 1, gap: spacing.sm, justifyContent: "center" },
  name: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    lineHeight: 18,
    color: colors.foreground,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  price: {
    fontSize: text.base,
    fontFamily: fonts.displayBold,
    color: colors.foreground,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    width: 96,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  stepperBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: "center",
    backgroundColor: colors.muted,
  },
  qtyText: {
    width: 32,
    textAlign: "center",
    fontSize: text.sm,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  trashBtn: {
    width: 28,
    height: 28,
    borderRadius: radii.md,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },

  recommendations: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  recTitle: {
    fontSize: text.lg,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
  },
  recGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  recItem: { width: "48%" },

  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  summaryLabel: {
    fontSize: text.sm,
    fontFamily: fonts.sans,
    color: colors.mutedForeground,
  },
  summaryValue: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    color: colors.foreground,
  },
  shippingValue: {
    fontSize: text.xs,
    fontFamily: fonts.sans,
    color: colors.mutedForeground,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  totalLabel: {
    fontSize: text.base,
    fontFamily: fonts.sansSemibold,
    color: colors.foreground,
  },
  totalValue: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
  },
  checkoutBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    paddingVertical: 12,
    alignItems: "center",
  },
  checkoutText: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    color: colors.primaryForeground,
  },
});
