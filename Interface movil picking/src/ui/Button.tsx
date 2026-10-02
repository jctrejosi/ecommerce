import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, radius, spacing, useTheme } from "@/theme";

export type ButtonVariant = "primary" | "secondary" | "success" | "danger" | "ghost";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  fullWidth?: boolean;
  compact?: boolean;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
  fullWidth = true,
  compact = false,
}: ButtonProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const variants: Record<ButtonVariant, { bg: string; fg: string; border?: string; pressed: string }> = {
    primary: { bg: colors.accent, fg: colors.onAccent, pressed: colors.accentDark },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.border, pressed: colors.surfaceAlt },
    success: { bg: colors.success, fg: "#04120A", pressed: "#16A34A" },
    danger: { bg: "rgba(239,68,68,0.15)", fg: colors.dangerText, border: "rgba(239,68,68,0.4)", pressed: "rgba(239,68,68,0.25)" },
    ghost: { bg: "transparent", fg: colors.textMuted, pressed: colors.chip },
  };
  const v = variants[variant];
  const blocked = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        {
          backgroundColor: blocked ? "#3A3A3D" : pressed ? v.pressed : v.bg,
          borderColor: v.border ?? "transparent",
          borderWidth: v.border ? 1 : 0,
        },
        fullWidth && styles.fullWidth,
        blocked && styles.blocked,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={18} color={blocked ? colors.textHint : v.fg} /> : null}
          <Text style={[styles.label, { color: blocked ? colors.textHint : v.fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing(4),
  },
  compact: { minHeight: 40, paddingHorizontal: spacing(3) },
  fullWidth: { width: "100%" },
  blocked: { opacity: 0.7 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 15, fontWeight: "700" },
}));
