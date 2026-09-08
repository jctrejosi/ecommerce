import { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";

interface ScreenProps {
  title?: string;
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}

/** Contenedor base de pantalla: SafeArea + título opcional + scroll opcional. */
export function Screen({ title, children, scroll = true, padded = true }: ScreenProps) {
  const content = (
    <View style={[styles.body, padded && styles.padded]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll}>{content}</ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1 },
  body: { flex: 1 },
  padded: { padding: spacing(4) },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing(3),
  },
});
