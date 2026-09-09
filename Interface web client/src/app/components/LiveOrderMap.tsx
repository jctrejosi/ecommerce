import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { resolveMapStyle } from "../lib/trackingMapStyle";

export interface MapPoint {
  lat: number;
  lng: number;
}

interface LiveOrderMapProps {
  driver?: MapPoint | null;
  destination?: MapPoint | null;
  branch?: MapPoint | null;
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
}: LiveOrderMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const lineSourceId = "track-line";
  // Fuerza repintar los marcadores cuando el estilo base termina de cargar.
  const [styleTick, setStyleTick] = useState(0);

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

        map.on("load", () => setStyleTick((t) => t + 1));
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
              "line-width": 3.5,
              "line-opacity": 0.85,
              "line-dasharray": [4, 3],
            },
          });
        });
      })
      .catch((err) => {
        console.error("[tracking-map] no se pudo resolver el estilo:", err);
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

    if (driver) {
      const el = document.createElement("div");
      el.className =
        "flex items-center justify-center rounded-full bg-white shadow-lg ring-2 ring-[#1A1A2E]";
      el.style.width = "38px";
      el.style.height = "38px";
      el.style.fontSize = "20px";
      el.style.border = "3px solid #FFF200";
      el.textContent = "🛵";
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([driver.lng, driver.lat])
          .addTo(map),
      );
      add(driver);
    }
    if (destination) {
      const el = document.createElement("div");
      el.className = "relative";
      el.style.width = "18px";
      el.style.height = "18px";
      el.innerHTML =
        '<span style="position:absolute;inset:0;border-radius:9999px;background:#16a34a;border:3px solid white;box-shadow:0 1px 6px rgba(0,0,0,.4)"></span>';
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([destination.lng, destination.lat])
          .addTo(map),
      );
      add(destination);
    }
    if (branch) {
      const el = document.createElement("div");
      el.style.width = "16px";
      el.style.height = "16px";
      el.style.borderRadius = "4px";
      el.style.background = "#d97706";
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 1px 6px rgba(0,0,0,.35)";
      el.title = "Sucursal de origen";
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([branch.lng, branch.lat])
          .addTo(map),
      );
      add(branch);
    }

    // Línea punteada repartidor → destino.
    const src = map.getSource(lineSourceId) as maplibregl.GeoJSONSource | null;
    const driverPt = driver ? [driver.lng, driver.lat] : null;
    const destPt = destination ? [destination.lng, destination.lat] : null;
    if (src) {
      const features: unknown[] = [];
      if (driverPt && destPt) {
        features.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [driverPt, destPt],
          },
        });
      }
      src.setData({
        type: "FeatureCollection",
        features: features as never[],
      });
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
    } else if (driver) {
      map.easeTo({ center: [driver.lng, driver.lat], zoom: Math.max(map.getZoom(), 15), duration: 500 });
    } else if (destination) {
      map.easeTo({ center: [destination.lng, destination.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 500 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.lat, driver?.lng, destination?.lat, destination?.lng, branch?.lat, branch?.lng, styleTick]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
