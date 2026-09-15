import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import { Ionicons } from "@expo/vector-icons";

export type ButtonVariant = "primary" | "secondary" | "danger" | "dark";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  fullWidth?: boolean;
}

const variantStyles: Record<
  ButtonVariant,
  { bg: string; fg: string; pressedBg: string }
> = {
  primary: { bg: colors.primary, fg: "#fff", pressedBg: colors.primaryDark },
  secondary: { bg: "#fff", fg: colors.text, pressedBg: "#F1F5F9" },
  danger: { bg: colors.dangerBg, fg: colors.danger, pressedBg: "#FEE2E2" },
  dark: { bg: colors.dark, fg: "#fff", pressedBg: "#1E293B" },
};

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
  fullWidth = true,
}: ButtonProps) {
  const v = variantStyles[variant];
  const blocked = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: blocked ? "#CBD5E1" : pressed ? v.pressedBg : v.bg },
        variant === "secondary" && styles.outline,
        fullWidth && styles.fullWidth,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Ionicons name={icon} size={18} color={v.fg} />}
          <Text
            numberOfLines={1}
            style={[
              styles.label,
              { color: variant === "secondary" ? colors.text : v.fg },
            ]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing(4),
  },
  fullWidth: { width: "100%" },
  outline: { borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  label: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
});
