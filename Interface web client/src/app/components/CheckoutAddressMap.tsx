import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Check, Loader2, LocateFixed, MapPin } from "lucide-react";
import { resolveMapStyle } from "../lib/trackingMapStyle";
import {
  geocodingService,
  type GeocodePlace,
} from "../../services/geocoding.service";

/** Centro de Manizales cuando el cliente aún no ha ubicado nada. */
const DEFAULT_CENTER = { lat: 5.067, lng: -75.517 };

export type AddressCoords = { lat: number; lng: number };

/** Resultado de ubicar una dirección en el mapa. */
export type LocateResult = {
  /** Dirección que se pidió ubicar. */
  address: string;
  /** Se pudo ubicar (entonces `resolved` trae lo que resolvió el geocoder). */
  ok: boolean;
  /** Dirección corta que devolvió el geocoder. */
  resolved?: string;
};

interface CheckoutAddressMapProps {
  /** Punto elegido (null = todavía sin ubicar). */
  coords: AddressCoords | null;
  /** La dirección ya fue confirmada contra el marcador. */
  confirmed: boolean;
  /** Cambia el punto (arrastrar, tocar el mapa o GPS). */
  onCoordsChange: (coords: AddressCoords | null) => void;
  /** Aplica la dirección resuelta al formulario. */
  onPickAddress: (place: { address: string; city: string | null }) => void;
  /** Marca si la dirección coincide con el marcador. */
  onConfirmedChange: (confirmed: boolean) => void;
  /** Cambia esto para que el mapa se recree (p. ej. al reabrir el checkout). */
  resetKey?: string | number;
  /**
   * Petición del padre para ubicar una dirección: la que el cliente escribió en
   * el formulario o la que eligió de sus direcciones guardadas. Cambiar `token`
   * fuerza una nueva ubicación aunque la dirección sea la misma.
   */
  locateRequest?: { address: string; token: number } | null;
  /**
   * Resultado de ubicar una dirección, para validarla en el formulario: si el
   * geocoder no la encontró hay que avisarle al cliente junto al campo.
   */
  onLocateResult?: (result: LocateResult) => void;
}

/**
 * Mapa del paso "Dirección de entrega": sitúa el punto exacto de entrega y
 * exige confirmar que la dirección escrita coincide con el marcador antes de
 * poder continuar al pago.
 *
 * El marcador lo coloca la dirección que llega del formulario
 * (`locateRequest`). Después el cliente puede ajustarlo arrastrándolo, tocando
 * el mapa o usando la ubicación del dispositivo; al moverlo se resuelve la
 * dirección de ese punto (geocodificación inversa) y se ofrece aplicarla al
 * formulario.
 */
export function CheckoutAddressMap({
  coords,
  confirmed,
  onCoordsChange,
  onPickAddress,
  onConfirmedChange,
  resetKey,
  locateRequest,
  onLocateResult,
}: CheckoutAddressMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Ubicación de la dirección que llega del formulario (propia o guardada).
  const [locating, setLocating] = useState(false);
  // GPS del dispositivo en curso.
  const [gpsBusy, setGpsBusy] = useState(false);
  // Último error al resolver una dirección.
  const [locateError, setLocateError] = useState<string | null>(null);

  const [resolving, setResolving] = useState(false);
  const [suggestion, setSuggestion] = useState<GeocodePlace | null>(null);

  // Evita la geocodificación inversa justo después de ubicar una dirección ya
  // resuelta (la del formulario): volvería a sugerir exactamente lo mismo.
  const skipReverseRef = useRef(false);
  // Última dirección que el formulario conoce, para no repetir el aviso.
  const appliedAddressRef = useRef<string | null>(null);
  // El callback llega nuevo en cada render del padre; se guarda en un ref para
  // que el marcador (y el mapa) no se recoloquen en cada repintado.
  const onCoordsChangeRef = useRef(onCoordsChange);
  useEffect(() => {
    onCoordsChangeRef.current = onCoordsChange;
  });
  // Igual con el aviso del resultado: el efecto de ubicación no debe volver a
  // correr porque el padre pase una función nueva en cada render.
  const onLocateResultRef = useRef(onLocateResult);
  useEffect(() => {
    onLocateResultRef.current = onLocateResult;
  });

  const placeMarker = useCallback((map: maplibregl.Map, at: AddressCoords) => {
    if (!markerRef.current) {
      const el = document.createElement("div");
      el.className =
        "flex items-center justify-center rounded-full bg-white shadow-lg";
      el.style.width = "34px";
      el.style.height = "34px";
      el.style.boxSizing = "border-box";
      el.style.border = "3px solid #1A1A2E";
      el.style.fontSize = "17px";
      el.style.lineHeight = "1";
      el.style.cursor = "grab";
      el.textContent = "📍";
      el.title = "Punto de entrega: arrástrame";

      const marker = new maplibregl.Marker({
        element: el,
        anchor: "center",
        draggable: true,
      })
        .setLngLat([at.lng, at.lat])
        .addTo(map);

      // Al soltar el marcador se actualiza el punto elegido.
      marker.on("dragend", () => {
        const p = marker.getLngLat();
        onCoordsChangeRef.current({ lat: p.lat, lng: p.lng });
      });

      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat([at.lng, at.lat]);
    }
  }, []);

  // Crear el mapa una sola vez por `resetKey`.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let disposed = false;

    void resolveMapStyle()
      .then((style) => {
        if (disposed) return;
        const map = new maplibregl.Map({
          container: el,
          style,
          center: [
            coords?.lng ?? DEFAULT_CENTER.lng,
            coords?.lat ?? DEFAULT_CENTER.lat,
          ],
          zoom: coords ? 16 : 13,
          attributionControl: false,
        });
        mapRef.current = map;

        map.on("load", () => setReady(true));
        // Tocar el mapa también fija el punto de entrega.
        map.on("click", (e) => {
          onCoordsChangeRef.current({
            lat: e.lngLat.lat,
            lng: e.lngLat.lng,
          });
        });
      })
      .catch((err) => {
        console.error("[checkout-map] no se pudo resolver el estilo:", err);
        setFailed(true);
      });

    return () => {
      disposed = true;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Solo se rehace si el checkout se reinicia a propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Sincronizar marcador y encuadre con el punto elegido.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (coords) {
      placeMarker(map, coords);
      map.easeTo({ center: [coords.lng, coords.lat], duration: 400 });
    } else {
      markerRef.current?.remove();
      markerRef.current = null;
    }
  }, [coords, ready, placeMarker]);

  // Geocodificación inversa: qué dirección hay bajo el marcador.
  useEffect(() => {
    if (!coords) {
      setSuggestion(null);
      return;
    }
    if (skipReverseRef.current) {
      skipReverseRef.current = false;
      return;
    }
    let cancelled = false;
    setResolving(true);
    void geocodingService
      .reverse(coords.lat, coords.lng)
      .then((place) => {
        if (cancelled || !place) return;
        // Si es la misma dirección que ya está en el formulario, no se repite.
        setSuggestion(
          place.address && place.address !== appliedAddressRef.current
            ? place
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setSuggestion(null);
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coords]);

  // Ubicación de la dirección que manda el formulario (la escrita por el cliente
  // o la que eligió de sus direcciones guardadas): se resuelve, se deja el
  // marcador puesto y el cliente solo confirma que es la correcta. No se
  // reescribe el texto del formulario para no perder detalles ya escritos.
  useEffect(() => {
    const address = locateRequest?.address?.trim();
    if (!address || address.length < 4) return;
    let cancelled = false;
    setLocating(true);
    setLocateError(null);
    void geocodingService
      .search(address)
      .then((places) => {
        if (cancelled) return;
        const place = places[0];
        if (!place) {
          setLocateError(
            "No pudimos ubicar esa dirección. Toca el mapa para marcar el punto.",
          );
          onLocateResultRef.current?.({ address, ok: false });
          return;
        }
        // La dirección ya viene resuelta: no hay que hacer geocodificación
        // inversa ni mostrar la sugerencia "el marcador está en…".
        skipReverseRef.current = true;
        appliedAddressRef.current = place.address;
        setSuggestion(null);
        onCoordsChangeRef.current({ lat: place.lat, lng: place.lng });
        onLocateResultRef.current?.({
          address,
          ok: true,
          resolved: place.address,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLocateError(
            "No pudimos ubicar esa dirección. Toca el mapa para marcar el punto.",
          );
          onLocateResultRef.current?.({ address, ok: false });
        }
      })
      .finally(() => {
        if (!cancelled) setLocating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locateRequest]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocateError("Tu dispositivo no permite obtener la ubicación.");
      return;
    }
    setGpsBusy(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false);
        skipReverseRef.current = false;
        onCoordsChange({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        onConfirmedChange(false);
      },
      () => {
        setGpsBusy(false);
        setLocateError(
          "No pudimos obtener tu ubicación. Toca el mapa para marcar el punto.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    appliedAddressRef.current = suggestion.address;
    onPickAddress({ address: suggestion.address, city: suggestion.city });
    setSuggestion(null);
  };

  return (
    <div className="bg-white rounded-2xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
        <p className="text-sm font-bold">Tu dirección en el mapa</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Ubicamos la dirección que escribiste. Si el punto no queda exacto,
        toca el mapa o arrastra el marcador para ajustarlo.
      </p>

      {locating && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Ubicando tu dirección en
          el mapa…
        </p>
      )}

      {locateError && <p className="text-xs text-red-500">{locateError}</p>}

      {/* Mapa */}
      <div className="relative rounded-xl overflow-hidden border border-border">
        <div ref={containerRef} className="h-56 w-full bg-muted/40" />
        {!ready && !failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/40">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Cargando el mapa…</p>
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/40 px-6">
            <p className="text-xs text-center text-muted-foreground">
              No se pudo cargar el mapa. Revisa tu conexión y toca de nuevo el
              mapa para ubicar el punto.
            </p>
          </div>
        )}
        {ready && !coords && (
          <div className="absolute inset-x-3 bottom-3 rounded-xl bg-white/95 border border-border px-3 py-2 shadow-sm pointer-events-none">
            <p className="text-[11px] font-semibold text-foreground">
              Aún no has ubicado el punto de entrega
            </p>
            <p className="text-[11px] text-muted-foreground">
              Escribe la dirección o toca el mapa para marcar el punto.
            </p>
          </div>
        )}
        {/* Ubicación actual del dispositivo */}
        <button
          type="button"
          onClick={useMyLocation}
          disabled={gpsBusy || !ready}
          title="Usar mi ubicación actual"
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/95 border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          {gpsBusy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <LocateFixed className="w-4 h-4" />
          )}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground text-right">
        Mapas © OpenStreetMap
      </p>

      {/* Dirección detectada bajo el marcador */}
      {coords && resolving && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Buscando la dirección de
          ese punto…
        </p>
      )}
      {suggestion && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 px-3 py-2.5 space-y-1.5">
          <p className="text-xs text-muted-foreground">El marcador está en:</p>
          <p className="text-xs font-semibold text-foreground">
            {suggestion.address}
          </p>
          <button
            type="button"
            onClick={applySuggestion}
            className="text-xs font-bold underline underline-offset-2"
            style={{ color: "#1A1A2E" }}
          >
            Usar esta dirección
          </button>
        </div>
      )}

      {/* Confirmación obligatoria */}
      <button
        type="button"
        onClick={() => onConfirmedChange(!confirmed)}
        disabled={!coords}
        className={`w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl border text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          confirmed
            ? "border-green-500 bg-green-50 text-green-700"
            : "border-transparent"
        }`}
        style={
          confirmed ? undefined : { background: "#1A1A2E", color: "#FFF200" }
        }
      >
        {confirmed ? (
          <>
            <Check className="w-4 h-4 shrink-0" />
            Dirección confirmada en el mapa
          </>
        ) : coords ? (
          "Confirmar que la dirección es correcta en el mapa"
        ) : (
          "Primero ubica tu dirección en el mapa"
        )}
      </button>
    </div>
  );
}
