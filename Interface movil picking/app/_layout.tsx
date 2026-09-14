import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/lib/queryClient";
import { useAuthStore } from "@/auth/authStore";
import { bootApiUrl } from "@/api/discovery";
import { getApiUrl } from "@/api/apiConfig";
import { connectPickingSocket, disconnectPickingSocket } from "@/socket";
import { colors } from "@/theme";

export default function RootLayout() {
  const restore = useAuthStore((s) => s.restore);
  const [booting, setBooting] = useState(true);

  // 1) Descubre el backend en la red local (o usa la URL guardada si responde).
  useEffect(() => {
    void bootApiUrl().finally(() => setBooting(false));
  }, []);

  // 2) Con el servidor listo: restaura la sesión y conecta el socket de eventos.
  useEffect(() => {
    if (booting) return;
    void restore();
    connectPickingSocket();
    return () => disconnectPickingSocket();
  }, [booting, restore]);

  // 3) Vencimiento de sesión: revisa cada 30 s y al volver a primer plano.
  useEffect(() => {
    if (booting) return;
    const timer = setInterval(() => void useAuthStore.getState().checkExpiry(), 30_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void useAuthStore.getState().checkExpiry();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [booting]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        {booting ? (
          <View style={styles.boot}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.bootText}>Buscando servidor en la red local…</Text>
            <Text style={styles.bootSub}>{getApiUrl()}</Text>
          </View>
        ) : (
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          />
        )}
        <StatusBar style="light" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: colors.background,
  },
  bootText: { color: colors.textMuted, fontSize: 14, fontWeight: "700" },
  bootSub: { color: colors.textHint, fontSize: 11, fontWeight: "600" },
});
