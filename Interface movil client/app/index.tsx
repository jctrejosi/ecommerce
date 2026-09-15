import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  StyleSheet,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveServer, watchNetworkPrefix } from "../src/server";
import { ServerSetup } from "../src/components/ServerSetup";

/**
 * App cliente como WebView embebido de la interface web del cliente.
 * Todo el contenido (home, catálogo, carrito, checkout, cuenta, etc.) lo
 * renderiza la web; la app solo provee el contenedor y descubre en la red local
 * el servidor que sirve esa web.
 */
type Status = "searching" | "ready" | "notfound";

/** Reintentos automáticos tras un error del documento principal. */
const MAX_AUTO_RETRIES = 2;

export default function WebClientScreen() {
  const webViewRef = useRef<WebView>(null);
  // El APK es edge-to-edge (targetSdk 36), así que el WebView se dibujaría por
  // debajo del status bar (hora, batería…) y taparía el buscador del header.
  // Se reserva el alto del status bar; el fondo blanco empalma con el header
  // (`sticky top-0 bg-white`) de la web del cliente.
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>("searching");
  const [url, setUrl] = useState<string | null>(null);
  const [tried, setTried] = useState<string[]>([]);
  const [webKey, setWebKey] = useState(0);

  const resolvingRef = useRef(false);
  const autoRetriesRef = useRef(0);

  /** Resuelve el servidor y actualiza la máquina de estados. */
  const resolve = useCallback(async () => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setStatus("searching");
    try {
      const res = await resolveServer();
      setTried(res.tried);
      if (res.url) {
        setUrl(res.url);
        setWebKey((k) => k + 1);
        setStatus("ready");
      } else {
        setUrl(null);
        setStatus("notfound");
      }
    } finally {
      resolvingRef.current = false;
    }
  }, []);

  /** La pantalla de configuración encontró un servidor utilizable. */
  const handleResolved = useCallback((nextUrl: string) => {
    autoRetriesRef.current = 0;
    setUrl(nextUrl);
    setWebKey((k) => k + 1);
    setStatus("ready");
  }, []);

  // Descubrimiento al montar y cuando cambia la red local.
  useEffect(() => {
    void resolve();
  }, [resolve]);

  useEffect(() => watchNetworkPrefix(() => void resolve()), [resolve]);

  // Si el documento principal no carga, se vuelve a buscar (con tope).
  const handleWebError = useCallback(() => {
    if (autoRetriesRef.current >= MAX_AUTO_RETRIES) {
      setUrl(null);
      setStatus("notfound");
      return;
    }
    autoRetriesRef.current += 1;
    void resolve();
  }, [resolve]);

  // Botón físico de Android: vuelve dentro del WebView si hay historial.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (webViewRef.current?.goBack) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      {status === "searching" ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1A1A2E" />
        </View>
      ) : status === "ready" && url ? (
        <WebView
          key={webKey}
          ref={webViewRef}
          source={{ uri: url }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          startInLoadingState
          onError={handleWebError}
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color="#1A1A2E" />
            </View>
          )}
          style={styles.webview}
        />
      ) : (
        <ServerSetup tried={tried} onResolved={handleResolved} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  webview: { flex: 1 },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    ...StyleSheet.absoluteFill,
  },
});
