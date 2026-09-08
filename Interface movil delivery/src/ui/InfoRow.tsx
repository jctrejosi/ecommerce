import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/theme";

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing(3),
    paddingVertical: spacing(2),
  },
  label: { fontSize: 14, color: colors.textFaint, fontWeight: "500" },
  value: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "right",
  },
});
