import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Check, Loader2, LocateFixed, MapPin, Search } from "lucide-react";
import { resolveMapStyle } from "../lib/trackingMapStyle";
import {
  geocodingService,
  type GeocodePlace,
} from "../../services/geocoding.service";

/** Centro de Manizales cuando el cliente aún no ha ubicado nada. */
const DEFAULT_CENTER = { lat: 5.067, lng: -75.517 };

export type AddressCoords = { lat: number; lng: number };

interface CheckoutAddressMapProps {
  /** Punto elegido (null = todavía sin ubicar). */
  coords: AddressCoords | null;
  /** La dirección ya fue confirmada contra el marcador. */
  confirmed: boolean;
  /** Cambia el punto (arrastrar, tocar el mapa, buscar o GPS). */
  onCoordsChange: (coords: AddressCoords | null) => void;
  /** Aplica la dirección resuelta al formulario. */
  onPickAddress: (place: { address: string; city: string | null }) => void;
  /** Marca si la dirección coincide con el marcador. */
  onConfirmedChange: (confirmed: boolean) => void;
  /** Cambia esto para que el mapa se recree (p. ej. al reabrir el checkout). */
  resetKey?: string | number;
  /**
   * Petición del padre para ubicar sola una dirección (p. ej. la dirección
   * guardada que el cliente eligió). Cambiar `token` fuerza una nueva
   * ubicación aunque la dirección sea la misma.
   */
  locateRequest?: { address: string; token: number } | null;
}

/**
 * Mapa del paso "Dirección de entrega": permite situar el punto exacto de
 * entrega y exige confirmar que la dirección escrita coincide con el marcador
 * antes de poder continuar al pago.
 *
 * El punto se puede fijar de tres formas: buscando la dirección por texto,
 * tocando/arrastrando el mapa, o con la ubicación actual del dispositivo. Al
 * moverlo se resuelve la dirección de ese punto (geocodificación inversa) y se
 * ofrece aplicarla al formulario.
 */
export function CheckoutAddressMap({
  coords,
  confirmed,
  onCoordsChange,
  onPickAddress,
  onConfirmedChange,
  resetKey,
  locateRequest,
}: CheckoutAddressMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GeocodePlace[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [resolving, setResolving] = useState(false);
  const [suggestion, setSuggestion] = useState<GeocodePlace | null>(null);

  const [autoLocating, setAutoLocating] = useState(false);
  const [autoLocateError, setAutoLocateError] = useState<string | null>(null);

  // Evita la geocodificación inversa justo después de elegir un resultado de la
  // búsqueda: esa dirección ya viene resuelta.
  const skipReverseRef = useRef(false);
  // Última dirección que el formulario conoce, para no repetir el aviso.
  const appliedAddressRef = useRef<string | null>(null);
  // El callback llega nuevo en cada render del padre; se guarda en un ref para
  // que el marcador (y el mapa) no se recoloquen en cada repintado.
  const onCoordsChangeRef = useRef(onCoordsChange);
  useEffect(() => {
    onCoordsChangeRef.current = onCoordsChange;
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

  // Ubicación automática pedida por el padre (p. ej. la dirección guardada que
  // el cliente eligió): se resuelve, se deja el marcador puesto y el cliente
  // solo tiene que confirmar que es la correcta. No se reescribe el texto del
  // formulario para no perder los detalles que ya escribió el cliente.
  useEffect(() => {
    const address = locateRequest?.address?.trim();
    if (!address || address.length < 4) return;
    let cancelled = false;
    setAutoLocating(true);
    setAutoLocateError(null);
    void geocodingService
      .search(address)
      .then((places) => {
        if (cancelled) return;
        const place = places[0];
        if (!place) {
          setAutoLocateError(
            "No pudimos ubicar esa dirección. Búscala o toca el mapa.",
          );
          return;
        }
        // La dirección ya viene resuelta: no hay que hacer geocodificación
        // inversa ni mostrar la sugerencia "el marcador está en…".
        skipReverseRef.current = true;
        appliedAddressRef.current = place.address;
        setSuggestion(null);
        setResults([]);
        onCoordsChangeRef.current({ lat: place.lat, lng: place.lng });
      })
      .catch(() => {
        if (!cancelled) {
          setAutoLocateError(
            "No pudimos ubicar esa dirección. Búscala o toca el mapa.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setAutoLocating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locateRequest]);

  const runSearch = () => {
    const q = query.trim();
    if (q.length < 4 || searching) return;
    setSearching(true);
    setSearchError(null);
    void geocodingService
      .search(q)
      .then((places) => {
        setResults(places);
        if (places.length === 0) {
          setSearchError("No encontramos esa dirección. Prueba con más detalle.");
        }
      })
      .catch((e) =>
        setSearchError(
          e instanceof Error ? e.message : "No se pudo buscar la dirección",
        ),
      )
      .finally(() => setSearching(false));
  };

  const pickPlace = (place: GeocodePlace) => {
    skipReverseRef.current = true;
    appliedAddressRef.current = place.address;
    onCoordsChange({ lat: place.lat, lng: place.lng });
    onPickAddress({ address: place.address, city: place.city });
    // La búsqueda ya está resuelta: el usuario aún debe confirmar en el mapa.
    onConfirmedChange(false);
    setResults([]);
    setSuggestion(null);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setSearchError("Tu dispositivo no permite obtener la ubicación.");
      return;
    }
    setSearching(true);
    setSearchError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSearching(false);
        setResults([]);
        onCoordsChange({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        onConfirmedChange(false);
      },
      () => {
        setSearching(false);
        setSearchError(
          "No pudimos obtener tu ubicación. Búscala por dirección o toca el mapa.",
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
        <p className="text-sm font-bold">Ubica tu dirección en el mapa</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Busca tu dirección, toca el mapa o usa tu ubicación, y luego confirma
        que el marcador quedó en el lugar correcto.
      </p>

      {autoLocating && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Ubicando tu dirección en
          el mapa…
        </p>
      )}

      {/* Buscador */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder="Cra 23 #45-67, Manizales"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-muted/50 text-sm focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={runSearch}
          disabled={query.trim().length < 4 || searching}
          className="px-4 rounded-xl text-sm font-semibold disabled:opacity-40 transition-colors"
          style={{ background: "#1A1A2E", color: "#FFF200" }}
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Buscar"}
        </button>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={searching}
          title="Usar mi ubicación actual"
          className="px-3 rounded-xl border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          <LocateFixed className="w-4 h-4" />
        </button>
      </div>

      {(searchError || autoLocateError) && (
        <p className="text-xs text-red-500">
          {searchError || autoLocateError}
        </p>
      )}

      {results.length > 0 && (
        <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
          {results.map((r) => (
            <button
              key={`${r.lat},${r.lng},${r.label}`}
              type="button"
              onClick={() => pickPlace(r)}
              className="w-full text-left px-3 py-2.5 text-xs hover:bg-muted/60 transition-colors"
            >
              <span className="block font-semibold text-foreground">
                {r.address}
              </span>
              <span className="block text-muted-foreground mt-0.5 truncate">
                {r.label}
              </span>
            </button>
          ))}
        </div>
      )}

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
              Busca la dirección, toca el mapa o usa tu ubicación.
            </p>
          </div>
        )}
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
      <label
        className={`flex items-start gap-2.5 p-3 rounded-xl border transition-colors ${
          confirmed
            ? "border-green-500 bg-green-50"
            : coords
              ? "border-border bg-muted/30 cursor-pointer"
              : "border-dashed border-border opacity-60"
        }`}
      >
        <input
          type="checkbox"
          checked={confirmed}
          disabled={!coords}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="mt-0.5 w-4 h-4 shrink-0 accent-[#1A1A2E]"
        />
        <span className="text-xs leading-snug">
          {confirmed ? (
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-green-600" />
              Confirmado: el marcador corresponde a la dirección de entrega
            </span>
          ) : coords ? (
            <>
              <span className="font-semibold text-foreground">
                Confirmo que el marcador del mapa corresponde a mi dirección
              </span>
              <span className="block text-muted-foreground mt-0.5">
                Revísalo antes de continuar con el pago.
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Primero ubica tu dirección en el mapa
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
