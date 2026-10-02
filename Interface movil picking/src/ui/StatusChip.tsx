import { StyleSheet, Text, View } from "react-native";
import { makeStyles, radius, spacing, useTheme } from "@/theme";
import type { OrderStatus } from "@/api";

export function StatusChip({ status }: { status: OrderStatus }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const map: Record<OrderStatus, { label: string; fg: string; bg: string; border: string }> = {
    nuevo: {
      label: "Nuevo",
      fg: colors.accent,
      bg: "rgba(251,191,36,0.20)",
      border: "rgba(251,191,36,0.30)",
    },
    preparando: {
      label: "Preparando",
      fg: colors.infoText,
      bg: "rgba(59,130,246,0.20)",
      border: "rgba(59,130,246,0.30)",
    },
    completado: {
      label: "Completado",
      fg: colors.successText,
      bg: "rgba(34,197,94,0.20)",
      border: "rgba(34,197,94,0.30)",
    },
  };
  const s = map[status];
  return (
    <View style={[styles.chip, { backgroundColor: s.bg, borderColor: s.border }]}>
      <Text style={[styles.label, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  chip: {
    paddingHorizontal: spacing(2),
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  label: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
}));
