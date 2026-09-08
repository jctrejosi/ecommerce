import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: "#fff", borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Pedidos",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={(focused ? "bicycle" : "bicycle-outline") as IconName}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "Historial",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={(focused ? "time" : "time-outline") as IconName}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={(focused ? "person" : "person-outline") as IconName}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
