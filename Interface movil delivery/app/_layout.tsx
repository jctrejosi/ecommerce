import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/lib/queryClient";
import { useAuthStore } from "@/auth/authStore";
import { getTokens } from "@/auth/storage";
import { configureNotifications, registerPushToken } from "@/notifications/push";
import { connectDeliverySocket, disconnectDeliverySocket } from "@/socket";
import { USE_MOCK } from "@/api";

function RootShell() {
  const restore = useAuthStore((s) => s.restore);
  const user = useAuthStore((s) => s.user);

  // Restaurar sesión al arrancar (SecureStore → /auth/me).
  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    void configureNotifications();
  }, []);

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

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <RootShell />
        <StatusBar style="dark" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
