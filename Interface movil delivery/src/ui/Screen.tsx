import { ReactNode, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useKeyboardHeight } from "@/lib/keyboard";
import { colors, spacing } from "@/theme";
import { HeaderLogo } from "./HeaderLogo";

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
          <View style={styles.brand}>
            <Image
              source={require("../../assets/delivery.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.brandText}>Delivery</Text>
          </View>
          <AutoFitTitle text={title} baseSize={titleSize} />
          <View style={styles.headerRight}>
            {headerRight ?? (
              /* Logo DSI al lado del título; si hay acción (p. ej. chat), manda la acción */
              <HeaderLogo width={62} />
            )}
          </View>
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

/**
 * Título de cabecera que se encoge lo justo para caber en una línea.
 *
 * En Android `adjustsFontSizeToFit`/`minimumFontScale` son solo iOS, así que
 * medimos el texto a su tamaño base (fuera del flujo, invisible) y calculamos el
 * tamaño final proporcional al ancho disponible. Evita que se corte el código
 * largo de un pedido sin dejarlo ilegible.
 */
function AutoFitTitle({ text, baseSize }: { text: string; baseSize: number }) {
  const [boxWidth, setBoxWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const minSize = 11;

  // Margen de seguridad: `letterSpacing` no escala con el tamaño de fuente.
  const ratio = boxWidth > 0 && textWidth > 0 ? (boxWidth * 0.98) / textWidth : 1;
  const fontSize = Math.max(minSize, Math.min(baseSize, baseSize * ratio));

  return (
    <View style={styles.titleBox} onLayout={(e) => setBoxWidth(e.nativeEvent.layout.width)}>
      {/* Solo sirve para medir el ancho natural del texto a `baseSize`. */}
      <Text
        style={[styles.title, styles.measure, { fontSize: baseSize }]}
        numberOfLines={1}
        onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)}
      >
        {text}
      </Text>
      <Text style={[styles.title, { fontSize }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
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
  brand: { width: 62, alignItems: "center", justifyContent: "center" },
  brandText: {
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.3,
    marginTop: 1,
    color: colors.textMuted,
  },
  logo: { height: 34, width: 34 },
  headerRight: {
    width: 62,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  titleBox: { flex: 1 },
  measure: { position: "absolute", opacity: 0 },
  title: {
    textAlign: "center",
    textTransform: "uppercase",
    fontWeight: "800",
    letterSpacing: 0.5,
    color: colors.text,
  },
});
