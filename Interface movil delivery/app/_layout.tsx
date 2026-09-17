import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Image, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/lib/queryClient";
import { useAuthStore } from "@/auth/authStore";
import { getTokens } from "@/auth/storage";
import { configureNotifications, registerPushToken, setNotificationTapHandler } from "@/notifications/push";
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
import { ServerSetup } from "@/ui/ServerSetup";
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
    if (!USE_MOCK) void registerPushToken();
    return () => disconnectDeliverySocket();
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

/**
 * Antes de montar la app se resuelve la URL del backend: guardada → pista del
 * build → escaneo de la red local. Si no aparece, se muestra la pantalla de
 * configuración de servidor.
 */
function ServerGate() {
  const [state, setState] = useState<"searching" | "ready" | "missing">(
    USE_MOCK ? "ready" : "searching",
  );
  const [tried, setTried] = useState<string[]>([]);

  const search = useCallback(async () => {
    const res = await resolveServer();
    setTried(res.tried);
    setState(res.url ? "ready" : "missing");
  }, []);

  useEffect(() => {
    if (!USE_MOCK) void search();
  }, [search]);

  // Si cambia la red local (otro Wi-Fi, otra subred) se vuelve a buscar el
  // servidor sin reiniciar la app. Si aparece en otra dirección, el cliente
  // HTTP la toma en la siguiente petición y el socket se reconecta.
  useEffect(() => {
    if (USE_MOCK) return;
    const unsubscribe = watchNetworkPrefix(() => {
      void (async () => {
        const previous = getServerUrl();
        const res = await resolveServer();
        if (!res.url) return; // sin servidor: la app sigue y muestra sus errores
        setTried(res.tried);
        setState("ready");
        if (previous && res.url !== previous) {
          disconnectDeliverySocket();
          const tokens = await getTokens();
          if (tokens?.accessToken) connectDeliverySocket(tokens.accessToken);
        }
      })();
    });
    return unsubscribe;
  }, []);

  if (state === "searching") return <SearchingServer />;
  if (state === "missing") {
    return <ServerSetup tried={tried} onResolved={() => setState("ready")} />;
  }
  return <RootShell />;
}

/** Pantalla mientras se busca el backend en la red local. */
function SearchingServer() {
  return (
    <View style={styles.splash}>
      <Image
        source={require("../assets/delivery.png")}
        style={styles.logo}
        resizeMode="contain"
      />
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.splashTitle}>Buscando el servidor…</Text>
      <Text style={styles.splashText}>
        Localizando el backend en la red local. Mantén el Wi-Fi conectado.
      </Text>
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
  splashText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 19,
  },
});
