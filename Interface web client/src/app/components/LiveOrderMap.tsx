import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2 } from "lucide-react";
import { resolveMapStyle } from "../lib/trackingMapStyle";
import { decodePolyline } from "../lib/polyline";

export interface MapPoint {
  lat: number;
  lng: number;
}

interface LiveOrderMapProps {
  driver?: MapPoint | null;
  destination?: MapPoint | null;
  branch?: MapPoint | null;
  /**
   * Ruta real por calles (OSRM) codificada en polyline. Mientras sea `null`
   * no se dibuja ninguna línea: primero se calcula la ruta y luego se muestra
   * (nunca una recta provisional repartidor → destino).
   */
  routePolyline?: string | null;
}

/**
 * Mapa del rastreo de un pedido: mismo motor/estilo que el delivery admin
 * (MapLibre GL + OpenFreeMap Liberty). Muestra al repartidor en vivo, el
 * destino y (si se sabe) la sucursal de origen.
 */
export function LiveOrderMap({
  driver,
  destination,
  branch,
  routePolyline,
}: LiveOrderMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const lineSourceId = "track-line";
  // Fuerza repintar los marcadores cuando el estilo base termina de cargar.
  const [styleTick, setStyleTick] = useState(0);
  // Pantalla de carga mientras el mapa (estilo + tiles) inicializa.
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  // Crear el mapa una sola vez.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;
    let disposed = false;

    void resolveMapStyle()
      .then((style) => {
        if (disposed) return;
        const map = new maplibregl.Map({
          container: el,
          style,
          center: [-75.517, 5.067], // Manizales
          zoom: 13,
          attributionControl: false,
        });
        mapRef.current = map;

        map.on("load", () => {
          setMapReady(true);
          setStyleTick((t) => t + 1);
        });
        map.on("style.load", () => setStyleTick((t) => t + 1));

        map.on("style.load", () => {
          if (map.getSource(lineSourceId)) return;
          map.addSource(lineSourceId, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "track-line-layer",
            type: "line",
            source: lineSourceId,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#2563eb",
              "line-width": 4,
              "line-opacity": 0.9,
            },
          });
        });
      })
      .catch((err) => {
        console.error("[tracking-map] no se pudo resolver el estilo:", err);
        setMapFailed(true);
      });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Actualizar marcadores y encuadre cuando cambian los puntos.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) return;

    // Limpia marcadores previos.
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    const points: [number, number][] = [];
    const add = (p: MapPoint | null | undefined) => {
      if (!p) return;
      points.push([p.lng, p.lat]);
      return [p.lng, p.lat] as [number, number];
    };

    // Si el repartidor todavía no tiene ubicación registrada, se sitúa un
    // punto de referencia cerca del destino/sucursal para que se vea "dónde
    // viene" en lugar de dejar el mapa sin su marcador.
    const driverPoint: MapPoint | null =
      driver ??
      (destination
        ? { lat: destination.lat + 0.012, lng: destination.lng - 0.009 }
        : branch
          ? { lat: branch.lat + 0.012, lng: branch.lng - 0.009 }
          : null);

    if (driverPoint) {
      // MapLibre posiciona el marcador aplicando `transform: translate(...)`
      // sobre este elemento. La animación (que también usa `transform: scale`)
      // va en un hijo: si se aplicara al propio marcador, pisaría ese translate
      // y el pin quedaría anclado en la esquina superior izquierda del mapa.
      const el = document.createElement("div");
      el.style.width = "38px";
      el.style.height = "38px";
      el.title = "Repartidor";

      const inner = document.createElement("div");
      inner.className =
        "flex items-center justify-center rounded-full bg-white shadow-lg ring-2 ring-[#1A1A2E]";
      inner.style.width = "100%";
      inner.style.height = "100%";
      inner.style.fontSize = "20px";
      inner.style.boxSizing = "border-box";
      inner.style.border = "3px solid #FFF200";
      inner.style.animation = "deliveryBlink 1.4s ease-in-out infinite";
      inner.textContent = "🛵";
      el.appendChild(inner);

      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([driverPoint.lng, driverPoint.lat])
          .addTo(map),
      );
      add(driverPoint);
    }
    if (destination) {
      const el = document.createElement("div");
      el.className =
        "flex items-center justify-center rounded-full bg-white shadow-lg";
      el.style.width = "38px";
      el.style.height = "38px";
      el.style.fontSize = "20px";
      el.style.lineHeight = "1";
      el.style.boxSizing = "border-box";
      el.style.border = "3px solid #16A34A";
      el.textContent = "🏠";
      el.title = "Dirección de entrega";
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([destination.lng, destination.lat])
          .addTo(map),
      );
      add(destination);
    }
    if (branch) {
      // Mismo marcador de tienda que la app móvil (círculo blanco + 🏪).
      const el = document.createElement("div");
      el.className = "flex items-center justify-center";
      el.style.width = "34px";
      el.style.height = "34px";
      el.style.borderRadius = "17px";
      el.style.background = "rgba(255,255,255,0.9)";
      el.style.border = "1px solid #E2E8F0";
      el.style.fontSize = "18px";
      el.style.lineHeight = "1";
      el.style.boxSizing = "border-box";
      el.textContent = "🏪";
      el.title = "Sucursal de origen";
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([branch.lng, branch.lat])
          .addTo(map),
      );
      add(branch);
    }

    // Ruta real por calles. Solo se pinta cuando el backend ya la calculó
    // (polyline decodificable); si no, se deja el mapa sin línea.
    const src = map.getSource(lineSourceId) as maplibregl.GeoJSONSource | null;
    if (src) {
      let coordinates: [number, number][] | null = null;
      if (routePolyline) {
        try {
          const decoded = decodePolyline(routePolyline);
          if (decoded.length >= 2) coordinates = decoded;
        } catch {
          coordinates = null;
        }
      }
      src.setData({
        type: "FeatureCollection",
        features: coordinates
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates },
              },
            ]
          : [],
      } as never);
    }

    if (points.length >= 2) {
      const lngs = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 70, maxZoom: 16.5, duration: 600 },
      );
    } else if (driverPoint) {
      map.easeTo({ center: [driverPoint.lng, driverPoint.lat], zoom: Math.max(map.getZoom(), 15), duration: 500 });
    } else if (destination) {
      map.easeTo({ center: [destination.lng, destination.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 500 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.lat, driver?.lng, destination?.lat, destination?.lng, branch?.lat, branch?.lng, routePolyline, styleTick]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      <div ref={containerRef} className="h-full w-full" />

      {/* Pantalla de carga mientras el mapa inicializa */}
      {!mapReady && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-100">
          {mapFailed ? (
            <p className="text-xs font-semibold text-slate-500">
              No se pudo cargar el mapa
            </p>
          ) : (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
              <p className="text-xs font-semibold text-slate-500">Cargando mapa…</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
