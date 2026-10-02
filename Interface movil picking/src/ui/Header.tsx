import { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, radius, spacing, useTheme } from "@/theme";

interface HeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  /** Muestra el logo de la tienda a la izquierda (cabecera principal). */
  logo?: boolean;
}

export function Header({ title, subtitle, onBack, right, logo = false }: HeaderProps) {
  const styles = useStyles();
  const { colors } = useTheme();
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
            {/* Ícono arriba y el título debajo, centrados entre sí. */}
            <Image
              source={require("../../assets/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
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

const useStyles = makeStyles((colors) => StyleSheet.create({
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
  // El logo DSI es apaisado (213x69): a 92 de ancho mide ~30 de alto.
  logo: { width: 92, height: 30 },
  logoBlock: { alignItems: "center" },
  logoTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
    textAlign: "center",
    marginTop: 3,
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
}));
