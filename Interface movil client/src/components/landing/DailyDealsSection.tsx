import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { landingApi } from "../../api/content";
import type { Product } from "../../api/types";
import { useCartStore } from "../../stores/cart";
import { colors, duration, fonts, fmtCOP, radii, spacing, text } from "../../theme";

const discountPct = (p: Product) =>
  p.originalPrice ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;

/** Sección "Ofertas del día": tarjeta destacada + carrusel de 1 ítem. */
export function DailyDealsSection() {
  const add = useCartStore((s) => s.add);
  const query = useQuery({
    queryKey: ["daily-deals"],
    queryFn: landingApi.getDailyDeals,
  });
  const featuredItems = query.data?.featuredItems ?? [];
  const carousel = query.data?.carousel ?? [];

  const [featuredIdx, setFeaturedIdx] = useState(0);
  const [carouselStart, setCarouselStart] = useState(0);
  const [localQtys, setLocalQtys] = useState<Record<number, number>>({});

  const featuredOpacity = useRef(new Animated.Value(1)).current;
  const carouselAnim = useRef(new Animated.Value(0)).current;
  const carouselOpacity = useRef(new Animated.Value(1)).current;

  const animateFeatured = () => {
    featuredOpacity.setValue(0);
    Animated.timing(featuredOpacity, {
      toValue: 1,
      duration: duration.base,
      useNativeDriver: true,
    }).start();
  };

  const selectFeatured = (idx: number) => {
    setFeaturedIdx(idx);
    animateFeatured();
  };

  useEffect(() => {
    if (featuredItems.length <= 1) return;
    const id = setInterval(() => {
      setFeaturedIdx((i) => (i + 1) % featuredItems.length);
      animateFeatured();
    }, duration.autoplayDeals);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredItems.length]);

  const goCarousel = (next: number, dir: 1 | -1) => {
    carouselAnim.setValue(dir * 56);
    carouselOpacity.setValue(0);
    setCarouselStart(next);
    Animated.parallel([
      Animated.timing(carouselAnim, {
        toValue: 0,
        duration: duration.base,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(carouselOpacity, {
        toValue: 1,
        duration: duration.base,
        useNativeDriver: true,
      }),
    ]).start();
  };

  useEffect(() => {
    if (carousel.length <= 1) return;
    const id = setInterval(() => {
      goCarousel((carouselStart + 1) % carousel.length, 1);
    }, duration.autoplayDeals);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carousel.length, carouselStart]);

  if (featuredItems.length === 0 && carousel.length === 0) return null;

  const featured =
    featuredItems.length > 0
      ? featuredItems[featuredIdx % featuredItems.length]
      : undefined;
  const featuredTitle = featured
    ? (featured.title || "").replace(/\\n/g, "\n")
    : "";
  const carouselProduct =
    carousel.length > 0 ? carousel[carouselStart % carousel.length] : undefined;
  const qty = carouselProduct ? (localQtys[carouselProduct.id] ?? 1) : 1;

  const incQty = (id: number) =>
    setLocalQtys((prev) => ({ ...prev, [id]: (prev[id] ?? 1) + 1 }));
  const decQty = (id: number) =>
    setLocalQtys((prev) => ({ ...prev, [id]: Math.max(1, (prev[id] ?? 1) - 1) }));
  const handleAdd = (p: Product) => {
    add(p, localQtys[p.id] ?? 1);
    setLocalQtys((prev) => ({ ...prev, [p.id]: 1 }));
  };

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.bar} />
          <View>
            <Text style={styles.eyebrow}>Cada día</Text>
            <Text style={styles.title}>Ofertas del día</Text>
          </View>
        </View>
        {featuredItems.length > 1 && (
          <View style={styles.dots}>
            {featuredItems.map((_, i) => (
              <Pressable
                key={i}
                onPress={() => selectFeatured(i)}
                style={[
                  styles.dot,
                  i === featuredIdx ? styles.dotActive : styles.dotInactive,
                ]}
              />
            ))}
          </View>
        )}
      </View>

      {featured && (
        <View style={styles.featuredCard}>
          <LinearGradient
            colors={[featured.bgFrom || "#1A4A2E", featured.bgTo || "#0D3B1F"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.featuredImageWrap}>
            {featured.image ? (
              <Image
                source={{ uri: featured.image }}
                style={styles.featuredImage}
                resizeMode="cover"
              />
            ) : null}
            <LinearGradient
              colors={["rgba(0,0,0,0.35)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </View>

          <Animated.View style={[styles.featuredContent, { opacity: featuredOpacity }]}>
            {!!featured.discount && (
              <View style={styles.featuredBadge}>
                <Text style={styles.featuredBadgeText}>{featured.discount}</Text>
              </View>
            )}
            <Text style={styles.featuredTitle}>{featuredTitle}</Text>
            {!!featured.subtitle && (
              <Text style={styles.featuredSubtitle}>{featured.subtitle}</Text>
            )}
            <View style={styles.priceRow}>
              <Text style={styles.priceActual}>{fmtCOP(featured.price)}</Text>
              {!!featured.originalPrice && (
                <Text style={styles.priceOriginal}>
                  {fmtCOP(featured.originalPrice)}
                </Text>
              )}
            </View>
            {!!featured.unit && (
              <Text style={styles.featuredUnit}>{featured.unit}</Text>
            )}
            {!!featured.endsAt && (
              <Text style={styles.featuredEndsAt}>⏱ {featured.endsAt}</Text>
            )}
          </Animated.View>
        </View>
      )}

      {carousel.length > 0 && carouselProduct && (
        <View style={styles.carouselBlock}>
          <Text style={styles.moreTitle}>Más ofertas</Text>
          <View style={styles.carouselWrap}>
            <Animated.View
              style={[
                styles.dealCard,
                { opacity: carouselOpacity, transform: [{ translateX: carouselAnim }] },
              ]}
            >
              <View style={styles.dealImageWrap}>
                {carouselProduct.image ? (
                  <Image
                    source={{ uri: carouselProduct.image }}
                    style={styles.dealImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.dealImage, styles.dealImagePlaceholder]}>
                    <Ionicons
                      name="basket-outline"
                      size={28}
                      color={colors.mutedForeground}
                    />
                  </View>
                )}
                {discountPct(carouselProduct) > 0 && (
                  <View style={styles.dealBadge}>
                    <Text style={styles.dealBadgeText}>
                      {discountPct(carouselProduct)}% OFF
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.dealBody}>
                <Text style={styles.dealCategory} numberOfLines={1}>
                  {carouselProduct.category || "Producto"}
                </Text>
                <Text style={styles.dealName} numberOfLines={2}>
                  {carouselProduct.name}
                </Text>
                <View style={styles.dealPriceRow}>
                  <Text style={styles.dealPrice}>
                    {fmtCOP(carouselProduct.price)}
                  </Text>
                  {!!carouselProduct.originalPrice &&
                    carouselProduct.originalPrice > carouselProduct.price && (
                      <Text style={styles.dealOriginal}>
                        {fmtCOP(carouselProduct.originalPrice)}
                      </Text>
                    )}
                </View>

                <View style={styles.stepper}>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() => decQty(carouselProduct.id)}
                  >
                    <Ionicons name="remove" size={14} color={colors.foreground} />
                  </Pressable>
                  <Text style={styles.stepperQty}>{qty}</Text>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() => incQty(carouselProduct.id)}
                  >
                    <Ionicons name="add" size={14} color={colors.foreground} />
                  </Pressable>
                </View>

                <Pressable
                  style={styles.addBtn}
                  onPress={() => handleAdd(carouselProduct)}
                >
                  <Ionicons
                    name="cart-outline"
                    size={14}
                    color={colors.primaryForeground}
                  />
                  <Text style={styles.addBtnText}>Agregar</Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: spacing.threeXl,
    backgroundColor: "#FAFAFB",
  },
  header: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  bar: {
    width: 8,
    height: 32,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  eyebrow: {
    fontSize: text.xs,
    fontFamily: fonts.displayBlack,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: colors.mutedForeground,
  },
  title: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
  },
  dots: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { height: 8, borderRadius: 4 },
  dotActive: { width: 20, backgroundColor: colors.secondary },
  dotInactive: { width: 8, backgroundColor: "#D1D5DB" },
  featuredCard: {
    borderRadius: radii.twoXl,
    overflow: "hidden",
    minHeight: 340,
    marginHorizontal: spacing.lg,
  },
  featuredImageWrap: { height: 176, width: "100%" },
  featuredImage: { width: "100%", height: 176 },
  featuredContent: { padding: spacing.xl },
  featuredBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
    marginBottom: spacing.lg,
  },
  featuredBadgeText: {
    fontSize: text.xxs,
    fontFamily: fonts.displayBlack,
    textTransform: "uppercase",
    letterSpacing: 1.6,
    color: colors.primaryForeground,
  },
  featuredTitle: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    color: colors.white,
    marginBottom: spacing.xs,
  },
  featuredSubtitle: {
    fontSize: text.xs,
    color: "rgba(255,255,255,0.65)",
    marginBottom: spacing.lg,
  },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  priceActual: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    color: colors.white,
  },
  priceOriginal: {
    fontSize: text.sm,
    textDecorationLine: "line-through",
    color: "rgba(255,255,255,0.45)",
  },
  featuredUnit: {
    fontSize: text.xs,
    color: "rgba(255,255,255,0.5)",
    marginTop: 6,
  },
  featuredEndsAt: {
    fontSize: text.xs,
    fontFamily: fonts.sansSemibold,
    color: colors.primary,
    marginTop: spacing.md,
  },
  carouselBlock: { marginTop: spacing.xl },
  moreTitle: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    color: colors.mutedForeground,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  carouselWrap: { paddingHorizontal: spacing.lg },
  dealCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    overflow: "hidden",
  },
  dealImageWrap: { position: "relative" },
  dealImage: { width: "100%", aspectRatio: 1, backgroundColor: colors.muted },
  dealImagePlaceholder: { alignItems: "center", justifyContent: "center" },
  dealBadge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  dealBadgeText: {
    fontSize: text.xs,
    fontFamily: fonts.displayBlack,
    color: colors.white,
  },
  dealBody: { padding: spacing.md, gap: spacing.xs },
  dealCategory: { fontSize: text.xs, color: colors.mutedForeground },
  dealName: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    color: colors.foreground,
    height: 40,
  },
  dealPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  dealPrice: {
    fontSize: text.base,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  dealOriginal: {
    fontSize: text.xs,
    textDecorationLine: "line-through",
    color: colors.mutedForeground,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  stepperBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    backgroundColor: colors.muted,
  },
  stepperQty: {
    fontSize: text.sm,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
    width: 32,
    textAlign: "center",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 6,
    width: "100%",
    marginTop: spacing.xs,
  },
  addBtnText: {
    fontSize: text.sm,
    fontFamily: fonts.sansSemibold,
    color: colors.primaryForeground,
  },
});
