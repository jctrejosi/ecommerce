import { ReactNode } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
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
    <View style={[styles.body, padded && styles.padded]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {title ? (
        <View style={styles.headerBar}>
          <Image
            source={require("../../assets/logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {/* Espaciador del mismo ancho que el logo para centrar el título */}
          <View style={styles.logoSpacer} />
        </View>
      ) : null}
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
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(3),
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    backgroundColor: colors.background,
  },
  logo: { height: 26, width: 80 },
  logoSpacer: { width: 80 },
  title: {
    flex: 1,
    textAlign: "center",
    textTransform: "uppercase",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: colors.text,
  },
});
