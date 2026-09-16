import { ReactNode } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useKeyboardHeight } from "@/lib/keyboard";
import { colors, spacing } from "@/theme";

interface ScreenProps {
  title?: string;
  /**
   * Tamaño del título de la cabecera (por defecto 20). Útil cuando el título es
   * largo, como el código de un pedido.
   */
  titleSize?: number;
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /**
   * Respeta el borde inferior seguro (barra de navegación flotante).
   * Úsalo en pantallas cuyo contenido llega hasta abajo (chat, detalle…).
   */
  bottomInset?: boolean;
  /**
   * Acción a la derecha del título (p. ej. el botón de chat). Ocupa el mismo
   * ancho que el logo para que el título siga centrado.
   */
  headerRight?: ReactNode;
  /**
   * Aparta el contenido cuando aparece el teclado. Necesario en Android con
   * edge-to-edge, donde el sistema ya no redimensiona la ventana (`adjustResize`
   * se ignora): sin esto, la barra de escribir de un chat queda tapada.
   */
  keyboardAware?: boolean;
}

/** Contenedor base de pantalla: SafeArea + título opcional + scroll opcional. */
export function Screen({
  title,
  titleSize = 20,
  children,
  scroll = true,
  padded = true,
  bottomInset = false,
  headerRight,
  keyboardAware = false,
}: ScreenProps) {
  const keyboardHeight = useKeyboardHeight();
  const keyboardOpen = keyboardAware && keyboardHeight > 0;

  const content = (
    <View
      style={[
        styles.body,
        padded && styles.padded,
        keyboardOpen && {
          paddingBottom: (padded ? spacing(4) : 0) + keyboardHeight,
        },
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView
      style={styles.safe}
      edges={
        bottomInset && !keyboardOpen
          ? ["top", "left", "right", "bottom"]
          : ["top", "left", "right"]
      }
    >
      {title ? (
        <View style={styles.headerBar}>
          <Image
            source={require("../../assets/delivery.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={[styles.title, { fontSize: titleSize }]} numberOfLines={1}>
            {title}
          </Text>
          {headerRight ? (
            <View style={styles.headerRight}>{headerRight}</View>
          ) : (
            /* Espaciador del mismo ancho que el logo para centrar el título */
            <View style={styles.logoSpacer} />
          )}
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
  logo: { height: 40, width: 40 },
  logoSpacer: { width: 40 },
  headerRight: {
    width: 40,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    textAlign: "center",
    textTransform: "uppercase",
    fontWeight: "800",
    letterSpacing: 0.5,
    color: colors.text,
  },
});
