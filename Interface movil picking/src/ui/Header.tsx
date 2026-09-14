import { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/theme";

interface HeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  /** Muestra el logo de la tienda a la izquierda (cabecera principal). */
  logo?: boolean;
}

export function Header({ title, subtitle, onBack, right, logo = false }: HeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: spacing(3) + insets.top }]}>
      <View style={styles.left}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={8}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
        ) : logo ? (
          <View style={styles.logoBlock}>
            <Image
              source={require("../../assets/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            {/* Título debajo del logo, al ancho del logo y en letra pequeña */}
            <Text style={styles.logoTitle} numberOfLines={1}>
              {title}
            </Text>
          </View>
        ) : null}
        {!logo && (
          <View style={styles.titles}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        )}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing(3),
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  left: { flexDirection: "row", alignItems: "center", gap: spacing(3), flexShrink: 1 },
  titles: { flexShrink: 1 },
  right: { flexDirection: "row", alignItems: "center", gap: spacing(2) },
  logo: { height: 30, width: 92 },
  logoBlock: { alignItems: "center", width: 92 },
  logoTitle: {
    width: 92,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 2,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  title: { color: colors.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { color: colors.textFaint, fontSize: 12, fontWeight: "500", marginTop: 1 },
});
