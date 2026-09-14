import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Product } from "../api/types";
import { colors, fmtCOP, fonts, radii, spacing } from "../theme";
import { useCartStore } from "../stores/cart";

interface ProductCardProps {
  product: Product;
  onPress: (p: Product) => void;
}

/** Tarjeta de producto estilo grid (2 columnas), como el web client. */
export function ProductCard({ product, onPress }: ProductCardProps) {
  const items = useCartStore((s) => s.items);
  const add = useCartStore((s) => s.add);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const qty = items.find((i) => i.id === product.id)?.quantity ?? 0;

  const discountPct = product.originalPrice
    ? Math.round((1 - product.price / product.originalPrice) * 100)
    : 0;

  return (
    <Pressable
      onPress={() => onPress(product)}
      style={styles.card}
    >
      <View style={styles.imageWrap}>
        {product.image ? (
          <Image source={{ uri: product.image }} style={styles.image} />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Ionicons name="basket-outline" size={28} color={colors.mutedForeground} />
          </View>
        )}
        {discountPct > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{discountPct}% OFF</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.category} numberOfLines={1}>
          {product.category || product.productTypeName || "Producto"}
        </Text>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{fmtCOP(product.price)}</Text>
          {!!product.originalPrice && product.originalPrice > product.price && (
            <Text style={styles.originalPrice}>{fmtCOP(product.originalPrice)}</Text>
          )}
        </View>

        {qty === 0 ? (
          <Pressable
            style={styles.addBtn}
            onPress={() => add(product, 1)}
          >
            <Ionicons name="cart-outline" size={14} color={colors.foreground} />
            <Text style={styles.addBtnText}>Agregar</Text>
          </Pressable>
        ) : (
          <View style={styles.qtyRow}>
            <Pressable
              style={styles.qtyBtn}
              onPress={() => setQuantity(product.id, qty - 1)}
            >
              <Ionicons name="remove" size={16} color={colors.foreground} />
            </Pressable>
            <Text style={styles.qtyText}>{qty}</Text>
            <Pressable
              style={styles.qtyBtn}
              onPress={() => setQuantity(product.id, qty + 1)}
            >
              <Ionicons name="add" size={16} color={colors.foreground} />
            </Pressable>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    overflow: "hidden",
  },
  imageWrap: { position: "relative" },
  image: { width: "100%", aspectRatio: 1, backgroundColor: colors.muted },
  imagePlaceholder: { alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { color: "#fff", fontSize: 12, fontFamily: fonts.sansBold },
  body: { padding: spacing.md, gap: 4 },
  category: { fontSize: 12, color: colors.mutedForeground, fontFamily: fonts.sans },
  name: {
    fontSize: 14,
    fontFamily: fonts.sansSemibold,
    lineHeight: 20,
    height: 40,
    color: colors.foreground,
  },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  price: {
    fontSize: 16,
    fontFamily: fonts.displayBold,
    color: colors.foreground,
  },
  originalPrice: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: colors.mutedForeground,
    textDecorationLine: "line-through",
  },
  addBtn: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 6,
  },
  addBtnText: { fontSize: 14, fontFamily: fonts.sansSemibold, color: colors.foreground },
  qtyRow: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  qtyBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: "center",
    backgroundColor: colors.muted,
  },
  qtyText: {
    fontSize: 14,
    fontFamily: fonts.sansBold,
    width: 32,
    textAlign: "center",
    color: colors.foreground,
  },
});
