import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { catalogApi } from "../../src/api/catalog";
import { ProductCard } from "../../src/components/ProductCard";
import { useCartStore } from "../../src/stores/cart";
import { colors, fmtCOP, fonts, radii, spacing, text } from "../../src/theme";

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = Number(id);
  const [qty, setQty] = useState(1);
  const add = useCartStore((s) => s.add);

  const product = useQuery({
    queryKey: ["product", productId],
    queryFn: () => catalogApi.getProductById(productId),
  });
  const related = useQuery({
    queryKey: ["related", productId],
    queryFn: () => catalogApi.getRelatedProducts(productId),
  });

  if (product.isLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator
          style={{ marginTop: 80 }}
          color={colors.foreground}
        />
      </SafeAreaView>
    );
  }

  const p = product.data;
  if (!p) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={{ textAlign: "center", marginTop: 80, color: colors.mutedForeground }}>
          Producto no encontrado
        </Text>
      </SafeAreaView>
    );
  }

  const discountPct = p.originalPrice
    ? Math.round((1 - p.price / p.originalPrice) * 100)
    : 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Pressable style={styles.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color={colors.foreground} />
          </Pressable>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {p.name}
          </Text>
          <View style={{ width: 32 }} />
        </View>

        {/* Imagen */}
        <View style={styles.imageWrap}>
          {p.image ? (
            <Image source={{ uri: p.image }} style={styles.image} />
          ) : (
            <View style={[styles.image, styles.placeholder]}>
              <Ionicons name="basket-outline" size={48} color={colors.mutedForeground} />
            </View>
          )}
          {discountPct > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{discountPct}% OFF</Text>
            </View>
          )}
        </View>

        <View style={styles.body}>
          <Text style={styles.category}>
            {p.category || p.productTypeName || "Producto"}
          </Text>
          <Text style={styles.name}>{p.name}</Text>

          <View style={styles.priceRow}>
            <Text style={styles.price}>{fmtCOP(p.price)}</Text>
            {!!p.originalPrice && p.originalPrice > p.price && (
              <Text style={styles.originalPrice}>
                {fmtCOP(p.originalPrice)}
              </Text>
            )}
          </View>

          {!!p.description && (
            <Text style={styles.description}>{p.description}</Text>
          )}

          {/* Cantidad + agregar */}
          <View style={styles.qtyRow}>
            <View style={styles.qtyPicker}>
              <Pressable
                style={styles.qtyBtn}
                onPress={() => setQty((q) => Math.max(1, q - 1))}
              >
                <Ionicons name="remove" size={16} color={colors.foreground} />
              </Pressable>
              <Text style={styles.qtyText}>{qty}</Text>
              <Pressable
                style={styles.qtyBtn}
                onPress={() => setQty((q) => q + 1)}
              >
                <Ionicons name="add" size={16} color={colors.foreground} />
              </Pressable>
            </View>
            <Pressable
              style={styles.addBtn}
              onPress={() => {
                add(p, qty);
                router.push("/cart");
              }}
            >
              <Ionicons name="cart-outline" size={18} color={colors.primaryForeground} />
              <Text style={styles.addBtnText}>
                Agregar {fmtCOP(p.price * qty)}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Relacionados */}
        {related.data && related.data.length > 0 && (
          <View style={styles.related}>
            <Text style={styles.relatedTitle}>Productos relacionados</Text>
            <FlatList
              scrollEnabled={false}
              numColumns={2}
              data={related.data}
              keyExtractor={(r) => String(r.id)}
              columnWrapperStyle={{ gap: spacing.md }}
              contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
              renderItem={({ item }) => (
                <View style={{ flex: 1 }}>
                  <ProductCard
                    product={item}
                    onPress={(x) => router.push(`/product/${x.id}`)}
                  />
                </View>
              )}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: { padding: 4 },
  topBarTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: text.sm,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  imageWrap: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radii.twoXl,
    overflow: "hidden",
    backgroundColor: colors.muted,
  },
  image: { width: "100%", aspectRatio: 1 },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: spacing.lg,
    left: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radii.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { color: "#fff", fontSize: text.xs, fontFamily: fonts.sansBold },
  body: { padding: spacing.lg, gap: spacing.md },
  category: {
    fontSize: text.xs,
    fontFamily: fonts.sansSemibold,
    color: colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  name: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    lineHeight: 30,
    color: colors.foreground,
  },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.md },
  price: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBold,
    color: colors.foreground,
  },
  originalPrice: {
    fontSize: text.sm,
    fontFamily: fonts.sans,
    color: colors.mutedForeground,
    textDecorationLine: "line-through",
  },
  description: {
    fontSize: text.sm,
    fontFamily: fonts.sans,
    color: colors.mutedForeground,
    lineHeight: 21,
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  qtyPicker: {
    width: 120,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  qtyBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyText: {
    width: 40,
    textAlign: "center",
    fontSize: text.base,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  addBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    paddingVertical: 12,
  },
  addBtnText: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    color: colors.primaryForeground,
  },
  related: { marginTop: spacing.xl, paddingBottom: spacing.lg },
  relatedTitle: {
    fontSize: text.sm,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
});
