import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { catalogApi } from "../../api/catalog";
import type { ProductType } from "../../api/types";
import {
  colors,
  duration,
  fonts,
  productTypeIcon,
  radii,
  shadow,
  spacing,
} from "../../theme";

const GAP = 16;

function ProductTypeItem({
  item,
  index,
  grid,
  onPress,
}: {
  item: ProductType;
  index: number;
  grid?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.item, grid && styles.itemGrid]} onPress={onPress}>
      <View style={styles.iconBox}>
        <Text style={styles.emoji}>{productTypeIcon(item.code, index)}</Text>
      </View>
      <Text style={styles.itemName} numberOfLines={2}>
        {item.name}
      </Text>
      <Text style={styles.itemCount}>{item.count} productos</Text>
    </Pressable>
  );
}

export function QuickCategoriesSection() {
  const { data } = useQuery({
    queryKey: ["landing-types"],
    queryFn: () => catalogApi.getLandingProductTypes(),
  });

  const types = data ?? [];

  const [modalVisible, setModalVisible] = useState(false);
  const [search, setSearch] = useState("");

  const scrollRef = useRef<ScrollView>(null);
  const xRef = useRef(0);
  const itemWidthRef = useRef(110);
  const contentWidthRef = useRef(0);
  const viewportWidthRef = useRef(0);
  const touchingRef = useRef(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return types;
    return types.filter((t) => t.name.toLowerCase().includes(q));
  }, [types, search]);

  const scrollBy = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const pitch = itemWidthRef.current + GAP;
    const max = Math.max(0, contentWidthRef.current - viewportWidthRef.current);
    let next: number;
    if (dir > 0 && xRef.current >= max - 4) next = 0;
    else if (dir < 0 && xRef.current <= 4) next = max;
    else next = Math.max(0, Math.min(max, xRef.current + dir * pitch));
    el.scrollTo({ x: next, animated: true });
  }, []);

  // Autoplay: avanza un ítem si hay desbordamiento y no se está tocando.
  useEffect(() => {
    if (!hasOverflow || types.length <= 1) return;
    const id = setInterval(() => {
      if (!touchingRef.current) scrollBy(1);
    }, duration.autoplayCategories);
    return () => clearInterval(id);
  }, [hasOverflow, types.length, scrollBy]);

  const openType = (code: string) => {
    router.push({ pathname: "/catalog", params: { productTypeCode: code } });
  };

  const closeModal = () => {
    setModalVisible(false);
    setSearch("");
  };

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>Nuestros productos</Text>
        <Pressable style={styles.viewAll} onPress={() => setModalVisible(true)}>
          <Text style={styles.viewAllText}>Ver todos</Text>
          <Ionicons
            name="chevron-forward"
            size={14}
            color={colors.mutedForeground}
          />
        </Pressable>
      </View>

      <View style={styles.carouselRow}>
        {hasOverflow && (
          <Pressable style={styles.arrow} onPress={() => scrollBy(-1)} hitSlop={6}>
            <Ionicons
              name="chevron-back"
              size={16}
              color={colors.foreground}
            />
          </Pressable>
        )}

        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onLayout={(e) => {
            viewportWidthRef.current = e.nativeEvent.layout.width;
          }}
          onContentSizeChange={(w) => {
            contentWidthRef.current = w;
            setHasOverflow(w > viewportWidthRef.current + 8);
          }}
          onScroll={(e) => {
            xRef.current = e.nativeEvent.contentOffset.x;
          }}
          scrollEventThrottle={16}
          onTouchStart={() => {
            touchingRef.current = true;
          }}
          onTouchEnd={() => {
            touchingRef.current = false;
          }}
          contentContainerStyle={styles.scrollContent}
        >
          {types.map((t, i) => (
            <ProductTypeItem
              key={t.id}
              item={t}
              index={i}
              onPress={() => openType(t.code)}
            />
          ))}
        </ScrollView>

        {hasOverflow && (
          <Pressable style={styles.arrow} onPress={() => scrollBy(1)} hitSlop={6}>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.foreground}
            />
          </Pressable>
        )}
      </View>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeModal} />
          <View style={styles.panel}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Todos los tipos de producto</Text>
              <Pressable style={styles.closeBtn} onPress={closeModal} hitSlop={8}>
                <Ionicons name="close" size={20} color={colors.foreground} />
              </Pressable>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons
                name="search"
                size={16}
                color={colors.mutedForeground}
                style={styles.searchIcon}
              />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar tipo de producto..."
                placeholderTextColor={colors.mutedForeground}
                style={styles.searchInput}
                autoFocus
              />
            </View>

            <FlatList<ProductType>
              data={filtered}
              numColumns={2}
              keyExtractor={(t) => String(t.id)}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={styles.gridContent}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index }) => (
                <ProductTypeItem
                  item={item}
                  index={index}
                  grid
                  onPress={() => {
                    openType(item.code);
                    closeModal();
                  }}
                />
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: spacing.twoXl,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.displayBlack,
    color: colors.foreground,
  },
  viewAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  viewAllText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    color: colors.mutedForeground,
  },
  carouselRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  arrow: {
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
  scrollContent: {
    gap: GAP,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  item: {
    minWidth: 90,
    padding: spacing.md,
    borderRadius: radii.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  itemGrid: {
    flex: 1,
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: radii.twoXl,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: {
    fontSize: 36,
  },
  itemName: {
    fontSize: 12,
    fontFamily: fonts.sansSemibold,
    color: colors.foreground,
    textAlign: "center",
    maxWidth: 90,
  },
  itemCount: {
    fontSize: 10,
    color: colors.mutedForeground,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "center",
  },
  panel: {
    backgroundColor: colors.white,
    borderRadius: radii.twoXl,
    maxHeight: "70%",
    marginHorizontal: spacing.lg,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    paddingBottom: 0,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.foreground,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    position: "relative",
    margin: spacing.lg,
    marginBottom: spacing.md,
  },
  searchIcon: {
    position: "absolute",
    left: 12,
    top: "50%",
    marginTop: -8,
  },
  searchInput: {
    paddingLeft: 36,
    paddingRight: 12,
    paddingVertical: 8,
    fontSize: 14,
    borderRadius: radii.xl,
    backgroundColor: "rgba(244, 244, 246, 0.5)",
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.foreground,
  },
  list: {
    flexShrink: 1,
  },
  gridContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  gridRow: {
    gap: spacing.md,
  },
});
