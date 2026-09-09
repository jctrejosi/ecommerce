import type { StyleSpecification, FilterSpecification } from 'maplibre-gl';

/**
 * Estilos de mapa para MapLibre GL.
 *
 * Los estilos "Waze" son una recreación vectorial del look de la app Waze
 * (fondo neutro, calles blancas con casing gris y vías principales con
 * acento amarillo). Se renderizan con tiles vectoriales de OpenFreeMap
 * (gratis, sin API key, schema OpenMapTiles). El estilo oficial de Waze no
 * es público/distribuible (Waze retiró su tile-server en 2023).
 */

export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const VECTOR_SOURCE_URL = 'https://tiles.openfreemap.org/planet';

interface Palette {
  bg: string;
  landuse: string;
  park: string;
  water: string;
  waterway: string;
  building: string;
  /** [casing, fill] por nivel de vía */
  roadMinor: [string, string];
  roadSecondary: [string, string];
  roadPrimary: [string, string];
  roadHighway: [string, string];
  roadPath: [string, string];
  label: string;
  labelHalo: string;
  place: string;
  roadNameSizeBoost: number;
}

const WAZE_LIGHT: Palette = {
  bg: '#f2f3f4',
  landuse: '#e7e9eb',
  park: '#d4e2cb',
  water: '#bcd6ea',
  waterway: '#a5c8e2',
  building: '#dfe2e5',
  roadMinor: ['#c8ccd1', '#ffffff'],
  roadSecondary: ['#aab0b7', '#ffffff'],
  roadPrimary: ['#959ca4', '#ffffff'],
  roadHighway: ['#e3b341', '#ffe9ad'],
  roadPath: ['#e2e5e8', '#ffffff'],
  label: '#33393f',
  labelHalo: '#ffffff',
  place: '#4a525a',
  roadNameSizeBoost: 1,
};

const WAZE_DARK: Palette = {
  bg: '#181a1f',
  landuse: '#1f2228',
  park: '#20281f',
  water: '#202f40',
  waterway: '#223849',
  building: '#23262d',
  roadMinor: ['#0c0e11', '#33373d'],
  roadSecondary: ['#0a0c0e', '#3d424a'],
  roadPrimary: ['#07090b', '#4a505a'],
  roadHighway: ['#5c470f', '#f5c84c'],
  roadPath: ['#0e1013', '#262a2f'],
  label: '#e6e8ea',
  labelHalo: '#181a1f',
  place: '#c9ced4',
  roadNameSizeBoost: 1.05,
};

/** Filtro clásico OMT: vías lineales que no sean ramp. */
const lineFilter = (cls: string): FilterSpecification => [
  'all',
  ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
  ['==', ['get', 'class'], cls],
  ['!=', ['get', 'ramp'], 1],
];

/** OSM/OpenTopoMap no aceptan {s}: subdominios explícitos. */
const OSM_TILES = [
  'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
  'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
  'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
];
const TOPO_TILES = [
  'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
  'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
  'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
];

const width = (min: number, z6: number, z14: number, z20: number) =>
  [
    'interpolate',
    ['exponential', 1.3],
    ['zoom'],
    min,
    0,
    6,
    z6,
    14,
    z14,
    20,
    z20,
  ] as unknown as number;

function buildWazeSpec(palette: Palette, dark: boolean): StyleSpecification {
  const [minorC, minorF] = palette.roadMinor;
  const [secC, secF] = palette.roadSecondary;
  const [primC, primF] = palette.roadPrimary;
  const [hwC, hwF] = palette.roadHighway;
  const [pathC, pathF] = palette.roadPath;

  const roadColor = (cls: string) => {
    switch (cls) {
      case 'motorway':
      case 'trunk':
        return hwF;
      case 'primary':
        return primF;
      case 'secondary':
      case 'tertiary':
        return secF;
      case 'path':
      case 'track':
        return pathF;
      default:
        return minorF;
    }
  };
  const casingColor = (cls: string) => {
    switch (cls) {
      case 'motorway':
      case 'trunk':
        return hwC;
      case 'primary':
        return primC;
      case 'secondary':
      case 'tertiary':
        return secC;
      case 'minor':
      case 'service':
        return minorC;
      default:
        return pathC;
    }
  };

  const fillLayers: unknown[] = [];

  // Fill de cada clase (se dibujan abajo de los casing).
  for (const cls of ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'path', 'track']) {
    const baseW = cls === 'motorway' || cls === 'trunk' ? 7 : cls === 'primary' ? 5 : cls === 'secondary' || cls === 'tertiary' ? 4 : cls === 'minor' || cls === 'service' ? 3 : 1.5;
    fillLayers.push({
      id: `wz-road-${cls}`,
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: lineFilter(cls),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': roadColor(cls),
        'line-width': width(4, baseW * 0.9, baseW, baseW * 2.1),
      },
    });
  }

  // Casing (contorno) de las vías.
  for (const cls of ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']) {
    const baseC = cls === 'motorway' || cls === 'trunk' ? 7.8 : cls === 'primary' ? 5.7 : cls === 'secondary' || cls === 'tertiary' ? 4.6 : cls === 'minor' || cls === 'service' ? 3.6 : 3;
    fillLayers.push({
      id: `wz-casing-${cls}`,
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: lineFilter(cls),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': casingColor(cls),
        'line-width': width(4, baseC * 0.9, baseC, baseC * 2.1),
        'line-opacity': dark ? 1 : 0.85,
      },
    });
  }

  const layers: unknown[] = [
    { id: 'wz-bg', type: 'background', paint: { 'background-color': palette.bg } },

    // Manzanas y suelo urbano (neutro, como Waze).
    {
      id: 'wz-landuse',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['match', ['get', 'class'], ['residential', 'suburb', 'commercial', 'industrial', 'education', 'school', 'hospital', 'cemetery', 'railway', 'military'], true, false],
      paint: { 'fill-color': palette.landuse },
    },
    {
      id: 'wz-landcover-park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['match', ['get', 'class'], ['park', 'grass', 'wood'], true, false],
      paint: { 'fill-color': palette.park },
    },
    {
      id: 'wz-building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 14,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': palette.building, 'fill-opacity': 0.9 },
    },
    {
      id: 'wz-water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: { 'fill-color': palette.water },
    },
    {
      id: 'wz-waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      paint: { 'line-color': palette.waterway, 'line-width': 1.2 },
    },

    // Casing primero (para que el fill tape el interior).
    ...fillLayers.filter((l) => (l as { id: string }).id.startsWith('wz-casing')),

    // Fill después de casing: se dibujan los fills en el mismo orden de prioridad visual.
    ...fillLayers.filter((l) => (l as { id: string }).id.startsWith('wz-road')),
  ];

  // Etiquetas de vía.
  const nameLayers: unknown[] = [];
  for (const [cls, size] of [
    ['motorway', 14.5],
    ['trunk', 14],
    ['primary', 13],
    ['secondary', 12],
    ['tertiary', 11],
    ['minor', 10.5],
  ] as const) {
    nameLayers.push({
      id: `wz-name-${cls}`,
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      filter: [
        'all',
        ['==', ['get', 'class'], cls],
        ['has', 'name'],
      ],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': size * palette.roadNameSizeBoost,
        'symbol-placement': 'line',
        'text-letter-spacing': 0.04,
        'text-max-width': 14,
      },
      paint: {
        'text-color': palette.label,
        'text-halo-color': palette.labelHalo,
        'text-halo-width': dark ? 1.1 : 1.4,
      },
    });
  }

  // Etiquetas de lugares (ciudades, barrios).
  const placeLayers: unknown[] = [
    {
      id: 'wz-place-suburb',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['all', ['==', ['get', 'class'], 'suburb'], ['has', 'name']],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 14, 12.5],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
      },
      paint: {
        'text-color': palette.place,
        'text-halo-color': palette.labelHalo,
        'text-halo-width': dark ? 1 : 1.3,
        'text-opacity': 0.75,
      },
    },
    {
      id: 'wz-place-city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['all', ['match', ['get', 'class'], ['city', 'town', 'village'], true, false], ['has', 'name']],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 12, 16],
        'text-letter-spacing': 0.03,
      },
      paint: {
        'text-color': dark ? palette.place : '#33383e',
        'text-halo-color': palette.labelHalo,
        'text-halo-width': dark ? 1 : 1.6,
      },
    },
  ];

  const spec: StyleSpecification = {
    version: 8,
    name: dark ? 'Waze Oscuro' : 'Waze',
    sources: {
      openmaptiles: { type: 'vector', url: VECTOR_SOURCE_URL },
    },
    glyphs: GLYPHS,
    layers: [...(layers as never[]), ...(nameLayers as never[]), ...(placeLayers as never[])],
  };
  return spec;
}

export interface MapStyleOption {
  id: string;
  name: string;
  swatch: string;
  /** Estilo local (StyleSpecification) o URL remota (estilo JSON). */
  spec?: StyleSpecification;
  styleUrl?: string;
  /** Zoom máx. garantizado por la fuente (raster); vector = 22. */
  maxZoom?: number;
  dark?: boolean;
}

export const WAZE_LIGHT_SPEC = buildWazeSpec(WAZE_LIGHT, false);
export const WAZE_DARK_SPEC = buildWazeSpec(WAZE_DARK, true);

function rasterSpec(
  name: string,
  entries: { tiles: string[]; attribution: string }[],
  maxZoom: number,
): StyleSpecification {
  const sources: Record<string, unknown> = {};
  const layers: unknown[] = [];
  entries.forEach((e, i) => {
    const id = `raster-${i}`;
    sources[id] = {
      type: 'raster',
      tiles: e.tiles,
      tileSize: 256,
      maxzoom: maxZoom,
      attribution: e.attribution,
    };
    layers.push({
      id,
      type: 'raster',
      source: id,
      paint: { 'raster-fade-duration': 120 },
    });
  });
  return {
    version: 8,
    name,
    sources: sources as StyleSpecification['sources'],
    layers: layers as StyleSpecification['layers'],
  };
}

const ESRI_ATTR = 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ';

/** Estilos remotos de OpenFreeMap (mismo proveedor que la app móvil). */
const OFM = (id: string, name: string, maxZoom: number, swatch: string, dark = false) =>
  ({
    id,
    name,
    styleUrl: `https://tiles.openfreemap.org/styles/${id}`,
    maxZoom,
    dark,
    swatch,
  }) satisfies MapStyleOption;

export const MAP_STYLE_OPTIONS: MapStyleOption[] = [
  // Mismo mapa que usa la app móvil de delivery (OpenFreeMap Liberty).
  OFM(
    'liberty',
    'Calles (móvil)',
    19,
    'linear-gradient(135deg,#e6efe2 0%,#f7f3ea 60%,#dbe9f5 100%)',
  ),
  // Otras variantes modernas del mismo proveedor.
  OFM('bright', 'Bright', 19, 'linear-gradient(135deg,#dce9d6 0%,#f6f2e9 60%,#cfe3ef 100%)'),
  OFM('positron', 'Claro minimal', 19, 'linear-gradient(135deg,#f4f4f2 0%,#e7e6e1 100%)'),
  OFM('dark', 'Oscuro', 19, 'linear-gradient(135deg,#2a2e36 0%,#1d2027 100%)', true),
  OFM('fiord', 'Fiord', 19, 'linear-gradient(135deg,#25303e 0%,#18212d 100%)', true),
  {
    id: 'waze',
    name: 'Waze',
    spec: WAZE_LIGHT_SPEC,
    swatch:
      'linear-gradient(#ffffff 0 0) 50% 35%/80% 2px no-repeat, linear-gradient(#ffffff 0 0) 50% 55%/60% 2px no-repeat, linear-gradient(#ffe9ad 0 0) 50% 45%/90% 3px no-repeat, #f2f3f4',
  },
  {
    id: 'waze-dark',
    name: 'Waze Oscuro',
    spec: WAZE_DARK_SPEC,
    dark: true,
    swatch:
      'linear-gradient(#3d424a 0 0) 50% 35%/80% 2px no-repeat, linear-gradient(#3d424a 0 0) 50% 55%/60% 2px no-repeat, linear-gradient(#f5c84c 0 0) 50% 45%/90% 3px no-repeat, #181a1f',
  },
  {
    id: 'standard',
    name: 'Estándar',
    spec: rasterSpec('Estándar', [{ tiles: OSM_TILES, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }], 19),
    maxZoom: 19,
    swatch: 'linear-gradient(135deg,#b8d8a5 0%,#e6e9dd 55%,#f4f7f6 100%)',
  },
  {
    id: 'light',
    name: 'Claro',
    // Fondo claro + calles oscuras (Transportation) + nombres (Boundaries & Places).
    spec: rasterSpec('Claro', [
      { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'], attribution: ESRI_ATTR },
      { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'], attribution: ESRI_ATTR },
      { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], attribution: ESRI_ATTR },
    ], 18),
    maxZoom: 18,
    swatch:
      'linear-gradient(#454a50 0 0) 50% 35%/75% 2px no-repeat, linear-gradient(#454a50 0 0) 50% 60%/50% 2px no-repeat, #f2f1ee',
  },
  {
    id: 'dark',
    name: 'Oscuro',
    spec: rasterSpec('Oscuro', [
      { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], attribution: ESRI_ATTR },
      { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'], attribution: ESRI_ATTR },
    ], 18),
    maxZoom: 18,
    dark: true,
    swatch:
      'linear-gradient(#c9ced6 0 0) 50% 35%/75% 2px no-repeat, linear-gradient(#c9ced6 0 0) 50% 60%/50% 2px no-repeat, #26292e',
  },
  {
    id: 'satellite',
    name: 'Satélite',
    spec: rasterSpec('Satélite', [{ tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: 'Tiles &copy; Esri &mdash; Maxar, Earthstar Geographics' }], 19),
    maxZoom: 19,
    swatch: 'linear-gradient(135deg,#3f6d4e 0%,#6f8f5f 55%,#9aa06b 100%)',
  },
  {
    id: 'terrain',
    name: 'Relieve',
    spec: rasterSpec('Relieve', [{ tiles: TOPO_TILES, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · SRTM · <a href="https://opentopomap.org">OpenTopoMap</a>' }], 17),
    maxZoom: 17,
    swatch: 'linear-gradient(135deg,#bcd6a4 0%,#e9e6cf 55%,#a8c4d8 100%)',
  },
];

export const LAYER_STORAGE_KEY = 'delivery_admin_map_layer_v5';
