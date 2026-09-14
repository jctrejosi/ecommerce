import { useEffect } from "react";
import { Text, View, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  BricolageGrotesque_400Regular,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from "@expo-google-fonts/bricolage-grotesque";
import { colors } from "../src/theme";
import { useCartStore } from "../src/stores/cart";
import { useAuthStore } from "../src/stores/auth";

const queryClient = new QueryClient();

/** Badge con la cantidad de unidades del carrito (sobre el ícono del tab). */
function CartTabIcon({ color }: { color: ColorValue }) {
  const count = useCartStore((s) => s.items.reduce((acc, i) => acc + i.quantity, 0));
  return (
    <View>
      <Ionicons name="cart-outline" size={24} color={color} />
      {count > 0 && (
        <View
          style={{
            position: "absolute",
            top: -6,
            right: -10,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: colors.accent,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 3,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>
            {count > 99 ? "99+" : count}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function RootLayout() {
  const initAuth = useAuthStore((s) => s.init);

  // Fuentes del web client: Inter (texto) y Bricolage Grotesque (títulos).
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    BricolageGrotesque_400Regular,
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
  });

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.foreground,
            tabBarInactiveTintColor: colors.mutedForeground,
            tabBarStyle: {
              borderTopColor: colors.border,
              backgroundColor: "#fff",
            },
            tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: "Inicio",
              tabBarIcon: ({ color }) => (
                <Ionicons name="home-outline" size={24} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="catalog"
            options={{
              title: "Catálogo",
              tabBarIcon: ({ color }) => (
                <Ionicons name="search-outline" size={24} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="cart"
            options={{
              title: "Carrito",
              tabBarIcon: ({ color }) => <CartTabIcon color={color} />,
            }}
          />
          <Tabs.Screen
            name="account"
            options={{
              title: "Cuenta",
              tabBarIcon: ({ color }) => (
                <Ionicons name="person-outline" size={24} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="product/[id]"
            options={{ href: null, title: "Producto" }}
          />
          <Tabs.Screen
            name="checkout"
            options={{ href: null, title: "Checkout" }}
          />
        </Tabs>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
