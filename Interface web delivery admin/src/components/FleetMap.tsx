import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import L from 'leaflet';
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

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_CENTER: [number, number] = [5.067, -75.517]; // Manizales

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
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const routesRef = useRef<L.LayerGroup | null>(null);
  const destsRef = useRef<L.LayerGroup | null>(null);

  // Refs espejo para usar dentro de handlers estables.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const driversRef = useRef(drivers);
  driversRef.current = drivers;
  const hiddenIdsRef = useRef(hiddenIds);
  hiddenIdsRef.current = hiddenIds;

  // ── Inicialización del mapa ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, { zoomControl: true, attributionControl: true });
    map.setView(DEFAULT_CENTER, 13);
    L.tileLayer(TILES, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    routesRef.current = L.layerGroup().addTo(map);
    destsRef.current = L.layerGroup().addTo(map);

    map.on('click', () => onSelectRef.current(null));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      routesRef.current = null;
      destsRef.current = null;
    };
  }, []);

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

  // ── API imperativa: recenter ──
  useImperativeHandle(ref, () => ({
    recenter() {
      const map = mapRef.current;
      if (!map) return;
      const points: [number, number][] = [];
      for (const d of driversRef.current) {
        if (d.location && !hiddenIdsRef.current.has(d.id)) {
          points.push([d.location.lat, d.location.lng]);
        }
      }
      if (!points.length) return;
      map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 15 });
    },
  }));

  return <div ref={containerRef} className="h-full w-full" />;
});

export default FleetMap;
