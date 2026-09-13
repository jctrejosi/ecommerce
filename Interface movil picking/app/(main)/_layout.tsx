import { Stack } from "expo-router";
import { colors } from "@/theme";

/** Área principal del picker (sin headers nativos; cada pantalla pinta el suyo). */
export default function MainLayout() {
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
