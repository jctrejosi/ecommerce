import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useAuthStore } from "@/auth/authStore";
import { useNewOrderAlerts } from "@/notifications/newOrderAlerts";
import { useAppBadge } from "@/notifications/badge";
import { useNotificationRouting, usePushRegistration } from "@/notifications/register";
import { colors } from "@/theme";

/**
 * Área autenticada del picker. Si no hay sesión (logout manual, vencimiento por
 * fin de turno/inactividad o token rechazado con 401) se expulsa a /login.
 */
export default function MainLayout() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const user = useAuthStore((s) => s.user);

  // Aún restaurando la sesión: no decidir ni parpadear.
  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  return <AuthedArea />;
}

/**
 * Área ya autenticada. El aviso de pedido nuevo (sonido + vibración) y el
 * contador de pendientes del ícono se montan aquí, así funcionan en cualquier
 * pantalla del picker y no solo en la lista.
 */
function AuthedArea() {
  useNewOrderAlerts();
  useAppBadge();
  // Push: registra el dispositivo y abre el destino al tocar una notificación.
  usePushRegistration();
  useNotificationRouting();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: "slide_from_right",
      }}
    />
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
