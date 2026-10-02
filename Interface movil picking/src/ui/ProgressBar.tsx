import { StyleSheet, View } from "react-native";
import { makeStyles, useTheme } from "@/theme";

/** Barra de progreso ámbar (0..1). */
export function ProgressBar({ value }: { value: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.track}>
      <View style={{ flex: pct, backgroundColor: colors.accent }} />
      <View style={{ flex: 1 - pct }} />
    </View>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  track: {
    flexDirection: "row",
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.chip,
    overflow: "hidden",
  },
}));
