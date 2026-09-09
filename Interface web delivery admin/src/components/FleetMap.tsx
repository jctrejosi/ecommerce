import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, Marker, StyleSpecification } from 'maplibre-gl';
import { Check, Layers } from 'lucide-react';
import type { Feature } from 'geojson';
import type { FleetDriver } from '../types';
import { driverVisual, STATUS_META } from '../lib/status';
import {
  MAP_STYLE_OPTIONS,
  LAYER_STORAGE_KEY,
  type MapStyleOption,
} from '../lib/wazeStyles';

export interface FleetMapHandle {
  recenter: () => void;
}

interface Props {
  drivers: FleetDriver[];
  hiddenIds: Set<number>;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

/** Enfoque del mapa: la operación de delivery es solo en Manizales. */
const MANIZALES_CENTER: [number, number] = [5.067, -75.517];
// Esquinas [lng, lat] (orden que espera MapLibre en maxBounds/fitBounds).
const MANIZALES_BOUNDS: [[number, number], [number, number]] = [
  [-75.6, 4.97], // SW (incluye Villamaría y margen rural)
  [-75.4, 5.14], // NE
];

function tipHtml(driver: FleetDriver): string {
  const visual = driverVisual(driver);
  const a = driver.activeAssignment;
  return [
    `<b>${driver.fullName.replace(/</g, '&lt;')}</b>`,
    `<span class="muted">${visual.action}</span>`,
    a
      ? `<span class="muted">${a.referenceCode ?? 'Pedido'} · ${a.customerName ?? 'cliente'}</span>`
      : '',
  ].join('');
}

function pinHtml(driver: FleetDriver, selected: boolean): string {
  const visual = driverVisual(driver);
  const size = selected ? 46 : 34;
  const border = selected ? '#0f172a' : '#ffffff';
  const initials = driver.fullName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const fs = selected ? 14 : 11;
  return `
    <div class="ml-pin" style="width:${size}px;height:${size}px;--pin:${visual.color};--pin-border:${border};${driver.isActive ? '' : 'opacity:.55;'}">
      <span class="ml-pin-inner" style="font-size:${fs}px">${initials}</span>
      <span class="ml-tip">${tipHtml(driver)}</span>
    </div>`;
}

function defaultStyleOption(): MapStyleOption {
  const saved = localStorage.getItem(LAYER_STORAGE_KEY);
  const found = MAP_STYLE_OPTIONS.find((o) => o.id === saved);
  if (found) return found;
  // Por defecto el mismo mapa de la app móvil (OpenFreeMap Liberty).
  const mobile = MAP_STYLE_OPTIONS.find((o) => o.id === 'liberty');
  return mobile ?? MAP_STYLE_OPTIONS[0];
}

/**
 * Propiedades numéricas de OpenMapTiles que pueden venir `null` en los tiles.
 * Los estilos de OpenFreeMap las comparan con `> >= < <=` y MapLibre lanza
 * “Expected value to be of type number, but found null instead” al evaluarlas
 * (openfreemap-styles#21), lo que impide parsear el tile completo.
 */
const NULLABLE_NUMERIC = new Set(['rank', 'admin_level', 'ref_length']);

/**
 * Neutraliza las comparaciones numéricas sobre propiedades nullables en los
 * filtros de un estilo: `[">=", ["get", "rank"], 20]` pasa a comparar contra
 * `["coalesce", ["get", "rank"], centinela]`, donde el centinela (-1e9 o
 * 1e9 según el operador) hace que un `null` nunca pase el filtro, igual que
 * si la propiedad no existiera.
 */
function patchNullableFilters(node: unknown): unknown {
  if (!Array.isArray(node)) return node;
  const patched = node.map(patchNullableFilters);
  if (
    patched.length === 3 &&
    typeof patched[0] === 'string' &&
    ['>', '>=', '<', '<='].includes(patched[0])
  ) {
    const [op, a, b] = patched;
    const keyOf = (v: unknown): string | null =>
      Array.isArray(v) && v[0] === 'get' && typeof v[1] === 'string' ? v[1] : null;
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka && NULLABLE_NUMERIC.has(ka) && typeof b === 'number') {
      const sentinel = op === '>' || op === '>=' ? -1e9 : 1e9;
      return [op, ['coalesce', a, sentinel], b];
    }
    if (kb && NULLABLE_NUMERIC.has(kb) && typeof a === 'number') {
      const sentinel = op === '<' || op === '<=' ? -1e9 : 1e9;
      return [op, a, ['coalesce', b, sentinel]];
    }
  }
  return patched;
}

/**
 * Resuelve el estilo base a pasarle a MapLibre y lo normaliza:
 *
 * 1. En dev, todo el tráfico de OpenFreeMap se sirve por el proxy `/ofm`
 *    (same-origin, vite.config.ts); en prod se va directo al proveedor, que
 *    tiene CORS abierto (`access-control-allow-origin: *`).
 * 2. Las URLs quedan absolutas: los tiles se descargan desde un Web Worker,
 *    donde las relativas no tienen base y falla `new Request()`.
 * 3. OpenFreeMap sirve sus tiles en rutas versionadas
 *    (p. ej. planet/<fecha>_pt/{z}/{x}/{y}.pbf): la lista de tiles se lee del
 *    TileJSON real en vez de asumir una ruta fija.
 * 4. Se corrigen los filtros numéricos sobre propiedades nullables que
 *    rompen el parseo de tiles (bug de los estilos de OpenFreeMap).
 */
async function resolveStyle(opt: MapStyleOption): Promise<StyleSpecification> {
  if (!opt.styleUrl && !opt.spec) {
    throw new Error('Estilo sin spec ni styleUrl');
  }

  const host = import.meta.env.DEV
    ? `${window.location.origin}/ofm`
    : 'https://tiles.openfreemap.org';
  const toBase = (u: string) => u.replace('https://tiles.openfreemap.org', host);

  let spec: StyleSpecification;
  if (opt.styleUrl) {
    const url = `${host}${new URL(opt.styleUrl).pathname}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Estilo ${url} → ${res.status}`);
    const text = await res.text();
    spec = JSON.parse(
      text.split('https://tiles.openfreemap.org').join(host),
    ) as StyleSpecification;
  } else {
    spec = opt.spec as StyleSpecification;
  }

  if (spec.glyphs) spec.glyphs = toBase(spec.glyphs);
  if (typeof spec.sprite === 'string') {
    spec.sprite = toBase(spec.sprite);
  } else if (Array.isArray(spec.sprite)) {
    spec.sprite = spec.sprite.map((s) => ({ ...s, url: toBase(s.url) }));
  }

  // Sources definidos por TileJSON (`url`): se resuelve el JSON real para
  // obtener la ruta versionada y se dejan los tiles inline.
  const sources = Object.values(spec.sources ?? {});
  await Promise.all(
    sources.map(async (raw) => {
      const src = raw as unknown as { url?: string; tiles?: string[] };
      if (!src.url || src.tiles) return;
      try {
        const tj = (await (await fetch(toBase(src.url))).json()) as {
          tiles?: string[];
        };
        src.tiles = (tj.tiles ?? []).map(toBase);
        delete src.url;
      } catch (err) {
        console.warn('[delivery-admin:map] no se pudo resolver el TileJSON', src.url, err);
      }
    }),
  );
  // Sources con tiles inline (p. ej. el relieve ne2 de Liberty) → misma base.
  for (const raw of sources) {
    const src = raw as unknown as { tiles?: string[] };
    if (src.tiles) src.tiles = src.tiles.map(toBase);
  }

  // Corrección del bug de filtros nullables en todas las capas del estilo.
  const looseLayers = (spec.layers ?? []) as Array<{ filter?: unknown }>;
  for (const layer of looseLayers) {
    if (layer.filter) {
      layer.filter = patchNullableFilters(layer.filter);
    }
  }

  return spec;
}

/** MapLibre dibuja en canvas WebGL: detecta si el entorno lo soporta. */
function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const FleetMap = forwardRef<FleetMapHandle, Props>(function FleetMap(
  { drivers, hiddenIds, selectedId, onSelect },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Map<number, Marker>>(new Map());
  const [styleOption, setStyleOption] = useState<MapStyleOption>(defaultStyleOption);
  const [styleReady, setStyleReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const layerButtonRef = useRef<HTMLButtonElement | null>(null);
  const layerPanelRef = useRef<HTMLDivElement | null>(null);

  // Refs espejo para usar dentro de handlers estables.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const driversRef = useRef(drivers);
  driversRef.current = drivers;
  const hiddenIdsRef = useRef(hiddenIds);
  hiddenIdsRef.current = hiddenIds;
  const styleOptionRef = useRef(styleOption);
  styleOptionRef.current = styleOption;
  /** id del estilo ya aplicado al mapa (evita re-setStyle en el montaje). */
  const appliedStyleIdRef = useRef<string | null>(null);

  const overlaySourceId = 'fleet-overlays';

  // ── Capas de overlays (rutas y paradas) sobre el estilo base ──
  function ensureOverlayLayers(map: MlMap) {
    if (map.getSource(overlaySourceId)) return;
    map.addSource(overlaySourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'ov-route-full',
      type: 'line',
      source: overlaySourceId,
      filter: ['==', ['get', 'kind'], 'route-full'],
      paint: {
        'line-color': '#94a3b8',
        'line-width': 2,
        'line-opacity': 0.6,
        'line-dasharray': [2, 7],
      },
    });
    map.addLayer({
      id: 'ov-route-driver',
      type: 'line',
      source: overlaySourceId,
      filter: ['==', ['get', 'kind'], 'route-driver'],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 3,
        'line-opacity': 0.9,
        'line-dasharray': [6, 7],
      },
    });
    map.addLayer({
      id: 'ov-dest-dot',
      type: 'circle',
      source: overlaySourceId,
      filter: ['==', ['get', 'kind'], 'dest-dot'],
      paint: {
        'circle-radius': 4,
        'circle-color': '#475569',
        'circle-stroke-color': '#f8fafc',
        'circle-stroke-width': 1,
      },
    });
    map.addLayer({
      id: 'ov-stop-branch',
      type: 'circle',
      source: overlaySourceId,
      filter: ['==', ['get', 'kind'], 'branch'],
      paint: {
        'circle-radius': 8,
        'circle-color': '#fef3c7',
        'circle-stroke-color': '#d97706',
        'circle-stroke-width': 2.5,
      },
    });
    map.addLayer({
      id: 'ov-stop-dest',
      type: 'circle',
      source: overlaySourceId,
      filter: ['==', ['get', 'kind'], 'dest'],
      paint: {
        'circle-radius': 8,
        'circle-color': '#dcfce7',
        'circle-stroke-color': '#16a34a',
        'circle-stroke-width': 2.5,
      },
    });
  }

  /** Recalcula el GeoJSON de overlays con los datos actuales. */
  function syncOverlays() {
    const map = mapRef.current;
    if (!map || !map.getSource(overlaySourceId)) return;

    const features: Feature[] = [];
    const dAll = driversRef.current;
    const hidden = hiddenIdsRef.current;
    const selectedIdNow = selectedIdRef.current;

    for (const d of dAll) {
      const dest = d.activeAssignment?.destination;
      if (dest && !hidden.has(d.id)) {
        features.push({
          type: 'Feature',
          properties: { kind: 'dest-dot' },
          geometry: { type: 'Point', coordinates: [dest.lng, dest.lat] },
        });
      }
    }

    const sel = dAll.find((d) => d.id === selectedIdNow);
    if (sel?.activeAssignment) {
      const a = sel.activeAssignment;
      const statusColor = STATUS_META[a.status]?.color ?? '#2563eb';
      const target =
        a.status === 'ASSIGNED' ||
        a.status === 'ACCEPTED' ||
        a.status === 'READY_FOR_PICKUP'
          ? a.branchLocation
          : a.destination;

      if (sel.location && target) {
        features.push({
          type: 'Feature',
          properties: { kind: 'route-driver', color: statusColor },
          geometry: {
            type: 'LineString',
            coordinates: [
              [sel.location.lng, sel.location.lat],
              [target.lng, target.lat],
            ],
          },
        });
      }
      if (a.branchLocation && a.destination) {
        features.push({
          type: 'Feature',
          properties: { kind: 'route-full' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [a.branchLocation.lng, a.branchLocation.lat],
              [a.destination.lng, a.destination.lat],
            ],
          },
        });
      }
      if (a.branchLocation) {
        features.push({
          type: 'Feature',
          properties: { kind: 'branch' },
          geometry: {
            type: 'Point',
            coordinates: [a.branchLocation.lng, a.branchLocation.lat],
          },
        });
      }
      if (a.destination) {
        features.push({
          type: 'Feature',
          properties: { kind: 'dest' },
          geometry: {
            type: 'Point',
            coordinates: [a.destination.lng, a.destination.lat],
          },
        });
      }
    }

    (map.getSource(overlaySourceId) as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features,
    });
  }

  function syncMarkers() {
    const map = mapRef.current;
    if (!map) return;
    // Se regeneran por completo (pocos pines; coste despreciable vs. cada ping).
    for (const [, marker] of markersRef.current) marker.remove();
    markersRef.current.clear();
    const selectedNow = selectedIdRef.current;

    for (const d of driversRef.current) {
      if (!d.location || hiddenIdsRef.current.has(d.id)) continue;
      const holder = document.createElement('div');
      holder.innerHTML = pinHtml(d, d.id === selectedNow);
      const pinEl = holder.firstElementChild as HTMLElement;
      pinEl.style.cursor = 'pointer';
      pinEl.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectRef.current(d.id);
      });
      const marker = new maplibregl.Marker({ element: pinEl, anchor: 'center' })
        .setLngLat([d.location.lng, d.location.lat])
        .addTo(map);
      markersRef.current.set(d.id, marker);
    }
  }

  function applyStyleZoom() {
    const map = mapRef.current;
    const opt = styleOptionRef.current;
    if (!map || !opt.maxZoom) return;
    if (map.getZoom() > opt.maxZoom) map.setZoom(opt.maxZoom);
  }

  // ── Inicialización del mapa ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    if (!detectWebGL()) {
      console.error('[delivery-admin:map] WebGL no disponible en este navegador.');
      setMapError(
        'Este navegador no permite dibujar el mapa (WebGL desactivado). Activa la aceleración por hardware o prueba con Chrome/Edge/Firefox.',
      );
      return;
    }

    let cancelled = false;
    let map: MlMap | null = null;

    void resolveStyle(styleOptionRef.current)
      .then((style) => {
        if (cancelled || !style) return;
        map = new maplibregl.Map({
          container: el,
          style,
          center: [MANIZALES_CENTER[1], MANIZALES_CENTER[0]],
          zoom: 14,
          minZoom: 13,
          maxZoom: 18,
          maxBounds: MANIZALES_BOUNDS,
          // Sin el control de atribución flotante (esquina inferior derecha).
          attributionControl: false,
        });
        appliedStyleIdRef.current = styleOptionRef.current.id;

        let hasLoaded = false;
        let vectorTileErrors = 0;
        const sawTileRef = { current: false };
        map.on('click', () => onSelectRef.current(null));
        map.on('load', () => {
          hasLoaded = true;
          ensureOverlayLayers(map!);
          syncOverlays();
          syncMarkers();
          applyStyleZoom();
          setStyleReady(true);
          // Si tras 12 s no llegó ningún tile del mapa base, se avisa (sin
          // recargas automáticas). MapLibre emite eventos de source con varios
          // sourceDataType (content/metadata/tile…), por eso el detector se
          // basa en `sawTileRef` (ver abajo) más `areTilesLoaded()`.
          window.setTimeout(() => {
            if (cancelled || !mapRef.current) return;
            if (sawTileRef.current || mapRef.current.areTilesLoaded()) return;
            console.warn('[delivery-admin:map] no llegaron tiles en 12 s');
            setMapError(
              'El mapa no recibió tiles del proveedor en 12 s. Puede ser un bloqueo de red/adblock hacia tiles.openfreemap.org — prueba el mapa Estándar.',
            );
          }, 12000);
        });
        map.on('data', (e) => {
          const ev = e as { sourceId?: string; dataType?: string; sourceDataType?: string };
          // Cualquier evento de un source del mapa base (no los overlays
          // propios, que se añaden vacíos al cargar) o de un tile cuenta como
          // “llegaron tiles”. Los eventos de estilo no traen sourceId.
          if (ev.dataType === 'tile') {
            sawTileRef.current = true;
          } else if (
            ev.dataType === 'source' &&
            ev.sourceId &&
            ev.sourceId !== overlaySourceId
          ) {
            sawTileRef.current = true;
          }
        });
        map.on('style.load', () => {
          ensureOverlayLayers(map!);
          syncOverlays();
          applyStyleZoom();
        });
        map.on('error', (e) => {
          const err = (e?.error ?? {}) as { message?: string; url?: string };
          const msg = String(err?.message ?? '');
          const url = String(err?.url ?? '');

          // Fallo acumulado de tiles vectoriales ⇒ los bloquea el navegador/red.
          if (url.includes('/planet/')) {
            vectorTileErrors += 1;
            if (vectorTileErrors >= 6) {
              const current = styleOptionRef.current;
              if (current.id === 'waze' || current.id === 'waze-dark') {
                console.warn(
                  '[delivery-admin:map] los tiles vectoriales no cargan — cambio a Estándar (raster)',
                );
                setStyleOption(MAP_STYLE_OPTIONS.find((o) => o.id === 'standard') ?? current);
              } else if (!sawTileRef.current) {
                console.warn('[delivery-admin:map] los tiles vectoriales no cargan:', url);
                setMapError(
                  'No se pudieron cargar los tiles del mapa. Revisa tu conexión o bloqueador de anuncios, o prueba el mapa Estándar.',
                );
              }
            }
            return;
          }
          if (/\.(png|webp|jpg|jpeg)(\?|$)/.test(url)) return;
          console.warn('[delivery-admin:map]', msg || url || e);
          if (
            !hasLoaded &&
            !url.includes('/fonts/') &&
            (/fetch|style|glyph|unable|network|load/i.test(msg) || url.includes('/planet'))
          ) {
            console.error('[delivery-admin:map] no se pudo cargar el estilo:', msg || url);
            setMapError(
              'No se pudo cargar el mapa (se necesita acceso a tiles.openfreemap.org). Revisa tu conexión o el bloqueador de anuncios.',
            );
          }
        });

        mapRef.current = map;
      })
      .catch((err) => {
        console.error('[delivery-admin:map] no se pudo resolver el estilo:', err);
        if (!cancelled) {
          setMapError('No se pudo cargar el estilo del mapa. Revisa tu conexión o el bloqueador de anuncios.');
        }
      });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markersRef.current.clear();
      setStyleReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cambio de estilo (capa base) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyleIdRef.current === styleOption.id) return;
    appliedStyleIdRef.current = styleOption.id;
    void resolveStyle(styleOption)
      .then((style) => {
        if (!mapRef.current) return;
        mapRef.current.setStyle(style);
        mapRef.current.once('style.load', () => {
          ensureOverlayLayers(mapRef.current!);
          syncOverlays();
          applyStyleZoom();
        });
      })
      .catch((err) => {
        console.error('[delivery-admin:map] no se pudo resolver el estilo:', err);
      });
    localStorage.setItem(LAYER_STORAGE_KEY, styleOption.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleOption]);

  // ── Overlays: puntos de destino y rutas ──
  useEffect(() => {
    if (!styleReady) return;
    syncOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, hiddenIds, selectedId, styleReady]);

  // ── Pines de repartidores ──
  useEffect(() => {
    if (!styleReady) return;
    syncMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, hiddenIds, selectedId, styleReady]);

  // ── Centrar al seleccionar ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || selectedId == null) return;
    const d = drivers.find((x) => x.id === selectedId);
    if (d?.location) {
      map.flyTo({
        center: [d.location.lng, d.location.lat],
        zoom: Math.max(map.getZoom(), 15),
        duration: 700,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── Cerrar el selector al hacer click fuera ──
  useEffect(() => {
    if (!layersOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        layerPanelRef.current?.contains(target) ||
        layerButtonRef.current?.contains(target)
      ) {
        return;
      }
      setLayersOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [layersOpen]);

  // ── API imperativa: recenter (enfoca Manizales) ──
  useImperativeHandle(ref, () => ({
    recenter() {
      const map = mapRef.current;
      if (!map) return;
      map.fitBounds(MANIZALES_BOUNDS, { padding: 30, maxZoom: 15, duration: 600 });
    },
  }));

  const fallbackStandard = () => {
    const map = mapRef.current;
    const standard = MAP_STYLE_OPTIONS.find((o) => o.id === 'standard');
    if (map && standard) {
      setMapError(null);
      setStyleOption(standard);
    } else {
      window.location.reload();
    }
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Selector de capas (esquina inferior izquierda) */}
      <button
        ref={layerButtonRef}
        onClick={() => setLayersOpen((o) => !o)}
        title="Cambiar estilo del mapa"
        className={`absolute bottom-6 left-4 z-500 flex h-10 w-10 items-center justify-center rounded-xl shadow-lg ring-1 transition ${
          layersOpen
            ? 'bg-slate-900 text-white ring-slate-900'
            : 'bg-white text-slate-600 ring-slate-200 hover:text-slate-900'
        }`}
      >
        <Layers className="h-4.5 w-4.5" />
      </button>

      {layersOpen && (
        <div
          ref={layerPanelRef}
          className="absolute bottom-[4.4rem] left-4 z-500 w-60 rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-slate-200"
        >
          <p className="px-2.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Estilo del mapa
          </p>
          {MAP_STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                setStyleOption(opt);
                setLayersOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                styleOption.id === opt.id
                  ? 'bg-amber-50 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span
                className="h-6 w-9 shrink-0 rounded-md ring-1 ring-slate-200"
                style={{ background: opt.swatch }}
              />
              {opt.name}
              {styleOption.id === opt.id && (
                <Check className="ml-auto h-3.5 w-3.5 text-amber-500" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Aviso si el mapa no pudo renderizar (WebGL / carga del estilo) */}
      {mapError && (
        <div className="absolute inset-0 z-500 flex items-center justify-center bg-slate-100/95">
          <div className="mx-4 max-w-md rounded-2xl bg-white p-6 text-center shadow-xl ring-1 ring-slate-200">
            <p className="text-3xl">🗺️</p>
            <h3 className="mt-2 text-sm font-bold text-slate-900">El mapa no se pudo mostrar</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{mapError}</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={fallbackStandard}
                className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
              >
                Usar mapa Estándar
              </button>
              <button
                onClick={() => window.location.reload()}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
              >
                Recargar página
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Indicador de capa activa (esquina inferior derecha) */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-500 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-slate-500 shadow ring-1 ring-slate-200">
        <span className={`h-1.5 w-1.5 rounded-full ${styleReady ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
        {styleReady ? styleOption.name : 'Cargando mapa…'}
      </div>
    </div>
  );
});

export default FleetMap;
