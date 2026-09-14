import { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}

/** Contenedor base de pantalla (tema oscuro + SafeArea). */
export function Screen({ children, scroll = true, padded = true }: ScreenProps) {
  const content = <View style={[styles.body, padded && styles.padded]}>{children}</View>;

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
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
});
