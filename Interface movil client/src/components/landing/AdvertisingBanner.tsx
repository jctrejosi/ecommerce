import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
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
import { bannersApi } from "../../api/catalog";
import { colors, duration, fonts, radii, spacing, text } from "../../theme";

/** Carrusel oscuro de banners "promo". */
export function AdvertisingBanner() {
  const query = useQuery({
    queryKey: ["promo-banners"],
    queryFn: () => bannersApi.getByType("promo"),
  });
  const banners = query.data ?? [];

  const [current, setCurrent] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const goTo = (idx: number, dir: 1 | -1) => {
    translateX.setValue(dir * 64);
    opacity.setValue(0);
    setCurrent(idx);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: duration.carousel,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: duration.carousel,
        useNativeDriver: true,
      }),
    ]).start();
  };

  useEffect(() => {
    if (banners.length <= 1) return;
    const id = setInterval(() => {
      goTo((current + 1) % banners.length, 1);
    }, duration.autoplayAds);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, banners.length]);

  if (banners.length === 0) return null;

  const banner = banners[current];
  const subtitle = banner.subtitle || banner.description;
  const hasText = !!(banner.title || subtitle || banner.ctaText);
  const accent = banner.accentColor || colors.primary;
  const image = banner.image || banner.mobileImage;
  const badge = banner.title
    ? banner.title.split(" ").slice(0, 2).join(" ").toUpperCase()
    : "OFERTA";

  return (
    <View style={styles.section}>
      <View style={styles.container}>
        <View style={styles.card}>
          <LinearGradient
            colors={[banner.bgColor || "#1A1A2E", "#16213E", "#0F3460"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {image ? (
            hasText ? (
              <View style={styles.imageHalf}>
                <Image
                  source={{ uri: image }}
                  style={styles.imageHalfImg}
                  resizeMode="contain"
                />
                <LinearGradient
                  colors={["transparent", "rgba(0,0,0,0.1)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            ) : (
              <Image
                source={{ uri: image }}
                style={styles.imageFill}
                resizeMode="contain"
              />
            )
          ) : null}

          <Animated.View
            style={[styles.content, { opacity, transform: [{ translateX }] }]}
          >
            {!!(banner.accentColor || banner.title) && (
              <View style={[styles.badge, { backgroundColor: accent }]}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            )}
            {!!banner.title && (
              <Text style={styles.title} numberOfLines={1}>
                {banner.title}
              </Text>
            )}
            {!!subtitle && (
              <Text style={styles.subtitle} numberOfLines={2}>
                {subtitle}
              </Text>
            )}
            {!!banner.ctaText && (
              <Pressable
                style={[styles.cta, { backgroundColor: accent }]}
                onPress={() => router.push("/catalog")}
              >
                <Text style={styles.ctaText}>{banner.ctaText}</Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.primaryForeground}
                />
              </Pressable>
            )}
          </Animated.View>

          {banners.length > 1 && (
            <>
              <Pressable
                style={[styles.arrow, styles.arrowLeft]}
                onPress={() =>
                  goTo((current - 1 + banners.length) % banners.length, -1)
                }
              >
                <Ionicons name="chevron-back" size={16} color={colors.white} />
              </Pressable>
              <Pressable
                style={[styles.arrow, styles.arrowRight]}
                onPress={() => goTo((current + 1) % banners.length, 1)}
              >
                <Ionicons name="chevron-forward" size={16} color={colors.white} />
              </Pressable>

              <View style={styles.dots}>
                {banners.map((_, i) => (
                  <Pressable
                    key={i}
                    onPress={() => goTo(i, i > current ? 1 : -1)}
                    style={[
                      styles.dot,
                      i === current ? styles.dotActive : styles.dotInactive,
                    ]}
                  />
                ))}
              </View>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: spacing.xl,
    backgroundColor: colors.background,
  },
  container: { paddingHorizontal: spacing.lg },
  card: { height: 160, borderRadius: radii.twoXl, overflow: "hidden" },
  imageHalf: {
    position: "absolute",
    right: 0,
    top: 0,
    width: "50%",
    height: "100%",
  },
  imageHalfImg: { width: "100%", height: "100%", opacity: 0.25 },
  imageFill: {
    ...StyleSheet.absoluteFill,
    width: "100%",
    height: "100%",
  },
  content: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: spacing.xl,
    gap: spacing.lg,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  badgeText: {
    fontSize: text.xxs,
    fontFamily: fonts.displayBlack,
    textTransform: "uppercase",
    letterSpacing: 1.6,
    color: colors.primaryForeground,
  },
  title: {
    fontSize: text.xl,
    fontFamily: fonts.displayBlack,
    color: colors.white,
  },
  subtitle: {
    fontSize: text.sm,
    color: "rgba(255,255,255,0.7)",
    maxWidth: 384,
  },
  cta: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.xl,
  },
  ctaText: {
    fontSize: text.sm,
    fontFamily: fonts.sansBold,
    color: colors.primaryForeground,
  },
  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: radii.full,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  arrowLeft: { left: spacing.md },
  arrowRight: { right: spacing.md },
  dots: {
    position: "absolute",
    bottom: spacing.md,
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
  },
  dot: { height: 6, borderRadius: 3 },
  dotActive: { width: 20, backgroundColor: colors.primary },
  dotInactive: { width: 6, backgroundColor: "rgba(255,255,255,0.4)" },
});
