import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";

/**
 * Root layout mínimo: la app es un WebView (ver `app/index.tsx`).
 * Las pantallas nativas anteriores siguen en el repo por si se revierte, pero
 * no se navegan (nada en el WebView usa `router.push`).
 *
 * `initialWindowMetrics` entrega las medidas desde el primer render: sin él la
 * pantalla reserva el alto del status bar un instante después y el contenido
 * "salta" al abrir la app.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
