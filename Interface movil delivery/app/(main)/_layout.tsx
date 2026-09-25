import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useAuthStore } from "@/auth/authStore";
import { HeaderLogo } from "@/ui/HeaderLogo";
import { colors } from "@/theme";

/** Logo DSI a la derecha del título en las cabeceras nativas de detalle. */
const headerRight = () => <HeaderLogo width={62} />;

/**
 * Área autenticada. Si no hay sesión (logout manual o token vencido a mitad
 * de uso), se expulsa a /login. El interceptor HTTP ya limpia tokens y
 * `user` al fallar el refresh; aquí solo se reacciona a ese estado.
 */
export default function MainLayout() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  // Aún restaurando la sesión (SecureStore → /auth/me): no decidir ni parpadear.
  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* El detalle pinta su propia cabecera (logo + "Pedido <código>") dentro
          del contenido, igual que las pestañas, en lugar de la barra nativa. */}
      <Stack.Screen name="order/[id]" options={{ headerShown: false }} />
      <Stack.Screen
        name="map/[id]"
        options={{ title: "Mapa de entrega", headerBackTitle: "Pedido", headerRight }}
      />
      <Stack.Screen
        name="chat/[id]"
        options={{ title: "Chat del pedido", headerBackTitle: "Pedido", headerRight }}
      />
      <Stack.Screen
        name="admin-chat"
        options={{ title: "Chat con administración", headerBackTitle: "Atrás", headerRight }}
      />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
