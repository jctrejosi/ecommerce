import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Network from "expo-network";
import { Ionicons } from "@expo/vector-icons";
import { queryClient } from "@/lib/queryClient";
import { useAuthStore } from "@/auth/authStore";
import { getTokens } from "@/auth/session";
import { useServerGate } from "@/api/serverGate";
import { getApiUrl } from "@/api/apiConfig";
import { connectPickingSocket, disconnectPickingSocket, connectOrderEvents, disconnectOrderEvents } from "@/socket";
import { configureNewOrderSound } from "@/notifications/sound";
import { colors, radius, spacing } from "@/theme";

export default function RootLayout() {
  const restore = useAuthStore((s) => s.restore);
  // El id (no el objeto) evita reconectar cuando solo se reafina el usuario.
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const status = useServerGate((s) => s.status);
  const ensureServer = useServerGate((s) => s.ensureServer);
  const [bootChecked, setBootChecked] = useState(false);
  const restoredRef = useRef(false);

  // 1) Al arrancar: busca el backend en la red local.
  useEffect(() => {
    void ensureServer(true).finally(() => setBootChecked(true));
  }, [ensureServer]);

  // 1.b) Modo de audio del aviso de pedido nuevo (una sola vez).
  useEffect(() => {
    void configureNewOrderSound();
  }, []);

  // 2) Cada vez que la app vuelve a primer plano o cambia la conectividad
  //    (otra red Wi-Fi, se cayó el Wi-Fi…) se revisa que el servidor siga ahí.
  useEffect(() => {
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") void ensureServer();
    });
    const netSub = Network.addNetworkStateListener(() => {
      void ensureServer();
    });
    return () => {
      appSub.remove();
      netSub.remove();
    };
  }, [ensureServer]);

  // 3) Con servidor disponible: restaura la sesión (una vez).
  useEffect(() => {
    if (status !== "ok") return;
    if (!restoredRef.current) {
      restoredRef.current = true;
      void restore();
    }
  }, [status, restore]);

  // 4) Eventos en vivo: el socket va autenticado con el token del picker, así
  //    que se (re)conecta al entrar y se cierra al cerrar sesión. El segundo
  //    socket (namespace `/orders`) trae los pedidos recién creados.
  useEffect(() => {
    if (status !== "ok" || !userId) {
      disconnectPickingSocket();
      disconnectOrderEvents();
      return;
    }
    let cancelled = false;
    void getTokens().then((tokens) => {
      if (!cancelled && tokens?.accessToken) connectPickingSocket(tokens.accessToken);
    });
    connectOrderEvents();
    return () => {
      cancelled = true;
      disconnectPickingSocket();
      disconnectOrderEvents();
    };
  }, [status, userId]);

  // 5) Vencimiento de sesión: cada 30 s y al volver a primer plano.
  useEffect(() => {
    if (status !== "ok") return;
    const timer = setInterval(() => void useAuthStore.getState().checkExpiry(), 30_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void useAuthStore.getState().checkExpiry();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [status]);

  const retry = () => void ensureServer(true);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        {status === "ok" || restoredRef.current ? (
          <View style={styles.root}>
            {/* La app sigue montada para no perder el trabajo en curso; solo se
                avisa que el servidor no está disponible. */}
            {status !== "ok" ? <ServerBanner status={status} onRetry={retry} /> : null}
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            />
          </View>
        ) : bootChecked ? (
          <ServerMissing onRetry={retry} />
        ) : (
          <ServerSearching />
        )}
        <StatusBar style="light" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** Pantalla mientras se busca el servidor al arrancar. */
function ServerSearching() {
  return (
    <View style={styles.splash}>
      <Image
        source={require("../assets/picking.png")}
        style={styles.logo}
        resizeMode="contain"
      />
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.splashTitle}>Buscando el servidor…</Text>
      <Text style={styles.splashText}>
        Localizando el backend en la red local. Mantén el Wi-Fi conectado.
      </Text>
      <Text style={styles.splashUrl}>{getApiUrl()}</Text>
    </View>
  );
}

/** El arranque no encontró el backend en la red local. */
function ServerMissing({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.splash}>
      <Ionicons name="cloud-offline-outline" size={44} color={colors.textHint} />
      <Text style={styles.splashTitle}>No se encontró el servidor</Text>
      <Text style={styles.splashText}>
        No hay respuesta del backend en esta red. Verifica que el teléfono esté
        en la misma Wi-Fi que el servidor y vuelve a intentarlo.
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}
      >
        <Ionicons name="refresh-outline" size={18} color={colors.onAccent} />
        <Text style={styles.retryText}>Volver a buscar</Text>
      </Pressable>
      <Text style={styles.splashUrl}>{getApiUrl()}</Text>
    </View>
  );
}

/** Aviso no intrusivo cuando el servidor se pierde con la app ya abierta. */
function ServerBanner({ status, onRetry }: { status: "checking" | "missing"; onRetry: () => void }) {
  // El banner va arriba del Stack, así que sin este inset el texto queda
  // debajo de la barra de estado (edge-to-edge).
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.banner, { paddingTop: insets.top + spacing(2.5) }]}>
      {status === "checking" ? (
        <ActivityIndicator color={colors.warning} size="small" />
      ) : (
        <Ionicons name="cloud-offline-outline" size={16} color={colors.dangerText} />
      )}
      <Text style={styles.bannerText} numberOfLines={1}>
        {status === "checking"
          ? "Buscando el servidor en la red…"
          : "Sin conexión con el servidor"}
      </Text>
      {status === "missing" ? (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={styles.bannerAction}>Reintentar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(3),
    paddingHorizontal: spacing(8),
    backgroundColor: colors.background,
  },
  logo: { height: 64, width: 124, marginBottom: spacing(2) },
  splashTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  splashText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  splashUrl: { color: colors.textHint, fontSize: 11, fontWeight: "600" },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2),
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing(5),
    paddingVertical: spacing(3),
    marginTop: spacing(2),
  },
  retryText: { color: colors.onAccent, fontSize: 14, fontWeight: "800" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2.5),
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2.5),
    backgroundColor: "rgba(245,158,11,0.12)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bannerText: { flex: 1, color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  bannerAction: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
});
