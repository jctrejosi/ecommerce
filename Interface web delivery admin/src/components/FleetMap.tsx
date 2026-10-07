import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, Marker, StyleSpecification } from 'maplibre-gl';
import { Check, Layers, Loader2, MapPin, Route, Store, User, X } from 'lucide-react';
import type { Feature } from 'geojson';
import type { FleetDriver, FleetOrder } from '../types';
import { api } from '../services/api';
import { decodePolyline } from '../lib/polyline';
import { driverColor } from '../lib/driverColors';
import { driverVisual, isDriverOnline } from '../lib/status';
import { formatDateTime } from '../lib/format';
import {
  MAP_STYLE_OPTIONS,
  LAYER_STORAGE_KEY,
  type MapStyleOption,
} from '../lib/wazeStyles';

interface LiveRouteData {
  coords: [number, number][];
  distanceM: number;
  durationS: number;
}

export interface FleetMapHandle {
  recenter: () => void;
}

interface Props {
  drivers: FleetDriver[];
  hiddenIds: Set<number>;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /**
   * La pestaña del mapa está visible. El panel mantiene el mapa montado aunque
   * no lo esté (para no recrearlo ni volver a descargar los tiles al cambiar de
   * pestaña); con `false` solo se recalcula el tamaño del lienzo al volver.
   */
  active?: boolean;
  /**
   * Pedido entregado que se quiere revisar en el mapa: pinta el domicilio, la
   * sucursal de salida y la ruta que hizo el repartidor (tienda → domicilio).
   */
  focusedOrder?: FleetOrder | null;
  /** Quita el pedido enfocado del mapa. */
  onClearFocused?: () => void;
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
  const size = selected ? 46 : 38;
  const sel = selected ? 'ml-pin--sel' : '';
  const color = driverColor(driver);
  // Desactivados o sin señal se atenúan: su posición puede estar desactualizada.
  const dim = !driver.isActive || !isDriverOnline(driver);
  return `
    <div class="ml-pin ${sel}" style="width:${size}px;height:${size}px;--pin:${color};${dim ? 'opacity:.55;' : ''}">
      <span class="ml-pin-inner" style="font-size:${selected ? 24 : 20}px">🛵</span>
      <span class="ml-tip">${tipHtml(driver)}</span>
    </div>`;
}

/** Marcador de la dirección de entrega (casita), igual que en el cliente. */
function destPinHtml(): string {
  return `
    <div class="ml-dest" title="Dirección de entrega">
      <span class="ml-dest-inner">🏠</span>
    </div>`;
}

/** Marcador de la sucursal (punto de recogida), igual que en la app móvil. */
function branchPinHtml(): string {
  return `
    <div class="ml-branch" title="Sucursal de recogida">
      <span class="ml-branch-inner">🏪</span>
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
/** `fetch` de JSON con reintentos: el proveedor de tiles devuelve 502
 * transitorios que no deben tumbar el mapa. */
async function fetchJsonRetry(url: string, intentos = 5): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < intentos) await new Promise((r) => setTimeout(r, 300 * i));
    }
  }
  throw lastErr;
}

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
    // Los estilos propios van empaquetados en el proyecto (ruta local);
    // cualquier otra URL se resuelve contra el host de tiles.
    const local = opt.styleUrl.startsWith('/');
    const url = local ? opt.styleUrl : `${host}${new URL(opt.styleUrl).pathname}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Estilo ${url} → ${res.status}`);
    const text = await res.text();
    spec = JSON.parse(
      text.split('https://tiles.openfreemap.org').join(host),
    ) as StyleSpecification;
  } else {
    spec = opt.spec as StyleSpecification;
  }

  // Fuentes de glifos empaquetadas en el proyecto (ver public/map/fonts):
  // no se piden a la red al pintar las etiquetas.
  if (spec.glyphs) spec.glyphs = '/map/fonts/{fontstack}/{range}.pbf';
  // El sprite de OpenFreeMap también va empaquetado (pocos KB) para evitar
  // peticiones externas al pintar los iconos del mapa base.
  if (typeof spec.sprite === 'string' && spec.sprite.includes('ofm_f384')) {
    spec.sprite = '/map/sprites/ofm';
  } else if (typeof spec.sprite === 'string') {
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
      let tj: { tiles?: string[] } | null = null;
      try {
        tj = (await fetchJsonRetry(toBase(src.url))) as { tiles?: string[] };
      } catch (err) {
        // El proveedor devuelve 502 de forma intermitente. Se usa la copia
        // empaquetada en el proyecto para no dejar el mapa sin tiles.
        console.warn(
          '[delivery-admin:map] TileJSON en vivo no disponible, uso el empaquetado',
          src.url,
          err,
        );
        try {
          const res = await fetch('/map/tiles/planet.json');
          if (res.ok) tj = (await res.json()) as { tiles?: string[] };
        } catch {
          /* sin fallback */
        }
      }
      const tiles = tj?.tiles ?? [];
      if (!tiles.length) {
        throw new Error(`TileJSON sin tiles: ${src.url}`);
      }
      src.tiles = tiles.map(toBase);
      delete src.url;
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
  { drivers, hiddenIds, selectedId, onSelect, active = true, focusedOrder = null, onClearFocused },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  /**
   * Rutas reales (OSRM) de CADA repartidor con entrega activa, ya decodificadas
   * a [lng,lat] y indexadas por id de repartidor. Se calculan antes de pintarse:
   * mientras un repartidor no tenga entrada aquí, no se dibuja su línea.
   */
  const [routes, setRoutes] = useState<Record<number, LiveRouteData>>({});
  const routesRef = useRef(routes);
  routesRef.current = routes;
  /** Estado de cálculo por repartidor (feedback en el mapa). */
  const [routeState, setRouteState] = useState<
    Record<number, 'loading' | 'ok' | 'empty'>
  >({});
  /** Ruta completa tienda → domicilio del repartidor seleccionado. */
  const [fullRoute, setFullRoute] = useState<LiveRouteData | null>(null);
  const fullRouteRef = useRef(fullRoute);
  fullRouteRef.current = fullRoute;
  const markersRef = useRef<Map<number, Marker>>(new Map());
  /** Marcadores de destinos (casitas), independientes de los repartidores. */
  const destMarkersRef = useRef<Marker[]>([]);
  /** Marcador de la sucursal del repartidor seleccionado (punto de recogida). */
  const branchMarkerRef = useRef<Marker | null>(null);
  /** Marcadores del pedido entregado enfocado (domicilio + sucursal). */
  const focusedMarkersRef = useRef<Marker[]>([]);
  /** Ruta histórica tienda → domicilio del pedido enfocado (entregado). */
  const [focusedRoute, setFocusedRoute] = useState<LiveRouteData | null>(null);
  const focusedRouteRef = useRef(focusedRoute);
  focusedRouteRef.current = focusedRoute;
  const [focusedState, setFocusedState] = useState<
    'loading' | 'ok' | 'empty' | null
  >(null);
  const [styleOption, setStyleOption] = useState<MapStyleOption>(defaultStyleOption);
  const [styleReady, setStyleReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  /**
   * Nº de reintentos automáticos ya agotados al cargar el estilo/mapa. Se usa
   * solo para dar feedback en la pantalla de carga ("Reintentando conexión…").
   */
  const [styleAttempt, setStyleAttempt] = useState(0);
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
  /** Pedido entregado enfocado (mirror para handlers estables). */
  const focusedOrderRef = useRef(focusedOrder);
  focusedOrderRef.current = focusedOrder;
  /** id del estilo ya aplicado al mapa (evita re-setStyle en el montaje). */
  const appliedStyleIdRef = useRef<string | null>(null);

  // Repartidores con entrega activa: cada uno recibe su ruta por calles.
  /** Clave estable: refrescar las rutas cuando cambia la flota o algún pedido. */
  const fleetKey = drivers
    .filter((d) => d.activeAssignment)
    .map((d) => `${d.id}:${d.activeAssignment!.orderId}:${d.activeAssignment!.status}`)
    .sort()
    .join('|');
  const [routeTick, setRouteTick] = useState(0);
  /**
   * Clave de los marcadores visibles (repartidores + destinos con entrega
   * activa). Se usa para reencuadrar el mapa cuando cambia el conjunto de
   * marcadores, sin reajustar en cada movimiento (los ids no cambian).
   */
  const markersKey = drivers
    .filter((d) => d.location)
    .map((d) =>
      d.activeAssignment?.destination
        ? `${d.id}:${d.activeAssignment.destination.lat.toFixed(5)},${d.activeAssignment.destination.lng.toFixed(5)}`
        : String(d.id),
    )
    .sort()
    .join('|');
  /** Última clave de marcadores ya encuadrada (evita repetir el ajuste). */
  const fittedMarkersRef = useRef<string | null>(null);
  /** Repartidor seleccionado (para resaltar su ruta y mostrar su ruta completa). */
  const selectedDriver = drivers.find((d) => d.id === selectedId) ?? null;
  const selFullFrom =
    selectedDriver?.activeAssignment?.branchLocation &&
    selectedDriver.activeAssignment.destination
      ? `${selectedDriver.activeAssignment.branchLocation.lng},${selectedDriver.activeAssignment.branchLocation.lat}`
      : null;
  const selOrderIdForFull = selectedDriver?.activeAssignment?.orderId ?? null;

  // Resumen mostrado en el mapa: cuántas rutas hay y el detalle del seleccionado.
  const activeRouteCount = Object.keys(routes).length;
  const selState = selectedId != null ? routeState[selectedId] : undefined;
  const selRoute = selectedId != null ? routes[selectedId] : undefined;
  const selBadge =
    selState === 'loading'
      ? 'Calculando ruta…'
      : selState === 'empty'
        ? 'Ruta no disponible'
        : selRoute
          ? `Ruta: ${
              selRoute.distanceM >= 1000
                ? `${(selRoute.distanceM / 1000).toFixed(1)} km`
                : `${Math.round(selRoute.distanceM)} m`
            } · ≈ ${Math.max(1, Math.round(selRoute.durationS / 60))} min`
          : null;

  const overlaySourceId = 'fleet-overlays';

  // Ruta del pedido entregado enfocado (distancia y tiempo de OSRM).
  const focusedBadge =
    focusedState === 'loading'
      ? 'Calculando ruta…'
      : focusedState === 'empty'
        ? 'Ruta no disponible'
        : focusedRoute
          ? `${
              focusedRoute.distanceM >= 1000
                ? `${(focusedRoute.distanceM / 1000).toFixed(1)} km`
                : `${Math.round(focusedRoute.distanceM)} m`
            } · ≈ ${Math.max(1, Math.round(focusedRoute.durationS / 60))} min`
          : '—';

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
        'line-color': '#475569',
        'line-width': 3,
        'line-opacity': 0.7,
        'line-dasharray': [2, 6],
      },
    });
    // Contorno blanco bajo la ruta del repartidor: la hace visible sobre
    // cualquier base (verde de vegetación, gris de vías, etc.). El seleccionado
    // se dibuja más grueso.
    map.addLayer({
      id: 'ov-route-driver-casing',
      type: 'line',
      source: overlaySourceId,
      filter: ['==', ['get', 'kind'], 'route-driver'],
      paint: {
        'line-color': '#ffffff',
        'line-width': ['case', ['==', ['get', 'sel'], true], 11, 7],
        // Solo las rutas NO seleccionadas se atenúan.
        'line-opacity': ['case', ['==', ['get', 'dim'], true], 0.35, 1],
      },
    });
    map.addLayer({
      id: 'ov-route-driver',
      type: 'line',
      source: overlaySourceId,
      filter: ['==', ['get', 'kind'], 'route-driver'],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['==', ['get', 'sel'], true], 6, 4],
        // Sin selección, todas las rutas van a color pleno; al elegir un
        // repartidor las demás bajan para que la suya resalte.
        'line-opacity': ['case', ['==', ['get', 'dim'], true], 0.3, 1],
      },
    });
    // Ruta histórica de un pedido entregado (tienda → domicilio). Va encima de
    // todo con color propio para distinguirse de las rutas en vivo.
    map.addLayer({
      id: 'ov-route-order-casing',
      type: 'line',
      source: overlaySourceId,
      filter: ['==', ['get', 'kind'], 'route-order'],
      paint: {
        'line-color': '#ffffff',
        'line-width': 10,
        'line-opacity': 1,
      },
    });
    map.addLayer({
      id: 'ov-route-order',
      type: 'line',
      source: overlaySourceId,
      filter: ['==', ['get', 'kind'], 'route-order'],
      paint: {
        'line-color': '#7c3aed',
        'line-width': 5,
        'line-opacity': 1,
      },
    });
  }

  /** Recalcula el GeoJSON de overlays con los datos actuales. */
  function syncOverlays() {
    const map = mapRef.current;
    if (!map || !map.getSource(overlaySourceId)) return;

    const features: Feature[] = [];
    const dAll = driversRef.current;
    const selectedIdNow = selectedIdRef.current;
    const r = routesRef.current;
    const full = fullRouteRef.current;

    // Ruta real de CADA repartidor con entrega activa (OSRM). Si aún no se ha
    // calculado, no se dibuja nada (nunca una recta provisional).
    for (const d of dAll) {
      const a = d.activeAssignment;
      const route = r[d.id];
      if (!a || !route) continue;
      features.push({
        type: 'Feature',
        properties: {
          kind: 'route-driver',
          color: driverColor(d),
          sel: d.id === selectedIdNow,
          // Solo se atenúa cuando hay OTRO repartidor seleccionado: por defecto
          // todas las rutas se ven a color pleno.
          dim: selectedIdNow != null && d.id !== selectedIdNow,
        },
        geometry: { type: 'LineString', coordinates: route.coords },
      });
    }

    const sel = dAll.find((d) => d.id === selectedIdNow);
    // Ruta completa tienda → domicilio del seleccionado (también real).
    if (sel?.activeAssignment && full) {
      features.push({
        type: 'Feature',
        properties: { kind: 'route-full' },
        geometry: { type: 'LineString', coordinates: full.coords },
      });
    }
    // Ruta histórica del pedido entregado enfocado.
    const focused = focusedOrderRef.current;
    const fr = focusedRouteRef.current;
    if (focused?.destination && fr) {
      features.push({
        type: 'Feature',
        properties: { kind: 'route-order' },
        geometry: { type: 'LineString', coordinates: fr.coords },
      });
    }
    // La sucursal no es geometría: es un marcador (ver syncMarkers).

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
    for (const marker of destMarkersRef.current) marker.remove();
    destMarkersRef.current = [];
    branchMarkerRef.current?.remove();
    branchMarkerRef.current = null;
    for (const marker of focusedMarkersRef.current) marker.remove();
    focusedMarkersRef.current = [];
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

    // Casitas de destino (una por coordenada, aunque varios repartidores
    // entreguen en el mismo punto).
    const seenDests = new Set<string>();
    for (const d of driversRef.current) {
      if (hiddenIdsRef.current.has(d.id)) continue;
      const dest = d.activeAssignment?.destination;
      if (!dest) continue;
      const key = `${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}`;
      if (seenDests.has(key)) continue;
      seenDests.add(key);
      const holder = document.createElement('div');
      holder.innerHTML = destPinHtml();
      const destEl = holder.firstElementChild as HTMLElement;
      const marker = new maplibregl.Marker({ element: destEl, anchor: 'center' })
        .setLngLat([dest.lng, dest.lat])
        .addTo(map);
      destMarkersRef.current.push(marker);
    }

    // Sucursal del repartidor seleccionado: dónde recoge el pedido.
    const sel = driversRef.current.find((d) => d.id === selectedNow);
    const branch = sel?.activeAssignment?.branchLocation;
    if (sel && branch && !hiddenIdsRef.current.has(sel.id)) {
      const holder = document.createElement('div');
      holder.innerHTML = branchPinHtml();
      const branchEl = holder.firstElementChild as HTMLElement;
      branchMarkerRef.current = new maplibregl.Marker({
        element: branchEl,
        anchor: 'center',
      })
        .setLngLat([branch.lng, branch.lat])
        .addTo(map);
    }

    // Pedido entregado enfocado: domicilio y sucursal de salida.
    const focused = focusedOrderRef.current;
    if (focused) {
      const fdest = focused.destination;
      if (fdest) {
        const holder = document.createElement('div');
        holder.innerHTML = destPinHtml();
        const el = holder.firstElementChild as HTMLElement;
        el.title = 'Dirección de entrega (pedido entregado)';
        focusedMarkersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([fdest.lng, fdest.lat])
            .addTo(map),
        );
      }
      const fbranch = focused.branchLocation;
      if (fbranch) {
        const holder = document.createElement('div');
        holder.innerHTML = branchPinHtml();
        const el = holder.firstElementChild as HTMLElement;
        focusedMarkersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([fbranch.lng, fbranch.lat])
            .addTo(map),
        );
      }
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
    let retryTimer: number | null = null;
    /** Reintentos automáticos acumulados antes de rendirse y mostrar el aviso. */
    let attempt = 0;
    const MAX_ATTEMPTS = 5;

    const clearTimers = () => {
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    /** Desmonta el mapa actual (si lo hay) para reconstruirlo desde cero. */
    const teardownMap = () => {
      clearTimers();
      if (map) {
        map.remove();
        map = null;
      }
      mapRef.current = null;
      markersRef.current.clear();
      destMarkersRef.current = [];
      branchMarkerRef.current = null;
      focusedMarkersRef.current = [];
    };

    /**
     * Reintenta cargar el estilo automáticamente con backoff. Solo cuando se
     * agotan los intentos se muestra el aviso: un fallo transitorio de red no
     * debe dejar al usuario con la pantalla de error.
     */
    const scheduleRetry = () => {
      if (cancelled) return;
      if (attempt >= MAX_ATTEMPTS) {
        setMapError(
          'No se pudo cargar el estilo del mapa. Revisa tu conexión o el bloqueador de anuncios.',
        );
        return;
      }
      teardownMap();
      setStyleReady(false);
      setStyleAttempt(attempt);
      const delay = Math.min(800 * attempt, 4000);
      console.warn(
        `[delivery-admin:map] reintento ${attempt + 1}/${MAX_ATTEMPTS} en ${delay} ms`,
      );
      retryTimer = window.setTimeout(bootMap, delay);
    };

    const bootMap = () => {
      if (cancelled) return;
      attempt += 1;
      void resolveStyle(styleOptionRef.current)
        .then((style) => {
          if (cancelled || !style) return;
          // El estilo resolvió: se parte de cero para futuros reintentos.
          attempt = 0;
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

          let vectorTileErrors = 0;
          map.on('click', () => onSelectRef.current(null));
          map.on('load', () => {
            ensureOverlayLayers(map!);
            syncOverlays();
            syncMarkers();
            applyStyleZoom();
            setStyleReady(true);
          });
          map.on('style.load', () => {
            ensureOverlayLayers(map!);
            syncOverlays();
            applyStyleZoom();
            // El estilo ya está listo: se muestra el mapa de una vez. Los tiles
            // siguen llegando (la red puede tardar); no se bloquea la pantalla
            // de carga esperándolos.
            setStyleAttempt(0);
            setStyleReady(true);
          });
          map.on('error', (e) => {
            const err = (e?.error ?? {}) as { message?: string; url?: string };
            const msg = String(err?.message ?? '');
            const url = String(err?.url ?? '');
            // Tiles vectoriales del estilo Waze: si fallan repetido, se pasa al
            // mapa raster Estándar (otra fuente) para no quedarse en blanco.
            if (url.includes('/planet/')) {
              vectorTileErrors += 1;
              if (vectorTileErrors >= 6 && styleOptionRef.current.id === 'waze') {
                console.warn(
                  '[delivery-admin:map] los tiles vectoriales no cargan — cambio a Estándar (raster)',
                );
                setStyleOption(
                  MAP_STYLE_OPTIONS.find((o) => o.id === 'standard') ??
                    styleOptionRef.current,
                );
              }
              return;
            }
            if (/\.(png|webp|jpg|jpeg)(\?|$)/.test(url)) return;
            console.warn('[delivery-admin:map]', msg || url || e);
          });

          mapRef.current = map;
        })
        .catch((err) => {
          console.error('[delivery-admin:map] no se pudo resolver el estilo:', err);
          scheduleRetry();
        });
    };

    bootMap();

    return () => {
      cancelled = true;
      clearTimers();
      if (map) map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      destMarkersRef.current = [];
      setStyleReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Al volver a la pestaña del mapa, el contenedor pasa de `display:none` a
   * tener tamaño otra vez. MapLibre no detecta cambios de tamaño del contenedor
   * (solo de la ventana), así que hay que avisarle o el lienzo queda a 0×0.
   */
  useEffect(() => {
    if (!active) return;
    const map = mapRef.current;
    if (!map) return;
    const raf = requestAnimationFrame(() => map.resize());
    return () => cancelAnimationFrame(raf);
  }, [active]);

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

  // ── Rutas por calles de TODOS los repartidores con entrega activa ──
  // La ruta se calcula y solo entonces se pinta (nunca una recta provisional).
  useEffect(() => {
    const targets = driversRef.current.filter(
      (d) => d.activeAssignment && d.location,
    );
    if (!targets.length) {
      setRoutes({});
      setRouteState({});
      return;
    }
    let cancelled = false;
    setRouteState((prev) => {
      const next: Record<number, 'loading' | 'ok' | 'empty'> = { ...prev };
      for (const d of targets) next[d.id] = 'loading';
      return next;
    });

    const loadOne = async (d: FleetDriver) => {
      const a = d.activeAssignment!;
      const loc = d.location!;
      const target: 'customer' | 'store' =
        a.status === 'ASSIGNED' ||
        a.status === 'ACCEPTED' ||
        a.status === 'READY_FOR_PICKUP'
          ? 'store'
          : 'customer';
      try {
        const res = await api.orderRoute(
          a.orderId,
          target,
          `${loc.lng},${loc.lat}`,
        );
        const coords = decodePolyline(res.polyline);
        if (coords.length < 2) return [d.id, null, 'empty'] as const;
        return [
          d.id,
          { coords, distanceM: res.distanceM, durationS: res.durationS },
          'ok',
        ] as const;
      } catch {
        return [d.id, null, 'empty'] as const;
      }
    };

    void Promise.all(targets.map(loadOne)).then((entries) => {
      if (cancelled) return;
      const nextRoutes: Record<number, LiveRouteData> = {};
      const nextState: Record<number, 'loading' | 'ok' | 'empty'> = {};
      for (const [id, route, state] of entries) {
        if (route) nextRoutes[id] = route;
        nextState[id] = state;
      }
      setRoutes(nextRoutes);
      setRouteState(nextState);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetKey, routeTick]);

  // La ruta no necesita recalcularse en cada ping: cada 30 s es suficiente.
  useEffect(() => {
    const t = setInterval(() => setRouteTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [fleetKey]);

  // Ruta completa (tienda → domicilio) solo del repartidor seleccionado.
  useEffect(() => {
    if (selOrderIdForFull == null) {
      setFullRoute(null);
      return;
    }
    const orderId = selOrderIdForFull;
    const from = selFullFrom;
    if (!from) {
      setFullRoute(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.orderRoute(orderId, 'customer', from);
        const coords = decodePolyline(res.polyline);
        if (cancelled) return;
        setFullRoute(
          coords.length >= 2
            ? { coords, distanceM: res.distanceM, durationS: res.durationS }
            : null,
        );
      } catch {
        if (!cancelled) setFullRoute(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selOrderIdForFull, selFullFrom, routeTick]);

  // ── Pedido entregado enfocado: ruta histórica tienda → domicilio ──
  useEffect(() => {
    const dest = focusedOrder?.destination ?? null;
    const branch = focusedOrder?.branchLocation ?? null;
    if (!focusedOrder || !dest || !branch) {
      setFocusedRoute(null);
      setFocusedState(null);
      return;
    }
    let cancelled = false;
    setFocusedState('loading');
    (async () => {
      try {
        const res = await api.orderRoute(
          focusedOrder.orderId,
          'customer',
          `${branch.lng},${branch.lat}`,
        );
        const coords = decodePolyline(res.polyline);
        if (cancelled) return;
        if (coords.length < 2) {
          setFocusedRoute(null);
          setFocusedState('empty');
          return;
        }
        setFocusedRoute({ coords, distanceM: res.distanceM, durationS: res.durationS });
        setFocusedState('ok');
      } catch {
        if (!cancelled) {
          setFocusedRoute(null);
          setFocusedState('empty');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusedOrder]);

  // Encuadre del pedido enfocado: abarca el domicilio y la sucursal de salida.
  const focusedFitKey = focusedOrder ? String(focusedOrder.orderId) : '';
  const fittedFocusedRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    if (!focusedOrder) {
      fittedFocusedRef.current = null;
      return;
    }
    if (fittedFocusedRef.current === focusedFitKey) return;
    const pts: [number, number][] = [];
    if (focusedOrder.destination) {
      pts.push([focusedOrder.destination.lng, focusedOrder.destination.lat]);
    }
    if (focusedOrder.branchLocation) {
      pts.push([focusedOrder.branchLocation.lng, focusedOrder.branchLocation.lat]);
    }
    if (!pts.length) return;
    fittedFocusedRef.current = focusedFitKey;
    if (pts.length === 1) {
      map.easeTo({
        center: pts[0],
        zoom: Math.max(map.getZoom(), 15),
        duration: 700,
      });
      return;
    }
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 90, maxZoom: 15, duration: 700 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedOrder, styleReady, focusedFitKey]);

  // ── Enfoque: abarcar los marcadores activos (repartidores + destinos) ──
  // Se ajusta cuando cambia el conjunto de marcadores (no en cada movimiento,
  // porque la clave usa los ids y las coordenadas del destino, que son fijas).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    if (fittedMarkersRef.current === markersKey) return;

    const pts: [number, number][] = [];
    for (const d of driversRef.current) {
      if (!d.location || hiddenIdsRef.current.has(d.id)) continue;
      pts.push([d.location.lng, d.location.lat]);
      const dest = d.activeAssignment?.destination;
      if (dest) pts.push([dest.lng, dest.lat]);
    }
    if (!pts.length) return;
    fittedMarkersRef.current = markersKey;

    if (pts.length === 1) {
      map.easeTo({
        center: pts[0],
        zoom: Math.max(map.getZoom(), 13.5),
        duration: 600,
      });
      return;
    }
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 80, maxZoom: 14.5, duration: 600 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleReady, markersKey]);

  // ── Overlays: rutas y paradas ──
  useEffect(() => {
    if (!styleReady) return;
    syncOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, hiddenIds, selectedId, styleReady, routes, fullRoute, focusedOrder, focusedRoute]);

  // ── Pines de repartidores ──
  useEffect(() => {
    if (!styleReady) return;
    syncMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, hiddenIds, selectedId, styleReady, focusedOrder]);

  // ── Encuadre al seleccionar ──
  /**
   * Clave del encuadre de la selección: repartidor + coordenadas del destino.
   * NO incluye la posición del repartidor a propósito: cambia en cada ping GPS y
   * reencuadrar el mapa a cada rato pelearía con el usuario.
   */
  const selFitKey = `${selectedId ?? ''}|${
    selectedDriver?.activeAssignment?.destination
      ? `${selectedDriver.activeAssignment.destination.lat.toFixed(5)},${selectedDriver.activeAssignment.destination.lng.toFixed(5)}`
      : ''
  }`;
  const fittedSelectionRef = useRef<string | null>(null);

  /**
   * Al seleccionar un repartidor se encuadran él, la casa del cliente y la
   * sucursal de recogida. Centrar solo en el repartidor dejaba el destino fuera
   * de pantalla (aquí a 3,8 km), y parecía que la dirección no existía.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (selectedId == null) {
      // Al deseleccionar se olvida el encuadre para que volver a pulsar el
      // mismo repartidor lo centre otra vez.
      fittedSelectionRef.current = null;
      return;
    }
    if (fittedSelectionRef.current === selFitKey) return;

    const d = drivers.find((x) => x.id === selectedId);
    if (!d) return;

    const pts: [number, number][] = [];
    if (d.location) pts.push([d.location.lng, d.location.lat]);
    const dest = d.activeAssignment?.destination;
    if (dest) pts.push([dest.lng, dest.lat]);
    // La sucursal también: es el inicio de la ruta completa que se dibuja.
    const branch = d.activeAssignment?.branchLocation;
    if (branch) pts.push([branch.lng, branch.lat]);
    // Sin GPS ni destino no hay nada que encuadrar (p. ej. repartidor de baja).
    if (!pts.length) return;

    fittedSelectionRef.current = selFitKey;

    if (pts.length === 1) {
      map.easeTo({
        center: pts[0],
        zoom: Math.max(map.getZoom(), 15),
        duration: 700,
      });
      return;
    }

    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 90, maxZoom: 15, duration: 700 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selFitKey]);

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

      {/* Pantalla de carga: solo cubre la sección del mapa mientras inicializa */}
      {!styleReady && !mapError && (
        <div className="absolute inset-0 z-600 flex flex-col items-center justify-center gap-3 bg-surface-3">
          <Loader2 className="h-7 w-7 animate-spin text-ink-faint" />
          <p className="text-xs font-semibold text-ink-faint">
            {styleAttempt > 0 ? 'Reintentando conexión…' : 'Cargando mapa…'}
          </p>
        </div>
      )}

      {/* Selector de capas (esquina inferior izquierda) */}
      <button
        ref={layerButtonRef}
        onClick={() => setLayersOpen((o) => !o)}
        title="Cambiar estilo del mapa"
        className={`absolute bottom-6 left-4 z-500 flex h-10 w-10 items-center justify-center rounded-xl shadow-lg ring-1 transition ${
          layersOpen
            ? 'bg-invert text-invert-ink ring-slate-900'
            : 'bg-surface text-ink-soft ring-line hover:text-ink'
        }`}
      >
        <Layers className="h-4.5 w-4.5" />
      </button>

      {layersOpen && (
        <div
          ref={layerPanelRef}
          className="absolute bottom-[4.4rem] left-4 z-500 w-60 rounded-2xl bg-surface p-1.5 shadow-xl ring-1 ring-line"
        >
          <p className="px-2.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
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
                  ? 'bg-accent-soft text-ink'
                  : 'text-ink-soft hover:bg-surface-2'
              }`}
            >
              <span
                className="h-6 w-9 shrink-0 rounded-md ring-1 ring-line"
                style={{ background: opt.swatch }}
              />
              {opt.name}
              {styleOption.id === opt.id && (
                <Check className="ml-auto h-3.5 w-3.5 text-accent" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Resumen de rutas activas + estado del seleccionado */}
      {activeRouteCount > 0 && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-500 flex -translate-x-1/2 items-center gap-2 rounded-full bg-surface/95 px-3 py-1.5 text-[11px] font-bold text-ink-soft shadow-lg ring-1 ring-line">
          <span>
            {activeRouteCount === 1
              ? '1 ruta activa'
              : `${activeRouteCount} rutas activas`}
          </span>
          {selBadge && (
            <span className="text-ink-faint">· {selBadge}</span>
          )}
        </div>
      )}

      {/* Pedido entregado enfocado: domicilio, sucursal y ruta con su tiempo */}
      {focusedOrder && (
        <div className="absolute left-4 top-4 z-500 w-72 overflow-hidden rounded-2xl bg-surface shadow-xl ring-1 ring-line">
          <div className="flex items-start justify-between gap-2 border-b border-line px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-bold text-ink">
                {focusedOrder.referenceCode}
              </p>
              <p className="text-[11px] text-ink-faint">
                Entregado
                {focusedOrder.completedAt
                  ? ` · ${formatDateTime(focusedOrder.completedAt)}`
                  : ''}
              </p>
            </div>
            <button
              onClick={() => onClearFocused?.()}
              title="Quitar del mapa"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-3 hover:text-ink-soft"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2 px-3.5 py-3 text-xs">
            <p className="flex items-start gap-2 text-ink-soft">
              <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <span className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                  Repartidor
                </span>
                {focusedOrder.driverName}
              </span>
            </p>
            <p className="flex items-start gap-2 text-ink-soft">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <span className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                  Dirección de entrega
                </span>
                {[focusedOrder.addressLine1, focusedOrder.city].filter(Boolean).join(', ') ||
                  'Sin dirección'}
              </span>
            </p>
            <p className="flex items-start gap-2 text-ink-soft">
              <Store className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <span className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                  Sucursal de salida
                </span>
                {focusedOrder.branchName ?? '—'}
              </span>
            </p>
            <p className="flex items-center gap-2 border-t border-line pt-2 text-ink">
              <Route className="h-3.5 w-3.5 shrink-0 text-violet-600" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                Ruta
              </span>
              <span className="ml-auto font-bold">{focusedBadge}</span>
            </p>
          </div>
        </div>
      )}

      {/* Aviso si el mapa no pudo renderizar (WebGL / carga del estilo) */}
      {mapError && (
        <div className="absolute inset-0 z-500 flex items-center justify-center bg-surface-3/95">
          <div className="mx-4 max-w-md rounded-2xl bg-surface p-6 text-center shadow-xl ring-1 ring-line">
            <p className="text-3xl">🗺️</p>
            <h3 className="mt-2 text-sm font-bold text-ink">El mapa no se pudo mostrar</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{mapError}</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={fallbackStandard}
                className="rounded-xl bg-invert px-3.5 py-2 text-xs font-bold text-invert-ink transition hover:bg-invert/90"
              >
                Usar mapa Estándar
              </button>
              <button
                onClick={() => window.location.reload()}
                className="rounded-xl border border-line px-3.5 py-2 text-xs font-bold text-ink-soft transition hover:bg-surface-2"
              >
                Recargar página
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Indicador de capa activa (esquina inferior derecha) */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-500 flex items-center gap-1.5 rounded-full bg-surface/90 px-2.5 py-1 text-[10px] font-semibold text-ink-faint shadow ring-1 ring-line">
        <span className={`h-1.5 w-1.5 rounded-full ${styleReady ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
        {styleReady ? styleOption.name : 'Cargando mapa…'}
      </div>
    </div>
  );
});

export default FleetMap;
