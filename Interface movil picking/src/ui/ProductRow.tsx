import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/theme";
import { isItemDone } from "@/picking/status";
import { ProductImage } from "./ProductImage";
import type { PickingItem } from "@/api";

interface ProductRowProps {
  item: PickingItem;
  onPress?: () => void;
}

export function ProductRow({ item, onPress }: ProductRowProps) {
  const done = isItemDone(item);
  const hasLocation = !!item.shelfCode;

  return (
    <Pressable
      onPress={done ? undefined : onPress}
      disabled={done || !onPress}
      style={({ pressed }) => [
        styles.row,
        done && styles.rowDone,
        pressed && !done && styles.pressed,
      ]}
    >
      <ProductImage uri={item.image} seed={item.sku ?? item.name} size={48} />
      <View style={styles.info}>
        <Text style={[styles.name, done && styles.nameDone]} numberOfLines={2}>
          {item.name}
        </Text>

        <View style={styles.chips}>
          <View style={[styles.locChip, hasLocation ? styles.locOk : styles.locMissing]}>
            <Text style={[styles.locText, { color: hasLocation ? colors.successText : colors.accent }]}>
              {hasLocation
                ? `${item.shelfCode}${item.rowNumber ? ` · Fila ${item.rowNumber}` : ""}`
                : "Sin ubicación"}
            </Text>
          </View>
          {item.plu ? (
            <View style={styles.plu}>
              <Text style={styles.pluText}>PLU {item.plu}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.meta} numberOfLines={1}>
          {item.sku ? `SKU ${item.sku}` : "Sin SKU"}
          {item.barcode ? ` · ${item.barcode}` : ""}
        </Text>
      </View>

      <View style={styles.right}>
        {done ? (
          <View style={styles.check}>
            <Ionicons name="checkmark" size={15} color="#04120A" />
          </View>
        ) : (
          <View style={styles.empty} />
        )}
        <Text style={[styles.qty, done && { color: colors.successText }]}>
          {item.pickedQty}/{item.quantity}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing(3),
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing(3),
    marginBottom: spacing(2),
  },
  rowDone: {
    backgroundColor: "rgba(34,197,94,0.10)",
    borderColor: "rgba(34,197,94,0.30)",
  },
  pressed: { opacity: 0.8 },
  info: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  nameDone: { color: colors.textFaint, textDecorationLine: "line-through" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing(2), marginTop: spacing(2) },
  locChip: { borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: spacing(2), paddingVertical: 2 },
  locOk: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.25)" },
  locMissing: { backgroundColor: "rgba(251,191,36,0.10)", borderColor: "rgba(251,191,36,0.20)" },
  locText: { fontSize: 11, fontWeight: "700" },
  plu: {
    backgroundColor: "rgba(139,92,246,0.20)",
    borderColor: "rgba(139,92,246,0.30)",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(2),
    paddingVertical: 2,
  },
  pluText: { color: "#C4B5FD", fontSize: 10, fontWeight: "700" },
  meta: { color: colors.textHint, fontSize: 11, fontWeight: "500", marginTop: spacing(2) },
  right: { alignItems: "flex-end", gap: spacing(2) },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  qty: { color: colors.textMuted, fontSize: 13, fontWeight: "800" },
});
