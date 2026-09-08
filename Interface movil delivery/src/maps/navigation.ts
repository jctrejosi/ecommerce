import { Alert, Linking, Platform } from "react-native";
import type { AlertButton } from "react-native";
import type { LatLng } from "@/api/types";

/** Abre el marcador/teléfono del cliente. */
export function callPhone(phone: string): void {
  const clean = phone.replace(/[^\d+]/g, "");
  void Linking.openURL(`tel:${clean}`).catch(() =>
    Alert.alert("No se pudo abrir el teléfono"),
  );
}

/**
 * Abre navegación externa (Google Maps, Waze o Apple Maps) hacia el destino.
 * Estrategia del MVP: delegar navegación giro a giro al sistema.
 */
export function openExternalNavigation(destination: LatLng): void {
  if (!destination) return;
  const { lat, lng } = destination;

  // En web no hay chooser nativo: abrir Google Maps en una pestaña.
  if (Platform.OS === "web") {
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
      "_blank",
    );
    return;
  }

  const apps: { name: string; url: string }[] = [];
  apps.push({
    name: "Google Maps",
    url: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  });
  apps.push({
    name: "Waze",
    url: `https://waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`,
  });
  if (Platform.OS === "ios") {
    apps.push({
      name: "Apple Maps",
      url: `http://maps.apple.com/?daddr=${lat},${lng}`,
    });
  }

  const buttons: AlertButton[] = apps.map((app) => ({
    text: app.name,
    onPress: () => {
      void Linking.openURL(app.url).catch(() =>
        Alert.alert("Error", `No se pudo abrir ${app.name}.`),
      );
    },
  }));
  buttons.push({ text: "Cancelar", style: "cancel" });

  Alert.alert("Abrir navegación", "Elige la aplicación:", buttons);
}

/** Fallback universal: intenta con el esquema geo: del sistema. */
export function openGenericNavigation(destination: LatLng): void {
  void Linking.openURL(`geo:${destination.lat},${destination.lng}`).catch(() =>
    Alert.alert("No hay una app de navegación disponible"),
  );
}
