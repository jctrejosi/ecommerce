import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { bannersApi } from "../../api/catalog";
import {
  colors,
  duration,
  fonts,
  layout,
  radii,
  spacing,
} from "../../theme";

const WHITE = "#FFFFFF";
const WHITE_75 = "rgba(255, 255, 255, 0.75)";
const WHITE_20 = "rgba(255, 255, 255, 0.2)";
const WHITE_40 = "rgba(255, 255, 255, 0.4)";

function Dot({ active, onPress }: { active: boolean; onPress: () => void }) {
  const anim = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: active ? 1 : 0,
      duration: duration.base,
      useNativeDriver: false,
    }).start();
  }, [active, anim]);

  const width = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [6, 24],
  });

  return (
    <Pressable onPress={onPress} hitSlop={6}>
      <Animated.View
        style={[
          styles.dot,
          {
            width,
            backgroundColor: active ? colors.primary : WHITE_40,
          },
        ]}
      />
    </Pressable>
  );
}

export function HeroSection() {
  const { data } = useQuery({
    queryKey: ["hero"],
    queryFn: () => bannersApi.getHero(),
  });

  const slides = useMemo(
    () => (data ?? []).filter((b) => !!b.image),
    [data],
  );

  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const transitioningRef = useRef(false);

  const opacity = useRef(new Animated.Value(1)).current;
  const colorAnim = useRef(new Animated.Value(1)).current;

  const [prevBg, setPrevBg] = useState<string>(colors.foreground);
  const [currBg, setCurrBg] = useState<string>(colors.foreground);

  const goTo = useCallback(
    (next: number) => {
      if (slides.length === 0 || transitioningRef.current) return;
      const target = ((next % slides.length) + slides.length) % slides.length;
      if (target === indexRef.current) return;

      transitioningRef.current = true;
      Animated.timing(opacity, {
        toValue: 0,
        duration: duration.heroFade,
        useNativeDriver: true,
      }).start(() => {
        indexRef.current = target;
        setIndex(target);
        Animated.timing(opacity, {
          toValue: 1,
          duration: duration.heroFade,
          useNativeDriver: true,
        }).start(() => {
          transitioningRef.current = false;
        });
      });
    },
    [opacity, slides.length],
  );

  // Autoplay: se reinicia cada vez que cambia el índice (incluso por gesto manual).
  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setTimeout(() => {
      goTo(indexRef.current + 1);
    }, duration.autoplayHero);
    return () => clearTimeout(t);
  }, [index, slides.length, goTo]);

  // Color inicial cuando cargan los slides.
  useEffect(() => {
    const c = slides[indexRef.current]?.bgColor || colors.foreground;
    setPrevBg(c);
    setCurrBg(c);
    colorAnim.setValue(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  // Transición suave del color de fondo al cambiar de slide.
  useEffect(() => {
    const c = slides[index]?.bgColor || colors.foreground;
    setPrevBg(currBg);
    setCurrBg(c);
    colorAnim.setValue(0);
    Animated.timing(colorAnim, {
      toValue: 1,
      duration: duration.heroFade,
      useNativeDriver: false,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const bgInterp = colorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [prevBg, currBg],
  });

  if (slides.length === 0) return null;

  const slide = slides[index];
  const bgColor = slide.bgColor || colors.foreground;

  const handleCta = () => {
    if (slide.linkUrl && slide.linkUrl.startsWith("/")) {
      router.push(slide.linkUrl);
    } else {
      router.push("/catalog");
    }
  };

  return (
    <Animated.View style={[styles.container, { backgroundColor: bgInterp }]}>
      <Animated.View style={[styles.slide, { opacity }]}>
        {!!slide.image && (
          <Image
            source={{ uri: slide.image }}
            style={styles.bgImage}
            resizeMode="contain"
          />
        )}

        <LinearGradient
          colors={[bgColor, "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradient}
        />

        <View style={styles.content}>
          {!!slide.subtitle && (
            <View
              style={[
                styles.badge,
                { backgroundColor: slide.accentColor || colors.primary },
              ]}
            >
              <Ionicons
                name="sparkles"
                size={12}
                color={colors.primaryForeground}
              />
              <Text style={styles.badgeText}>{slide.subtitle}</Text>
            </View>
          )}

          <Text style={styles.title}>
            {slide.title.replace(/\\n/g, "\n")}
          </Text>

          {!!slide.description && (
            <Text style={styles.description} numberOfLines={2}>
              {slide.description}
            </Text>
          )}

          {!!slide.ctaText && (
            <Pressable
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: slide.accentColor || colors.primary },
                pressed && styles.ctaPressed,
              ]}
              onPress={handleCta}
            >
              <Text style={styles.ctaText}>{slide.ctaText}</Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.primaryForeground}
              />
            </Pressable>
          )}
        </View>
      </Animated.View>

      {slides.length > 1 && (
        <>
          <Pressable
            style={[styles.arrow, styles.arrowLeft]}
            onPress={() => goTo(indexRef.current - 1)}
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={16} color={WHITE} />
          </Pressable>
          <Pressable
            style={[styles.arrow, styles.arrowRight]}
            onPress={() => goTo(indexRef.current + 1)}
            hitSlop={8}
          >
            <Ionicons name="chevron-forward" size={16} color={WHITE} />
          </Pressable>

          <View style={styles.dots}>
            {slides.map((s, i) => (
              <Dot
                key={s.id}
                active={i === index}
                onPress={() => goTo(i)}
              />
            ))}
          </View>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: layout.heroHeight,
    overflow: "hidden",
  },
  slide: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  bgImage: {
    position: "absolute",
    top: 0,
    right: 0,
    width: "50%",
    height: "100%",
    opacity: 0.45,
  },
  gradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
    maxWidth: 576,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radii.full,
    marginBottom: 20,
  },
  badgeText: {
    color: colors.primaryForeground,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  title: {
    color: WHITE,
    fontSize: 30,
    fontFamily: fonts.displayBlack,
    lineHeight: 33,
    marginBottom: spacing.lg,
  },
  description: {
    color: WHITE_75,
    fontSize: 14,
    marginBottom: 28,
    maxWidth: 384,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radii.xl,
  },
  ctaPressed: {
    transform: [{ scale: 0.95 }],
  },
  ctaText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: radii.full,
    backgroundColor: WHITE_20,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowLeft: { left: spacing.sm },
  arrowRight: { right: spacing.sm },
  dots: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.lg,
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
  },
  dot: {
    height: 6,
    borderRadius: radii.full,
  },
});
