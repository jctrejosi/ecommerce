import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/theme";

interface ErrorBoxProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorBox({ message, onRetry }: ErrorBoxProps) {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8} style={({ pressed }) => pressed && { opacity: 0.7 }}>
          <Text style={styles.retry}>Reintentar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(3),
    backgroundColor: "rgba(239,68,68,0.10)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.30)",
    borderRadius: radius.lg,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
  },
  text: { flex: 1, color: colors.dangerText, fontSize: 13, fontWeight: "600" },
  retry: { color: colors.dangerText, fontSize: 13, fontWeight: "800", textDecorationLine: "underline" },
});
