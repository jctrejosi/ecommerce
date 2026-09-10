import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { isRunningInExpoGo } from "expo";
import type { LatLng } from "@/api/types";
import { decodePolyline } from "./polyline";
import { colors, spacing } from "@/theme";

type MapLibreModule = typeof import("@maplibre/maplibre-react-native");

/**
 * MapLibre es un módulo nativo (TurboModule) que NO existe en Expo Go.
 * Importarlo ahí rompe la app: Metro evalúa todo el árbol de la librería y
 * `MLRNCameraModule` lanza un error *uncaught* (no lo atrapa `.catch`).
 * Por eso se detecta Expo Go antes de importar y se muestra un fallback.
 * En dev build (`npx expo run:android`) el módulo nativo sí existe.
 */
const MAP_UNAVAILABLE = Platform.OS === "web" || isRunningInExpoGo();

/**
 * Mapa base (calles, barrios, direcciones): OpenFreeMap sirve tiles
 * vectoriales de OpenStreetMap (https://openfreemap.org) — gratis, sin API
 * key y con nombres de vías en español para Manizales. Antes se usaba el
 * estilo demo de MapLibre (sin detalle urbano), por eso solo se veían los
 * marcadores y la ruta. Alternativa raster OSM si algún día hace falta:
 * https://tile.openstreetmap.org/{z}/{x}/{y}.png
 */
const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export interface DeliveryMapProps {
  destination: LatLng | null;
  /** Posición actual del repartidor (si no hay, se omite la ruta). */
  origin?: LatLng | null;
  /** Punto de recogida (tienda). */
  pickup?: LatLng | null;
  /**
   * Polyline (OSRM) de la ruta recomendada. Mientras no esté calculada no se
   * dibuja nada: primero se calcula la ruta y luego se muestra (nada de línea
   * recta provisional).
   */
  routePolyline?: string | null;
}

/**
 * Mapa del delivery (MapLibre + OpenStreetMap, sin API key de Google).
 *
 * MapLibre es un módulo nativo: NO está en Expo Go. Se carga dinámicamente y,
 * si no está disponible (Expo Go), se muestra un fallback informativo. Para
 * ver el mapa real: dev build (`npx expo run:android`).
 */
export function DeliveryMap({
  destination,
  origin,
  pickup,
  routePolyline,
}: DeliveryMapProps) {
  const [ml, setMl] = useState<MapLibreModule | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (MAP_UNAVAILABLE) {
      setFailed(true);
      return;
    }
    let mounted = true;
    import("@maplibre/maplibre-react-native")
      .then((mod) => {
        if (mounted) setMl(mod);
      })
      .catch((err) => {
        // Solo ocurre si el APK no incluye el módulo nativo (dev build viejo).
        console.warn("[map] módulo nativo no disponible:", err);
        if (mounted) setFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (failed) return <MapFallback />;
  if (!ml) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const { Map, Camera, GeoJSONSource, Layer, Marker } = ml;

  const center: [number, number] = destination
    ? [destination.lng, destination.lat]
    : pickup
      ? [pickup.lng, pickup.lat]
      : origin
        ? [origin.lng, origin.lat]
        : [-74.07209, 4.71099]; // Bogotá

  const route: GeoJSON.GeoJSON | null = buildRoute(routePolyline);

  return (
    <View style={styles.container}>
      <Map style={styles.map} mapStyle={BASEMAP_STYLE_URL}>
        <Camera initialViewState={{ center, zoom: 13 }} />

        {route && (
          <GeoJSONSource id="delivery-route" data={route}>
            <Layer
              id="delivery-route-line"
              type="line"
              style={{ lineColor: "#2563EB", lineWidth: 4 }}
            />
          </GeoJSONSource>
        )}

        {pickup && (
          <Marker lngLat={[pickup.lng, pickup.lat]}>
            <View style={styles.markerCircle}>
              <Text style={styles.markerEmoji}>🏪</Text>
            </View>
          </Marker>
        )}

        {destination && (
          <Marker lngLat={[destination.lng, destination.lat]}>
            <View style={styles.markerRing}>
              <View style={[styles.markerBadge, styles.badgeDest]}>
                <Text style={styles.markerEmoji}>🏠</Text>
              </View>
            </View>
          </Marker>
        )}

        {origin && (
          <Marker lngLat={[origin.lng, origin.lat]}>
            <View style={styles.markerRing}>
              <View style={[styles.markerBadge, styles.badgeDriver]}>
                <Text style={styles.markerEmoji}>🛵</Text>
              </View>
            </View>
          </Marker>
        )}
      </Map>
    </View>
  );
}

function buildRoute(
  routePolyline: string | null | undefined,
): GeoJSON.GeoJSON | null {
  // Solo se pinta la ruta ya calculada (OSRM). Si aún no ha llegado, no se
  // dibuja nada: antes se caía a una línea recta y esa recta aparecía durante
  // el cálculo, dando la impresión de una ruta incorrecta.
  if (!routePolyline) return null;
  try {
    const coords = decodePolyline(routePolyline);
    if (coords.length >= 2) {
      return {
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: {},
      };
    }
  } catch {
    /* polyline inválida → sin ruta */
  }
  return null;
}

function MapFallback() {
  return (
    <View style={styles.fallback}>
      <Ionicons name="map-outline" size={44} color={colors.textFaint} />
      <Text style={styles.fallbackTitle}>Mapa no disponible aquí</Text>
      <Text style={styles.fallbackText}>
        MapLibre (mapa nativo) no está incluido en Expo Go. Corre un dev build
        con:
      </Text>
      <Text style={styles.fallbackCmd}>npx expo run:android</Text>
      <Text style={styles.fallbackText}>
        Mientras tanto, el botón "ABRIR NAVEGACIÓN" funciona con tu app de
        mapas instalada.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(2),
    padding: spacing(6),
    backgroundColor: colors.background,
  },
  fallbackTitle: { fontSize: 17, fontWeight: "800", color: colors.text },
  fallbackText: { fontSize: 13, color: colors.textMuted, textAlign: "center", lineHeight: 19 },
  fallbackCmd: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primary,
    backgroundColor: colors.infoBg,
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(1.5),
    borderRadius: 8,
    overflow: "hidden",
  },
  markerEmoji: { fontSize: 18, lineHeight: 20 },
  markerRing: {
    padding: 2,
    borderRadius: 21,
    backgroundColor: "#1A1A2E",
  },
  markerBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
  },
  badgeDest: { borderColor: "#16A34A" },
  badgeDriver: { borderColor: "#FFF200" },
  markerCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
});
