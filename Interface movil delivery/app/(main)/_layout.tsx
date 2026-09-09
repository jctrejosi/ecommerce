import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useAuthStore } from "@/auth/authStore";
import { colors } from "@/theme";

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
      <Stack.Screen
        name="order/[id]"
        options={{ title: "Detalle del pedido", headerBackTitle: "Pedidos" }}
      />
      <Stack.Screen
        name="map/[id]"
        options={{ title: "Mapa de entrega", headerBackTitle: "Pedido" }}
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
