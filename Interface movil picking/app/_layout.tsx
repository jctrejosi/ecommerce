import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { queryClient } from "@/lib/queryClient";
import { usePickerStore } from "@/picking/pickerStore";
import { connectPickingSocket, disconnectPickingSocket } from "@/socket";
import { colors } from "@/theme";

export default function RootLayout() {
  const restore = usePickerStore((s) => s.restore);

  useEffect(() => {
    void restore();
    connectPickingSocket();
    return () => disconnectPickingSocket();
  }, [restore]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
        <StatusBar style="light" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
