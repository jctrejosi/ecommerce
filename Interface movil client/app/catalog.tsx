import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { catalogApi } from "../src/api/catalog";
import type { Product, ProductType } from "../src/api/types";
import { ProductCard } from "../src/components/ProductCard";
import { colors, fonts, radii, spacing, text } from "../src/theme";

const PAGE = 24;

const SORT_OPTIONS = [
  { id: "relevancia", label: "Relevancia" },
  { id: "precio-asc", label: "Precio: menor a mayor" },
  { id: "precio-desc", label: "Precio: mayor a menor" },
  { id: "descuento", label: "Mayor descuento" },
  { id: "nombre", label: "Nombre A–Z" },
];

export default function CatalogScreen() {
  const params = useLocalSearchParams<{
    productTypeCode?: string;
    search?: string;
  }>();
  const [search, setSearch] = useState(() =>
    typeof params.search === "string" ? params.search : "",
  );
  const [query, setQuery] = useState(() =>
    typeof params.search === "string" ? params.search : "",
  );
  const [sort, setSort] = useState("relevancia");
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const productTypeCode =
    typeof params.productTypeCode === "string" ? params.productTypeCode : undefined;

  const productTypeName = productTypeCode
    ? productTypes.find((pt) => pt.code === productTypeCode)?.name ??
      productTypeCode
    : undefined;

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      try {
        const next = reset ? 0 : offset;
        const rows = await catalogApi.getProducts({
          search: query || undefined,
          productTypeCode,
          sort,
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
    [query, productTypeCode, sort, offset],
  );

  // Nombres de tipos de producto para el chip de categoría activo.
  useEffect(() => {
    let active = true;
    catalogApi
      .getProductTypes()
      .then((rows) => {
        if (active) setProductTypes(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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
  }, [query, productTypeCode, sort]);

  const clearProductType = () => {
    router.setParams({ productTypeCode: undefined });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </Pressable>
        <View style={styles.searchBox}>
          <View style={styles.searchIcon} pointerEvents="none">
            <Ionicons name="search" size={16} color={colors.mutedForeground} />
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar en catálogo…"
            placeholderTextColor={colors.mutedForeground}
            style={styles.input}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable
              onPress={() => setSearch("")}
              style={styles.searchClear}
              hitSlop={8}
            >
              <Ionicons name="close" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsContent}
      >
        {productTypeCode && (
          <Pressable
            onPress={clearProductType}
            style={[styles.chip, styles.chipActive]}
          >
            <Text style={[styles.chipText, styles.chipTextActive]}>
              {productTypeName ?? productTypeCode}
            </Text>
            <Ionicons name="close" size={12} color={colors.foreground} />
          </Pressable>
        )}

        {SORT_OPTIONS.map((option) => {
          const active = sort === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => setSort(option.id)}
              style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
            >
              <Text
                style={[
                  styles.chipText,
                  active ? styles.chipTextActive : styles.chipTextInactive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

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
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { padding: spacing.xs },
  searchBox: {
    flex: 1,
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    paddingVertical: 10,
    paddingLeft: 36,
    paddingRight: 36,
  },
  searchIcon: {
    position: "absolute",
    left: spacing.md,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  searchClear: {
    position: "absolute",
    right: spacing.md,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  input: {
    flex: 1,
    fontSize: text.sm,
    color: colors.foreground,
    fontFamily: fonts.sans,
    padding: 0,
  },
  chipsContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radii.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipInactive: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  chipText: {
    fontSize: text.xs,
    fontFamily: fonts.sansSemibold,
  },
  chipTextActive: { color: colors.foreground },
  chipTextInactive: { color: colors.mutedForeground },
  empty: {
    textAlign: "center",
    color: colors.mutedForeground,
    fontFamily: fonts.sans,
    fontSize: text.sm,
    marginTop: 48,
  },
});
