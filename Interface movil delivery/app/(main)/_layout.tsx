import { Stack } from "expo-router";

export default function MainLayout() {
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
