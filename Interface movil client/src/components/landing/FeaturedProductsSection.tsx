import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { featuredApi } from "../../api/content";
import type { Product } from "../../api/types";
import { ProductCard } from "../ProductCard";
import { colors, fonts, radii, shadow, spacing, text } from "../../theme";

/** Sección "Productos destacados" con pestañas y grid de 2 columnas. */
export function FeaturedProductsSection() {
  const tabs = useQuery({
    queryKey: ["featured-tabs"],
    queryFn: featuredApi.getTabs,
  });
  const tabsData = tabs.data ?? [];

  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const activeTabSlug = activeSlug ?? tabsData[0]?.slug ?? "";

  const products = useQuery({
    queryKey: ["featured-tab", activeTabSlug],
    queryFn: () => featuredApi.getTabProducts(activeTabSlug),
    enabled: !!activeTabSlug,
  });

  // Detección de overflow para las flechas de las pestañas.
  const tabsScrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const contentWidthRef = useRef(0);
  const containerWidthRef = useRef(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateHints = (offsetX: number) => {
    const maxScroll = Math.max(
      0,
      contentWidthRef.current - containerWidthRef.current,
    );
    setCanScrollLeft(offsetX > 1);
    setCanScrollRight(offsetX < maxScroll - 1);
  };

  const scrollTabs = (dir: -1 | 1) => {
    const maxScroll = Math.max(
      0,
      contentWidthRef.current - containerWidthRef.current,
    );
    const next = Math.max(
      0,
      Math.min(
        maxScroll,
        scrollOffsetRef.current + dir * containerWidthRef.current * 0.8,
      ),
    );
    tabsScrollRef.current?.scrollTo({ x: next, animated: true });
  };

  const openProduct = (p: Product) => router.push(`/product/${p.id}`);

  const hasTabs = tabsData.length > 0;

  return (
    <View style={styles.section}>
      <View style={styles.container}>
        <Text style={styles.title}>Productos destacados</Text>

        {!hasTabs ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Configura los productos destacados desde el panel admin
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.tabsWrap}>
              <ScrollView
                ref={tabsScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabsContent}
                onLayout={(e) => {
                  containerWidthRef.current = e.nativeEvent.layout.width;
                  updateHints(scrollOffsetRef.current);
                }}
                onContentSizeChange={(w) => {
                  contentWidthRef.current = w;
                  updateHints(scrollOffsetRef.current);
                }}
                onScroll={(e) => {
                  const x = e.nativeEvent.contentOffset.x;
                  scrollOffsetRef.current = x;
                  updateHints(x);
                }}
                scrollEventThrottle={16}
              >
                {tabsData.map((tab) => {
                  const active = activeTabSlug === tab.slug;
                  return (
                    <Pressable
                      key={tab.id}
                      onPress={() => setActiveSlug(tab.slug)}
                      style={[
                        styles.chip,
                        active ? styles.chipActive : styles.chipInactive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          active
                            ? styles.chipTextActive
                            : styles.chipTextInactive,
                        ]}
                      >
                        {tab.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {canScrollLeft && (
                <Pressable
                  style={[styles.arrow, styles.arrowLeft]}
                  onPress={() => scrollTabs(-1)}
                >
                  <Ionicons
                    name="chevron-back"
                    size={16}
                    color={colors.foreground}
                  />
                </Pressable>
              )}
              {canScrollRight && (
                <Pressable
                  style={[styles.arrow, styles.arrowRight]}
                  onPress={() => scrollTabs(1)}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.foreground}
                  />
                </Pressable>
              )}
            </View>

            {products.isLoading ? (
              <ActivityIndicator
                style={styles.loading}
                color={colors.foreground}
              />
            ) : (products.data ?? []).length > 0 ? (
              <View style={styles.grid}>
                {(products.data ?? []).map((p) => (
                  <View key={p.id} style={styles.gridItem}>
                    <ProductCard product={p} onPress={openProduct} />
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyProducts}>
                No hay productos asignados a esta pestaña.
              </Text>
            )}

            <Pressable
              style={styles.viewAll}
              onPress={() => router.push("/catalog")}
            >
              <Text style={styles.viewAllText}>Ver todos los productos</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: spacing.threeXl,
    backgroundColor: colors.background,
  },
  container: { paddingHorizontal: spacing.lg },
  title: {
    fontSize: text.twoXl,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
    marginBottom: spacing.xl,
  },
  empty: {
    borderRadius: radii.twoXl,
    padding: spacing.threeXl,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: text.sm,
    fontFamily: fonts.sansBold,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  tabsWrap: { marginBottom: spacing.xl },
  tabsContent: { gap: spacing.sm, paddingBottom: spacing.xs },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.xl,
  },
  chipActive: { backgroundColor: colors.primary },
  chipInactive: { backgroundColor: colors.muted },
  chipText: { fontSize: text.sm, fontFamily: fonts.sansSemibold },
  chipTextActive: { color: colors.primaryForeground },
  chipTextInactive: { color: colors.mutedForeground },
  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: radii.full,
    backgroundColor: colors.white,
    ...shadow.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowLeft: { left: 0 },
  arrowRight: { right: 0 },
  loading: { marginVertical: spacing.twoXl },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  gridItem: { width: "48%", marginBottom: spacing.md },
  emptyProducts: {
    textAlign: "center",
    paddingVertical: spacing.twoXl,
    fontSize: text.sm,
    fontFamily: fonts.sansMedium,
    color: colors.mutedForeground,
  },
  viewAll: {
    marginTop: spacing.twoXl,
    alignSelf: "center",
    paddingHorizontal: spacing.twoXl,
    paddingVertical: spacing.md,
    borderRadius: radii.xl,
    borderWidth: 2,
    borderColor: colors.foreground,
  },
  viewAllText: {
    fontSize: text.sm,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
});
