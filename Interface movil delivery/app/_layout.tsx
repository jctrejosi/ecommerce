import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Image, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/lib/queryClient";
import { useAuthStore } from "@/auth/authStore";
import { getTokens } from "@/auth/storage";
import { configureNotifications, registerPushToken, setNotificationTapHandler, watchPushTokenRefresh } from "@/notifications/push";
import { configureMessageSound } from "@/notifications/sound";
import { useIncomingMessageSound } from "@/notifications/useIncomingMessageSound";
import {
  acknowledgeNewOrderAlerts,
  useNewOrderAlert,
} from "@/notifications/newOrderAlert";
import { connectDeliverySocket, disconnectDeliverySocket } from "@/socket";
import { useActiveOrders } from "@/api/orders";
import { startBackgroundTracking, stopBackgroundTracking } from "@/tracking/location";
import { startPresenceHeartbeat, stopPresenceHeartbeat } from "@/tracking/presence";
import { USE_MOCK } from "@/api";
import { getServerUrl, resolveServer, watchNetworkPrefix } from "@/api/server";
import { colors, spacing } from "@/theme";

function RootShell() {
  const restore = useAuthStore((s) => s.restore);
  const user = useAuthStore((s) => s.user);
  const { data: orders } = useActiveOrders();

  // En entrega (recogido o en camino) el tracking en background debe seguir
  // aunque la app esté minimizada o cerrada (Waze abierto, pantalla apagada).
  const inProgressOrder = (orders ?? []).find(
    (o) => o.status === "PICKED_UP" || o.status === "IN_DELIVERY",
  );
  const delivering = user != null && inProgressOrder != null;

  // Tonos de mensaje entrante del cliente en el pedido en curso (el del panel
  // llega por socket, ver src/socket.ts). Suena aunque estés en otra pantalla.
  useIncomingMessageSound(user ? inProgressOrder?.id : undefined);

  // Red de seguridad del sondeo: avisa de un pedido nuevo aunque el socket no
  // haya entregado el evento `delivery:assigned`.
  useNewOrderAlert(orders);

  // Al volver la app a primer plano se entiende que el aviso ya se vio: se
  // quitan las notificaciones de la bandeja y el punto rojo del icono.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void acknowledgeNewOrderAlerts();
    });
    return () => subscription.remove();
  }, []);

  // Tocar la notificación de pedido nuevo abre ese pedido.
  useEffect(() => {
    let unsubscribe = () => {};
    void setNotificationTapHandler((orderId) => {
      try {
        router.push(`/order/${orderId}`);
      } catch {
        /* el navegador aún no está listo (app recién lanzada) */
      }
    }).then((fn) => {
      unsubscribe = fn;
    });
    return () => unsubscribe();
  }, []);

  // Restaurar sesión al arrancar (SecureStore → /auth/me).
  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    void configureNotifications();
    void configureMessageSound();
  }, []);

  useEffect(() => {
    if (delivering) {
      void startBackgroundTracking();
    } else {
      void stopBackgroundTracking();
    }
  }, [delivering]);

  // Socket en tiempo real + registro de token push cuando hay sesión.
  useEffect(() => {
    if (!user) {
      disconnectDeliverySocket();
      return;
    }
    void getTokens().then((tokens) => {
      if (tokens?.accessToken) connectDeliverySocket(tokens.accessToken);
    });

    let stopWatchingToken = () => {};
    if (!USE_MOCK) {
      void registerPushToken();
      // Si FCM rota el token, se vuelve a registrar sin reiniciar la app.
      void watchPushTokenRefresh().then((fn) => {
        stopWatchingToken = fn;
      });
    }
    return () => {
      disconnectDeliverySocket();
      stopWatchingToken();
    };
  }, [user]);

  // Presencia: avisa cada minuto que la app sigue viva aunque no haya entrega
  // activa, para que el panel de flota no lo muestre como "disponible" si lleva
  // horas sin dar señal.
  useEffect(() => {
    if (!user) {
      stopPresenceHeartbeat();
      return;
    }
    startPresenceHeartbeat();
    return () => stopPresenceHeartbeat();
  }, [user]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ServerGate />
        <StatusBar style="dark" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** Cada cuánto se vuelve a intentar si el backend aún no aparece. */
const RETRY_MS = 10_000;

/**
 * La app resuelve el backend **en segundo plano** (URL guardada → pista del
 * build → escaneo de la red local) y, mientras tanto, solo se ve
 * "Estableciendo conexión…": nada de pantallas de diagnóstico ni de
 * configuración manual. Si aún no aparece, se reintenta en silencio.
 */
function ServerGate() {
  const [ready, setReady] = useState(USE_MOCK);

  useEffect(() => {
    if (USE_MOCK) return;
    let cancelled = false;

    const run = async () => {
      for (;;) {
        const res = await resolveServer();
        if (cancelled) return;
        if (res.url) {
          setReady(true);
          return;
        }
        // Se espera antes de reintentar: el escaneo de la subred es costoso.
        await new Promise((r) => setTimeout(r, RETRY_MS));
        if (cancelled) return;
      }
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  // Si cambia la red local (otro Wi-Fi, otra subred) se vuelve a buscar el
  // servidor sin reiniciar la app. Si aparece en otra dirección, el cliente
  // HTTP la toma en la siguiente petición y el socket se reconecta.
  useEffect(() => {
    if (USE_MOCK) return;
    const unsubscribe = watchNetworkPrefix(() => {
      void (async () => {
        const previous = getServerUrl();
        const res = await resolveServer();
        if (!res.url) return; // sin servidor: sigue la búsqueda en segundo plano
        setReady(true);
        if (previous && res.url !== previous) {
          disconnectDeliverySocket();
          const tokens = await getTokens();
          if (tokens?.accessToken) connectDeliverySocket(tokens.accessToken);
        }
      })();
    });
    return unsubscribe;
  }, []);

  if (!ready) return <ConnectingScreen />;
  return <RootShell />;
}

/** Pantalla mínima mientras se establece la conexión con el backend. */
function ConnectingScreen() {
  return (
    <View style={styles.splash}>
      <Image
        source={require("../assets/delivery.png")}
        style={styles.logo}
        resizeMode="contain"
      />
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.splashTitle}>Estableciendo conexión…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(4),
    paddingHorizontal: spacing(8),
    backgroundColor: colors.background,
  },
  logo: { height: 72, width: 72 },
  splashTitle: { fontSize: 16, fontWeight: "800", color: colors.text },
});
