import type { StyleSpecification } from "maplibre-gl";

/**
 * Estilo base para el mapa de rastreo: el MISMO que usa el delivery admin y la
 * app móvil (OpenFreeMap Liberty). Replica la normalización que se hace en el
 * delivery admin (Interface web delivery admin/src/components/FleetMap.tsx):
 *
 * 1. En dev los estilos/tiles se sirven por el proxy same-origin `/ofm`
 *    (configurado en vite.config.ts) para saltar bloqueos de red/adblock.
 * 2. Las URLs quedan absolutas: MapLibre descarga tiles/fuentes desde un Web
 *    Worker, donde las relativas no tienen base.
 * 3. La lista de tiles se lee del TileJSON real (OpenFreeMap usa rutas
 *    versionadas: planet/<fecha>_pt/{z}/{x}/{y}.pbf).
 * 4. Se corrigen los filtros numéricos sobre propiedades nullables de OMT
 *    (rank/admin_level/ref_length) que rompen el parseo de tiles en MapLibre.
 */
export const TRACKING_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const NULLABLE_NUMERIC = new Set(["rank", "admin_level", "ref_length"]);

function patchNullableFilters(node: unknown): unknown {
  if (!Array.isArray(node)) return node;
  const patched = node.map(patchNullableFilters);
  if (
    patched.length === 3 &&
    typeof patched[0] === "string" &&
    [">", ">=", "<", "<="].includes(patched[0])
  ) {
    const [op, a, b] = patched;
    const keyOf = (v: unknown): string | null =>
      Array.isArray(v) && v[0] === "get" && typeof v[1] === "string" ? v[1] : null;
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka && NULLABLE_NUMERIC.has(ka) && typeof b === "number") {
      const sentinel = op === ">" || op === ">=" ? -1e9 : 1e9;
      return [op, ["coalesce", a, sentinel], b];
    }
    if (kb && NULLABLE_NUMERIC.has(kb) && typeof a === "number") {
      const sentinel = op === "<" || op === "<=" ? -1e9 : 1e9;
      return [op, a, ["coalesce", b, sentinel]];
    }
  }
  return patched;
}

export async function resolveMapStyle(): Promise<StyleSpecification> {
  const host = import.meta.env.DEV
    ? `${window.location.origin}/ofm`
    : "https://tiles.openfreemap.org";
  const toBase = (u: string) => u.replace("https://tiles.openfreemap.org", host);

  const url = `${host}/styles/liberty`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Estilo del mapa ${url} → ${res.status}`);
  const text = await res.text();
  const spec = JSON.parse(
    text.split("https://tiles.openfreemap.org").join(host),
  ) as StyleSpecification;

  if (spec.glyphs) spec.glyphs = toBase(spec.glyphs);
  if (typeof spec.sprite === "string") {
    spec.sprite = toBase(spec.sprite);
  } else if (Array.isArray(spec.sprite)) {
    spec.sprite = spec.sprite.map((s) => ({ ...s, url: toBase(s.url) }));
  }

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
      } catch {
        /* se ignora: si el TileJSON falla MapLibre reporta el error */
      }
    }),
  );
  for (const raw of sources) {
    const src = raw as unknown as { tiles?: string[] };
    if (src.tiles) src.tiles = src.tiles.map(toBase);
  }

  const looseLayers = (spec.layers ?? []) as Array<{ filter?: unknown }>;
  for (const layer of looseLayers) {
    if (layer.filter) layer.filter = patchNullableFilters(layer.filter);
  }
  return spec;
}
