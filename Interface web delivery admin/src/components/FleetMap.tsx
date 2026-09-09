import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import L from 'leaflet';
import { Check, Layers } from 'lucide-react';
import type { FleetDriver } from '../types';
import { driverVisual, STATUS_META } from '../lib/status';

export interface FleetMapHandle {
  recenter: () => void;
}

interface Props {
  drivers: FleetDriver[];
  hiddenIds: Set<number>;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

interface LayerDef {
  id: string;
  name: string;
  /** Una o más tile layers apiladas (p. ej. Base + Reference de Esri). */
  urls: string[];
  attribution: string;
  maxZoom?: number;
  swatch: string;
  /** Filtro CSS opcional aplicado a los tiles (p. ej. estilo Waze). */
  filter?: string;
}

/**
 * Capas base disponibles. Todas son gratuitas y SIN API key (verificado
 * contra los servidores de tiles: HTTP 200 sin autenticación).
 * Nota: las capas de CARTO ya NO se usan porque desde ago/2026 piden
 * API key (muestran watermark "API KEY REQUIRED").
 */
const LAYERS: LayerDef[] = [
  {
    id: 'standard',
    name: 'Estándar',
    urls: ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    swatch: 'linear-gradient(135deg,#b8d8a5 0%,#e6e9dd 55%,#f4f7f6 100%)',
  },
  {
    id: 'streets',
    name: 'Calles · estilo Waze',
    urls: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ',
    // Waze: mapa casi acromático, fondo pálido y calles blancas marcadas.
    // Se desaturan los colores de terreno de Esri para lograr ese look.
    filter: 'saturate(0.45) brightness(1.05) contrast(1.05)',
    swatch: 'linear-gradient(#ffffff 0 0) 50% 35%/80% 2px no-repeat, linear-gradient(#ffffff 0 0) 50% 55%/60% 2px no-repeat, #d6d6d6',
  },
  {
    id: 'light',
    name: 'Claro',
    // Fondo gris claro + calles OSCURAS (Transportation) + nombres de lugares.
    urls: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    maxZoom: 18,
    swatch:
      'linear-gradient(#454a50 0 0) 50% 35%/75% 2px no-repeat, linear-gradient(#454a50 0 0) 50% 60%/50% 2px no-repeat, #f2f1ee',
  },
  {
    id: 'dark',
    name: 'Oscuro',
    // Base (fondo gris oscuro) + Reference (calles y etiquetas claras).
    urls: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    maxZoom: 18,
    swatch:
      'linear-gradient(#c9ced6 0 0) 50% 35%/75% 2px no-repeat, linear-gradient(#c9ced6 0 0) 50% 60%/50% 2px no-repeat, #26292e',
  },
  {
    id: 'satellite',
    name: 'Satélite',
    urls: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Tiles &copy; Esri &mdash; Maxar, Earthstar Geographics',
    swatch: 'linear-gradient(135deg,#3f6d4e 0%,#6f8f5f 55%,#9aa06b 100%)',
  },
  {
    id: 'terrain',
    name: 'Relieve',
    urls: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · SRTM · <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
    swatch: 'linear-gradient(135deg,#bcd6a4 0%,#e9e6cf 55%,#a8c4d8 100%)',
  },
];

const LAYER_STORAGE_KEY = 'delivery_admin_map_layer_v2';

/** Enfoque del mapa: la operación de delivery es solo en Manizales. */
const MANIZALES_CENTER: [number, number] = [5.067, -75.517];
const MANIZALES_BOUNDS: L.LatLngBoundsExpression = [
  [4.97, -75.6], // SW (incluye Villamaría y margen rural)
  [5.14, -75.4], // NE
];

function buildIcon(
  driver: FleetDriver,
  selected: boolean,
): L.DivIcon {
  const visual = driverVisual(driver);
  const size = selected ? 46 : 34;
  return L.divIcon({
    className: '',
    html: `
      <div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">
        <div style="width:100%;height:100%;border-radius:9999px;background:${visual.color};
          border:3px solid ${selected ? '#0f172a' : '#ffffff'};
          box-shadow:0 3px 10px rgba(15,23,42,.4);
          display:flex;align-items:center;justify-content:center;color:#fff;
          font-weight:800;font-size:${selected ? 14 : 11}px;letter-spacing:.5px;
          ${driver.isActive ? '' : 'opacity:.55;'}"
        >${driver.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>
      </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

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

const FleetMap = forwardRef<FleetMapHandle, Props>(function FleetMap(
  { drivers, hiddenIds, selectedId, onSelect },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRefs = useRef<L.TileLayer[]>([]);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const routesRef = useRef<L.LayerGroup | null>(null);
  const destsRef = useRef<L.LayerGroup | null>(null);

  const [activeLayer, setActiveLayer] = useState<string>(() => {
    const saved = localStorage.getItem(LAYER_STORAGE_KEY);
    // Por defecto la capa tipo Waze (Calles).
    return LAYERS.some((l) => l.id === saved) ? (saved as string) : 'streets';
  });
  const [layersOpen, setLayersOpen] = useState(false);
  const layerButtonRef = useRef<HTMLButtonElement | null>(null);
  const layerPanelRef = useRef<HTMLDivElement | null>(null);

  // Refs espejo para usar dentro de handlers estables.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // ── Inicialización del mapa ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      zoomControl: true,
      attributionControl: true,
      maxBounds: MANIZALES_BOUNDS,
      maxBoundsViscosity: 0.9,
      minZoom: 13,
      maxZoom: 18,
    });
    map.setView(MANIZALES_CENTER, 14);

    routesRef.current = L.layerGroup().addTo(map);
    destsRef.current = L.layerGroup().addTo(map);

    map.on('click', () => onSelectRef.current(null));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      tileRefs.current = [];
      markersRef.current.clear();
      routesRef.current = null;
      destsRef.current = null;
    };
  }, []);

  // ── Capa base (estilo del mapa) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const tile of tileRefs.current) {
      map.removeLayer(tile);
    }
    tileRefs.current = [];

    const def = LAYERS.find((l) => l.id === activeLayer) ?? LAYERS[0];
    const maxZoom = def.maxZoom ?? 19;
    for (const url of def.urls) {
      tileRefs.current.push(
        L.tileLayer(url, {
          maxZoom,
          attribution: def.attribution,
          detectRetina: true,
        }).addTo(map),
      );
    }
    // Filtro CSS del estilo (no afecta pines/rutas, solo la capa de tiles).
    const tilePane = map.getPane('tilePane');
    if (tilePane) tilePane.style.filter = def.filter ?? 'none';
    // Si la capa no llega al zoom actual, se acomoda para no dejar el mapa en blanco.
    if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
  }, [activeLayer]);

  // ── Persistir la preferencia de capa ──
  useEffect(() => {
    localStorage.setItem(LAYER_STORAGE_KEY, activeLayer);
  }, [activeLayer]);

  // ── Cerrar el selector de capas al hacer click fuera ──
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

  // ── Pines de repartidores ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = markersRef.current;
    const visible = new Set<number>();

    for (const d of drivers) {
      if (!d.location || hiddenIds.has(d.id)) continue;
      visible.add(d.id);
      const selected = selectedIdRef.current === d.id;
      const icon = buildIcon(d, selected);

      let marker = markers.get(d.id);
      if (!marker) {
        marker = L.marker([d.location.lat, d.location.lng], { icon, zIndexOffset: selected ? 1000 : 0 });
        marker.bindTooltip(tipHtml(d), { direction: 'top', offset: [0, -18], className: 'fleet-tip' });
        marker.on('click', () => onSelectRef.current(d.id));
        marker.addTo(map);
        markers.set(d.id, marker);
      } else {
        marker.setLatLng([d.location.lat, d.location.lng]);
        marker.setIcon(icon);
        marker.setZIndexOffset(selected ? 1000 : 0);
        marker.setTooltipContent(tipHtml(d));
      }
    }

    for (const [id, marker] of markers) {
      if (!visible.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
  }, [drivers, hiddenIds, selectedId]);

  // ── Puntos de destino de todos los visibles con pedido activo ──
  useEffect(() => {
    const layer = destsRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const d of drivers) {
      const dest = d.activeAssignment?.destination;
      if (!dest || hiddenIds.has(d.id)) continue;
      L.circleMarker([dest.lat, dest.lng], {
        radius: 4,
        color: '#475569',
        weight: 1,
        fillColor: '#e2e8f0',
        fillOpacity: 1,
      }).addTo(layer);
    }
  }, [drivers, hiddenIds]);

  // ── Ruta + paradas del repartidor seleccionado ──
  useEffect(() => {
    const map = mapRef.current;
    const layer = routesRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const sel = drivers.find((d) => d.id === selectedId);
    if (!sel?.activeAssignment) return;

    const { status, branchLocation, destination, branchName, customerName } =
      sel.activeAssignment;

    // Dirección actual según el estado: tienda (recogida) o cliente (entrega).
    const target =
      status === 'ASSIGNED' || status === 'ACCEPTED' || status === 'READY_FOR_PICKUP'
        ? branchLocation
        : destination;

    if (sel.location && target) {
      L.polyline(
        [
          [sel.location.lat, sel.location.lng],
          [target.lat, target.lng],
        ],
        {
          color: STATUS_META[status]?.color ?? '#2563eb',
          weight: 3,
          opacity: 0.9,
          dashArray: '8 10',
        },
      ).addTo(layer);
    }

    // Corredor completo tienda → cliente.
    if (branchLocation && destination) {
      L.polyline(
        [
          [branchLocation.lat, branchLocation.lng],
          [destination.lat, destination.lng],
        ],
        { color: '#94a3b8', weight: 2, opacity: 0.55, dashArray: '4 8' },
      ).addTo(layer);
    }

    if (branchLocation) {
      L.circleMarker([branchLocation.lat, branchLocation.lng], {
        radius: 8,
        color: '#d97706',
        weight: 2.5,
        fillColor: '#fef3c7',
        fillOpacity: 1,
      })
        .addTo(layer)
        .bindTooltip(`Tienda: ${branchName ?? 'sucursal'}`, {
          direction: 'top',
          className: 'fleet-tip',
        });
    }

    if (destination) {
      L.circleMarker([destination.lat, destination.lng], {
        radius: 8,
        color: '#16a34a',
        weight: 2.5,
        fillColor: '#dcfce7',
        fillOpacity: 1,
      })
        .addTo(layer)
        .bindTooltip(`Cliente: ${customerName ?? 'destino'}`, {
          direction: 'top',
          className: 'fleet-tip',
        });
    }
  }, [drivers, selectedId]);

  // ── Centrar al seleccionar ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || selectedId == null) return;
    const d = drivers.find((x) => x.id === selectedId);
    if (d?.location) {
      map.flyTo([d.location.lat, d.location.lng], Math.max(map.getZoom(), 15), {
        duration: 0.7,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── API imperativa: recenter (enfoca Manizales) ──
  useImperativeHandle(ref, () => ({
    recenter() {
      const map = mapRef.current;
      if (!map) return;
      map.fitBounds(MANIZALES_BOUNDS, { padding: [30, 30], maxZoom: 15 });
    },
  }));

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
          className="absolute bottom-[4.4rem] left-4 z-500 w-56 rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-slate-200"
        >
          <p className="px-2.5 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Estilo del mapa
          </p>
          {LAYERS.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                setActiveLayer(l.id);
                setLayersOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                activeLayer === l.id
                  ? 'bg-amber-50 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span
                className="h-6 w-9 shrink-0 rounded-md ring-1 ring-slate-200"
                style={{ background: l.swatch }}
              />
              {l.name}
              {activeLayer === l.id && (
                <Check className="ml-auto h-3.5 w-3.5 text-amber-500" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default FleetMap;
