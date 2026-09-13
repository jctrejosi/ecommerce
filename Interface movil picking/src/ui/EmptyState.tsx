import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "@/theme";

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function EmptyState({ title, message, icon = "cube-outline" }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconBox}>
        <Ionicons name={icon} size={34} color={colors.textFaint} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", paddingVertical: spacing(16), paddingHorizontal: spacing(6) },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.chip,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing(5),
  },
  title: { color: colors.textMuted, fontSize: 16, fontWeight: "700", textAlign: "center" },
  message: { color: colors.textHint, fontSize: 13, fontWeight: "500", marginTop: spacing(1), textAlign: "center" },
});
