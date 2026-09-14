import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
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
import { SafeAreaView } from "react-native-safe-area-context";
import { bannersApi, catalogApi } from "../src/api/catalog";
import type { Product, ProductType } from "../src/api/types";
import { ProductCard } from "../src/components/ProductCard";
import { colors, productTypeIcon, radius, spacing } from "../src/theme";

export default function HomeScreen() {
  const hero = useQuery({
    queryKey: ["hero-banners"],
    queryFn: () => bannersApi.getHero(),
  });
  const types = useQuery({
    queryKey: ["landing-product-types"],
    queryFn: () => catalogApi.getLandingProductTypes(),
  });
  const products = useQuery({
    queryKey: ["home-products"],
    queryFn: () => catalogApi.getProducts({ limit: 20 }),
  });

  const slides = (hero.data ?? []).filter((b) => b.image);

  const openProduct = (p: Product) => router.push(`/product/${p.id}`);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>MercAldas</Text>
          <Pressable
            style={styles.searchBtn}
            onPress={() => router.push("/catalog")}
          >
            <Ionicons name="search" size={16} color={colors.muted} />
            <Text style={styles.searchPlaceholder}>Buscar productos…</Text>
          </Pressable>
        </View>

        {/* Hero banners */}
        {slides.length > 0 && (
          <FlatList
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            data={slides}
            keyExtractor={(b) => String(b.id)}
            style={styles.heroList}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.heroCard,
                  { backgroundColor: item.bgColor || colors.foreground },
                ]}
              >
                {item.image && (
                  <Image
                    source={{ uri: item.image }}
                    style={styles.heroImage}
                    resizeMode="cover"
                  />
                )}
                <View style={styles.heroText}>
                  {!!item.title && (
                    <Text style={styles.heroTitle} numberOfLines={2}>
                      {item.title.replace(/\\n/g, "\n")}
                    </Text>
                  )}
                  {!!item.subtitle && (
                    <Text style={styles.heroSubtitle} numberOfLines={1}>
                      {item.subtitle}
                    </Text>
                  )}
                </View>
              </View>
            )}
          />
        )}

        {/* Nuestros productos (tipos) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Nuestros productos</Text>
        </View>
        <FlatList<ProductType>
          horizontal
          showsHorizontalScrollIndicator={false}
          data={types.data ?? []}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
          renderItem={({ item, index }) => (
            <Pressable
              style={styles.typeChip}
              onPress={() =>
                router.push({
                  pathname: "/catalog",
                  params: { productTypeCode: item.code },
                })
              }
            >
              <View style={styles.typeIcon}>
                <Text style={{ fontSize: 26 }}>{productTypeIcon(item.code, index)}</Text>
              </View>
              <Text style={styles.typeName} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={styles.typeCount}>{item.count} productos</Text>
            </Pressable>
          )}
        />

        {/* Productos */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Productos destacados</Text>
        </View>
        {products.isLoading ? (
          <ActivityIndicator
            style={{ marginVertical: 32 }}
            color={colors.foreground}
          />
        ) : (
          <FlatList<Product>
            scrollEnabled={false}
            numColumns={2}
            data={products.data ?? []}
            keyExtractor={(p) => String(p.id)}
            columnWrapperStyle={{ gap: spacing.md }}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.xl,
              gap: spacing.md,
            }}
            renderItem={({ item }) => (
              <ProductCard product={item} onPress={openProduct} />
            )}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logo: {
    fontSize: 20,
    fontWeight: "900",
    color: colors.foreground,
  },
  searchBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchPlaceholder: { color: colors.muted, fontSize: 13 },
  heroList: { marginTop: spacing.md },
  heroCard: {
    width: 300,
    height: 150,
    marginLeft: spacing.lg,
    marginRight: spacing.sm,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  heroImage: { ...StyleSheet.absoluteFill, width: "100%", height: "100%", opacity: 0.55 },
  heroText: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  heroTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
  },
  heroSubtitle: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 4 },
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  sectionTitle: { fontSize: 18, fontWeight: "900", color: colors.foreground },
  typeChip: {
    width: 96,
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.md,
  },
  typeIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  typeName: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.foreground,
    textAlign: "center",
  },
  typeCount: { fontSize: 10, color: colors.muted },
});
