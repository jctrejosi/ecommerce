import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { catalogApi } from "../src/api/catalog";
import type { Product } from "../src/api/types";
import { ProductCard } from "../src/components/ProductCard";
import { colors, radius, spacing } from "../src/theme";

const PAGE = 24;

export default function CatalogScreen() {
  const params = useLocalSearchParams<{ productTypeCode?: string }>();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const productTypeCode =
    typeof params.productTypeCode === "string" ? params.productTypeCode : undefined;

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      try {
        const next = reset ? 0 : offset;
        const rows = await catalogApi.getProducts({
          search: query || undefined,
          productTypeCode,
          limit: PAGE,
          offset: next,
        });
        setProducts((prev) => (reset ? rows : [...prev, ...rows]));
        setOffset(next + rows.length);
        setHasMore(rows.length === PAGE);
      } catch {
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [query, productTypeCode, offset],
  );

  // Al cambiar filtros/búsqueda (debounce 400 ms) reinicia la lista.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
      setHasMore(true);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, productTypeCode]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </Pressable>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar productos, marcas…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      <FlatList<Product>
        key={productTypeCode || "all"}
        numColumns={2}
        data={products}
        keyExtractor={(p) => String(p.id)}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
        }}
        ListEmptyComponent={
          loading ? null : (
            <Text style={styles.empty}>No encontramos productos</Text>
          )
        }
        ListFooterComponent={
          loading ? (
            <ActivityIndicator
              style={{ marginVertical: 24 }}
              color={colors.foreground}
            />
          ) : null
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasMore && !loading) void load(false);
        }}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            onPress={(p) => router.push(`/product/${p.id}`)}
          />
        )}
      />
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
  back: { padding: 4 },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    paddingVertical: 9,
    fontSize: 14,
    color: colors.foreground,
  },
  empty: {
    textAlign: "center",
    color: colors.muted,
    marginTop: 48,
  },
});
