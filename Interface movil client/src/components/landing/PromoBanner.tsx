import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "../../theme";

const DEFAULT_ITEMS = [
  "Domicilio en 2 horas",
  "Pago 100% seguro",
  "Atención Lun–Dom 6am–10pm",
];

const ICONS = [
  "cube",
  "shield-checkmark",
  "time",
  "swap-horizontal",
] as const;

export function PromoBanner({ items }: { items?: string[] }) {
  const list = items && items.length > 0 ? items : DEFAULT_ITEMS;

  return (
    <View style={styles.section}>
      <View style={styles.content}>
        {list.map((label, i) => (
          <View key={`${label}-${i}`} style={styles.item}>
            <Ionicons
              name={ICONS[i % ICONS.length]}
              size={16}
              color={colors.primaryForeground}
            />
            <Text style={styles.itemText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
  },
  content: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  itemText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
});
