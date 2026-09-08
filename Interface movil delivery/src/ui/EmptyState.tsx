import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "@/theme";

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}

export function EmptyState({ icon = "cube-outline", title, subtitle }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Ionicons name={icon} size={44} color={colors.textFaint} />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(2),
    paddingVertical: spacing(10),
    paddingHorizontal: spacing(4),
  },
  title: { fontSize: 16, fontWeight: "700", color: colors.textMuted },
  subtitle: {
    fontSize: 13,
    color: colors.textFaint,
    textAlign: "center",
    maxWidth: 260,
  },
});
