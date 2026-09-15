import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { landingApi } from "../api/content";
import { useCartStore } from "../stores/cart";
import { colors, fonts, layout, radii, shadow, spacing, text } from "../theme";

interface HeaderProps {
  onSearchSubmit?: (q: string) => void;
}

type MenuBadge = "cart" | "accent";

interface MenuItem {
  label: string;
  href: string;
  badge?: MenuBadge;
}

const MENU_ITEMS: MenuItem[] = [
  { label: "Inicio", href: "/" },
  { label: "Catálogo", href: "/catalog" },
  { label: "Mi carrito", href: "/cart", badge: "cart" },
  { label: "Pedidos", href: "/account", badge: "accent" },
  { label: "Notificaciones", href: "/account", badge: "accent" },
  { label: "Mi cuenta", href: "/account" },
];

/**
 * Header móvil (barra + panel de menú). La pantalla lo coloca fuera del
 * ScrollView para que quede fijo arriba.
 */
export function Header({ onSearchSubmit }: HeaderProps) {
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: general } = useQuery({
    queryKey: ["general"],
    queryFn: landingApi.getGeneral,
  });

  const count = useCartStore((s) =>
    s.items.reduce((acc, i) => acc + i.quantity, 0),
  );

  // Pulso del borde amarillo del carrito (solo cuando hay ítems).
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (count === 0) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.2,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [count, pulse]);

  const submitSearch = () => {
    if (onSearchSubmit) {
      onSearchSubmit(search);
      return;
    }
    router.push({ pathname: "/catalog", params: { search } });
  };

  const goTo = (href: string) => {
    setMenuOpen(false);
    router.push(href);
  };

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        {/* Hamburguesa */}
        <Pressable
          onPress={() => setMenuOpen((v) => !v)}
          style={styles.menuButton}
          hitSlop={8}
        >
          <Ionicons name="menu" size={20} color={colors.foreground} />
        </Pressable>

        {/* Búsqueda inline */}
        <View style={styles.searchBox}>
          <View style={styles.searchIcon} pointerEvents="none">
            <Ionicons name="search" size={16} color={colors.mutedForeground} />
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={submitSearch}
            returnKeyType="search"
            placeholder="Busca productos, marcas y categorías..."
            placeholderTextColor={colors.mutedForeground}
            style={styles.searchInput}
          />
          {search.length > 0 && (
            <Pressable
              onPress={() => setSearch("")}
              style={styles.searchClear}
              hitSlop={8}
            >
              <Ionicons name="close" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        {/* Carrito */}
        <View style={styles.cartWrap}>
          {count > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[styles.cartRing, { opacity: pulse }]}
            />
          )}
          <Pressable
            onPress={() => router.push("/cart")}
            style={styles.cartButton}
          >
            <Ionicons name="cart-outline" size={20} color={colors.foreground} />
            {count > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>{count}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Logo */}
        {general?.url ? (
          <Image
            source={{ uri: general.url }}
            style={styles.logo}
            resizeMode="contain"
          />
        ) : (
          <Text style={styles.logoText}>Mercaldas</Text>
        )}
      </View>

      {/* Menú móvil */}
      {menuOpen && (
        <>
          <Pressable
            style={styles.overlay}
            onPress={() => setMenuOpen(false)}
          />
          <View style={styles.panel}>
            {MENU_ITEMS.map((item, index) => {
              const isLast = index === MENU_ITEMS.length - 1;
              return (
                <Pressable
                  key={item.label}
                  onPress={() => goTo(item.href)}
                  style={[styles.menuItem, isLast && styles.menuItemLast]}
                >
                  <Text style={styles.menuItemLabel}>{item.label}</Text>
                  {item.badge === "cart" && count > 0 && (
                    <View style={styles.menuBadgePrimary}>
                      <Text style={styles.menuBadgePrimaryText}>{count}</Text>
                    </View>
                  )}
                  {item.badge === "accent" && (
                    <View style={styles.menuBadgeAccent}>
                      <Text style={styles.menuBadgeAccentText}>•</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "relative",
  },
  bar: {
    height: layout.headerHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuButton: {
    padding: spacing.sm,
    borderRadius: radii.lg,
  },
  searchBox: {
    flex: 1,
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(244, 244, 246, 0.6)",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    paddingVertical: 10,
    paddingLeft: 40,
    paddingRight: 40,
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
  searchInput: {
    flex: 1,
    fontSize: text.sm,
    color: colors.foreground,
    fontFamily: fonts.sans,
    padding: 0,
  },
  cartWrap: {
    position: "relative",
  },
  cartRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radii.lg,
  },
  cartButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
  },
  cartBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  cartBadgeText: {
    color: colors.primaryForeground,
    fontSize: text.xs,
    fontWeight: "700",
  },
  logo: {
    height: 20,
    width: 90,
  },
  logoText: {
    fontFamily: fonts.displayBlack,
    fontSize: text.xl,
    color: colors.foreground,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    zIndex: 1,
  },
  panel: {
    position: "absolute",
    top: layout.headerHeight,
    left: 0,
    right: 0,
    width: "100%",
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    borderBottomLeftRadius: radii.twoXl,
    borderBottomRightRadius: radii.twoXl,
    ...shadow.xl,
    maxHeight: "80%",
    zIndex: 2,
    elevation: 2,
  },
  menuItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuItemLabel: {
    fontSize: text.sm,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  menuBadgePrimary: {
    width: 20,
    height: 20,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  menuBadgePrimaryText: {
    color: colors.primaryForeground,
    fontSize: 11,
    fontWeight: "700",
  },
  menuBadgeAccent: {
    width: 20,
    height: 20,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  menuBadgeAccentText: {
    color: colors.accentForeground,
    fontSize: 11,
    fontWeight: "700",
  },
});
