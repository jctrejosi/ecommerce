import { StyleSheet, Text, View } from "react-native";
import { STATUS_COLORS, STATUS_LABELS } from "@/delivery/state-machine";
import type { DeliveryStatus } from "@/api/types";

export function StatusBadge({ status }: { status: DeliveryStatus }) {
  const palette = STATUS_COLORS[status] ?? { bg: "#F1F5F9", fg: "#475569" };
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.text, { color: palette.fg }]}>
        {STATUS_LABELS[status] ?? status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  text: { fontSize: 12, fontWeight: "700" },
});
