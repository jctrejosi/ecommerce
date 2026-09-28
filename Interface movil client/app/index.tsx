import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { resolveServer, watchNetworkPrefix } from "../src/server";

// La notificación se muestra aunque la app esté abierta en primer plano.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Prepara el push: crea el canal de alta prioridad (para que la notificación
 * salga como aviso y en la pantalla de bloqueo), pide el permiso y devuelve el
 * token FCM del dispositivo. El token NO depende del permiso: si no hay permiso,
 * se obtiene igual y la notificación se mostrará cuando el usuario lo conceda.
 */
async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log("[push] no es un dispositivo físico");
    return null;
  }
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("mercaldas", {
        name: "Mercaldas",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    let status = (await Notifications.getPermissionsAsync()).status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    console.log("[push] permiso:", status);

    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === "string" ? token.data : null;
  } catch (e) {
    console.log(
      "[push] error token:",
      String((e as { message?: string })?.message ?? e),
    );
    return null;
  }
}

/**
 * App cliente como WebView embebido de la interface web del cliente.
 * Todo el contenido (home, catálogo, carrito, checkout, cuenta, etc.) lo
 * renderiza la web; la app solo provee el contenedor y **busca sola** el
 * servidor en la red local (sin pantallas de configuración manual).
 */
type Status = "searching" | "ready";

/** Cada cuánto se reintenta la búsqueda mientras no aparezca el servidor. */
const RETRY_MS = 4000;
/** Espera antes de volver a resolver si el documento principal falla. */
const WEB_ERROR_RETRY_MS = 2500;

export default function WebClientScreen() {
  const webViewRef = useRef<WebView>(null);
  // El APK es edge-to-edge (targetSdk 36), así que el WebView se dibujaría por
  // debajo del status bar (hora, batería…) y taparía el buscador del header.
  // Se reserva el alto del status bar; el fondo blanco empalma con el header
  // (`sticky top-0 bg-white`) de la web del cliente.
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>("searching");
  const [url, setUrl] = useState<string | null>(null);
  const [webKey, setWebKey] = useState(0);

  const resolvingRef = useRef(false);

  /** Busca el servidor y actualiza el estado. Se puede llamar repetidamente. */
  const resolve = useCallback(async () => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      const res = await resolveServer();
      if (res.url) {
        setUrl((prev) => (prev === res.url ? prev : res.url));
        setWebKey((k) => k + 1);
        setStatus("ready");
      } else {
        setUrl(null);
        setStatus("searching");
      }
    } finally {
      resolvingRef.current = false;
    }
  }, []);

  // Búsqueda al arrancar y cuando cambia la red local.
  useEffect(() => {
    void resolve();
  }, [resolve]);

  useEffect(() => watchNetworkPrefix(() => void resolve()), [resolve]);

  // Mientras no haya servidor, se sigue buscando solo, en background.
  useEffect(() => {
    if (status === "ready") return;
    const id = setInterval(() => {
      void resolve();
    }, RETRY_MS);
    return () => clearInterval(id);
  }, [status, resolve]);

  // Si el documento principal no carga, se reintenta la búsqueda automáticamente.
  const handleWebError = useCallback(() => {
    setTimeout(() => {
      void resolve();
    }, WEB_ERROR_RETRY_MS);
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

  // Push: se obtiene el token FCM y se entrega al WebView. La web lo registra en
  // el backend cuando hay sesión de cliente (ver `__mercaldasSetPushToken`);
  // además se deja en `window.__mercaldasPushToken` para el caso de que la
  // sesión se inicie después.
  const pushTokenRef = useRef<string | null>(null);

  /**
   * Pide el token FCM (si aún no lo tiene) y lo entrega al WebView. Se llama al
   * arrancar, al terminar de cargar la página y cuando la web lo pide (tras
   * iniciar sesión), para no depender del orden de los eventos.
   */
  const sendTokenToWeb = useCallback(async () => {
    if (!pushTokenRef.current) {
      pushTokenRef.current = await getPushToken();
      console.log(
        "[push] token FCM:",
        pushTokenRef.current ? `${pushTokenRef.current.slice(0, 14)}…` : "null",
      );
    }
    const token = pushTokenRef.current;
    if (!token) return;
    webViewRef.current?.injectJavaScript(
      `(function(){try{window.__mercaldasPushToken=${JSON.stringify(
        token,
      )};if(typeof window.__mercaldasSetPushToken==='function'){window.__mercaldasSetPushToken(window.__mercaldasPushToken);}}catch(e){}true;})();`,
    );
  }, []);

  useEffect(() => {
    void sendTokenToWeb();
  }, [sendTokenToWeb]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      {status === "ready" && url ? (
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
          // El login con Google redirige a `http://localhost:4173` (el
          // redirect_uri registrado en Google). En el celular no hay nada
          // escuchando ahí, así que se intercepta y se carga esa misma ruta en
          // el origen real de la app, para que la web procese el `code`.
          onShouldStartLoadWithRequest={(request) => {
            const target = request.url;
            if (/^https?:\/\/localhost:4173(\/|$|\?)/i.test(target) && url) {
              try {
                const parsed = new URL(target);
                const appUrl = `${url.replace(/\/+$/, "")}${parsed.pathname}${parsed.search}${parsed.hash}`;
                webViewRef.current?.injectJavaScript(
                  `window.location.replace(${JSON.stringify(appUrl)}); true;`,
                );
              } catch {
                /* URL inesperada: se ignora */
              }
              return false;
            }
            return true;
          }}
          allowsBackForwardNavigationGestures
          startInLoadingState
          onError={handleWebError}
          onLoadEnd={() => void sendTokenToWeb()}
          onMessage={(event) => {
            // La web pide el token push cuando el cliente inicia sesión.
            try {
              const msg = JSON.parse(event.nativeEvent.data);
              if (msg?.type === "request-push-token") {
                void sendTokenToWeb();
              }
            } catch {
              /* mensajes que no son JSON */
            }
          }}
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color="#1A1A2E" />
            </View>
          )}
          style={styles.webview}
        />
      ) : (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#1A1A2E" />
        </View>
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
