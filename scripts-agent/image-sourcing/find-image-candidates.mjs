#!/usr/bin/env node
/**
 * FASE 1 — Rastreo de URLs candidatas de imagen para productos sin foto.
 *
 * Para cada producto de `db/products_without_image.json`:
 *   1. Si tiene barcode EAN usable → busca la ficha por código de barras en
 *      Open Food/Beauty/Products Facts (API pública, sin API key).
 *   2. Si no hay match (o no hay barcode) → búsqueda de imágenes por
 *      nombre + marca con Brave, Google CSE o SerpAPI (requieren API key en
 *      `backend/.env.development.local`), opcionalmente Wikimedia Commons.
 *
 * Proveedor barcode alternativo: `upcitemdb` (trial sin key, 100/día).
 *
 * Sólo cuando un buscador acierta con confianza >= 0.7 se corta la cadena de
 * proveedores, para no gastar cuota de los siguientes.
 *
 * NO descarga imágenes ni toca la BD: solo escribe el rastreo en
 * `db/image-sourcing/candidates.ndjson` (una línea JSON por producto,
 * reanudable) y `db/image-sourcing/summary.json`.
 *
 * Uso:
 *   node scripts-agent/image-sourcing/find-image-candidates.mjs --dry-run
 *   node scripts-agent/image-sourcing/find-image-candidates.mjs --limit=200
 *   node scripts-agent/image-sourcing/find-image-candidates.mjs --active-only
 *   node scripts-agent/image-sourcing/find-image-candidates.mjs --providers=openfacts,google_cse
 *   node scripts-agent/image-sourcing/find-image-candidates.mjs --retry        # reintenta none/error
 *   node scripts-agent/image-sourcing/find-image-candidates.mjs --only=7702175108460
 *   node scripts-agent/image-sourcing/find-image-candidates.mjs --sample=100   # muestra uniforme para estimar
 *
 * Requisitos de red: salida HTTPS a los hosts de los proveedores.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const dotenv = require('dotenv');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT, 'backend', '.env.development.local') });

// ─────────────────────────────── argumentos ────────────────────────────────
const arg = (name, def = null) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};

const INPUT_FILE = path.resolve(ROOT, String(arg('file', 'db/products_without_image.json')));
const OUT_DIR = path.resolve(ROOT, String(arg('dir', 'db/image-sourcing')));
const MANIFEST = path.join(OUT_DIR, 'candidates.ndjson');
const SUMMARY = path.join(OUT_DIR, 'summary.json');
const LIMIT = Number(arg('limit', 0)) || 0;
const SAMPLE = Number(arg('sample', 0)) || 0;
const ONLY = arg('only', null);
const ACTIVE_ONLY = arg('active-only', false) === true;
const RETRY = arg('retry', false) === true;
const DRY = arg('dry-run', false) === true;
const SLEEP_FACTOR = Number(arg('sleep', 1)) || 1;
const HTTP_TIMEOUT = Number(arg('timeout', 20000)) || 20000;
const MIN_CONF = Number(arg('min-confidence', 0.45));
const PROVIDERS = String(arg('providers', 'auto'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const USER_AGENT = 'Mercaldas-ImageSourcing/0.1 (Node; catalog image audit)';

// ─────────────────────────────── utilidades ────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const tokensOf = (s) =>
  new Set(
    strip(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !/^\d+$/.test(t)),
  );
const overlap = (a, b) => {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / a.size;
};
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '0%');

/** Nombre limpio para buscar en internet: sin tallas/presentaciones/códigos. */
function cleanName(name) {
  return String(name ?? '')
    .replace(/·.*$/u, ' ')
    .replace(/\b\d+([.,]\d+)?\s?(g|gr|grs|kg|kgs|mg|ml|l|lt|lts|un|und|u|pz|oz|lb|cm|mm)\b/gi, ' ')
    .replace(/\bx\s?\d+\b/gi, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s%&.'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Código con el que se guardará la foto final: barcode > plu > external_id. */
function codeFor(p) {
  const b = String(p.barcode ?? '').trim();
  if (/^\d{8,14}$/.test(b)) return { code: b, kind: 'barcode' };
  const plu = String(p.plu ?? '').trim();
  if (plu) return { code: plu, kind: 'plu' };
  const ext = String(p.external_id ?? '').trim();
  if (ext) return { code: ext, kind: 'external_id' };
  return { code: String(p.id), kind: 'product_id' };
}

// ─────────────────────────────── HTTP ──────────────────────────────────────
const nextAt = new Map();
async function throttle(key, intervalMs) {
  const now = Date.now();
  const waitUntil = nextAt.get(key) ?? 0;
  if (waitUntil > now) await sleep(waitUntil - now);
  nextAt.set(key, Date.now() + intervalMs * SLEEP_FACTOR);
}

async function httpJson(url, { intervalKey, intervalMs, headers = {} } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (intervalKey) await throttle(intervalKey, intervalMs ?? 300);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), HTTP_TIMEOUT);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers },
        signal: ctl.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after') ?? 5);
        await sleep(Math.min(Math.max(ra, 2), 60) * 1000);
        continue;
      }
      if (res.status === 404) return { ok: false, status: 404 };
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (res.status < 500) return { ok: false, status: res.status, error: lastError };
      } else {
        return { ok: true, status: res.status, json: await res.json() };
      }
    } catch (e) {
      clearTimeout(timer);
      lastError = e.name === 'AbortError' ? 'timeout' : e.message;
    }
    await sleep(1500 * (attempt + 1));
  }
  return { ok: false, error: lastError ?? 'network' };
}

// ─────────────────────────── proveedores ───────────────────────────────────
const OFF_HOSTS = {
  food: 'world.openfoodfacts.org',
  beauty: 'world.openbeautyfacts.org',
  products: 'world.openproductsfacts.org',
};

const hostOrderFor = (p) => {
  const ctx = strip(`${p.category} ${p.product_type_name}`);
  if (/(cosmet|dermat|belleza|maquillaje|perfum|aseo|cuidado|uso personal|higiene)/.test(ctx)) {
    return [OFF_HOSTS.beauty, OFF_HOSTS.products, OFF_HOSTS.food];
  }
  if (/(licor|bebida|refresco|lacteo|dulce|pasaboca|snack|aliment|congelado|condimento|confiteria|granos|panaderia)/.test(ctx)) {
    return [OFF_HOSTS.food, OFF_HOSTS.products, OFF_HOSTS.beauty];
  }
  return [OFF_HOSTS.food, OFF_HOSTS.products, OFF_HOSTS.beauty];
};

const OFF_FIELDS = 'code,product_name,brands,quantity,image_front_url,image_url';

async function providerOpenfacts(p) {
  const barcode = String(p.barcode ?? '').trim();
  if (!/^\d{8,14}$/.test(barcode)) return { skipped: 'no usable barcode' };

  for (const host of hostOrderFor(p)) {
    const url = `https://${host}/api/v2/product/${barcode}.json?fields=${OFF_FIELDS}`;
    const res = await httpJson(url, { intervalKey: host, intervalMs: 700 });
    if (!res.ok) {
      if (res.status === 404) continue; // también responde 404 cuando no existe
      if (res.error && res.status === undefined) return { error: res.error };
      continue;
    }
    const prod = res.json?.product;
    if (!prod) continue;
    const img = prod.image_front_url || prod.image_url || null;
    if (!img) continue;

    const brandTokens = tokensOf(`${prod.brands ?? ''} ${p.brand ?? ''}`);
    const nameTokens = tokensOf(`${prod.product_name ?? ''} ${p.name ?? ''}`);
    let score = 0.9;
    if (overlap(tokensOf(p.brand), brandTokens) > 0) score += 0.05;
    if (overlap(tokensOf(cleanName(p.name)), nameTokens) >= 0.5) score += 0.05;

    return {
      provider: 'openfacts',
      host,
      match_method: 'barcode_exact',
      source_page: `https://${host}/product/${barcode}`,
      candidates: [
        {
          url: img,
          title: String(prod.product_name ?? '').slice(0, 120),
          extra: { brands: prod.brands ?? null, quantity: prod.quantity ?? null },
        },
      ],
      confidence: Math.min(1, Number(score.toFixed(2))),
    };
  }
  return { none: 'barcode sin ficha en Open*Facts' };
}

const DOMAIN_ALLOWLIST = [
  'exito.com',
  'carulla.com',
  'jumbo.com.co',
  'olimpica.com',
  'falabella.com.co',
  'tiendasd1.com',
  'dollarcity.com',
  'homecenter.com.co',
  'mercadolibre.com.co',
  'amazon.com',
  'rappi.com.co',
  'larebaja.co',
];

function scoreSearchCandidate(item, p) {
  const text = strip(`${item.title ?? ''} ${item.snippet ?? ''}`);
  const nameOv = overlap(tokensOf(cleanName(p.name)), tokensOf(text));
  const brandOv = overlap(tokensOf(p.brand), tokensOf(text));
  let domainBonus = 0;
  try {
    const hostname = new URL(item.link ?? item.source ?? item.url ?? '').hostname.replace(/^www\./, '');
    if (DOMAIN_ALLOWLIST.some((d) => hostname === d || hostname.endsWith(`.${d}`))) domainBonus = 0.15;
  } catch {}
  const score = 0.35 + 0.35 * nameOv + 0.15 * brandOv + domainBonus;
  return { score: Math.min(0.85, Number(score.toFixed(2))), nameOv, brandOv };
}

const isPlaceholderBrand = (b) =>
  !b || /^(sin marca|s\/m|n\/a|na|generico|genérico)$/i.test(String(b).trim());

function buildSearchQuery(p) {
  const name = cleanName(p.name);
  const brand = isPlaceholderBrand(p.brand) ? '' : String(p.brand).trim();
  // Si el nombre ya contiene la marca, no repetirla.
  if (brand && overlap(tokensOf(brand), tokensOf(name)) >= 1) return name;
  return [name, brand].filter(Boolean).join(' ');
}

async function providerGoogleCse(p) {
  if (!process.env.GOOGLE_CSE_KEY || !process.env.GOOGLE_CSE_CX) return { skipped: 'sin GOOGLE_CSE_KEY/CX' };
  const q = buildSearchQuery(p);
  const url =
    `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(process.env.GOOGLE_CSE_KEY)}` +
    `&cx=${encodeURIComponent(process.env.GOOGLE_CSE_CX)}&searchType=image&num=5&safe=active` +
    `&q=${encodeURIComponent(q)}`;
  const res = await httpJson(url, { intervalKey: 'google_cse', intervalMs: 300 });
  if (!res.ok) return { error: res.error ?? `HTTP ${res.status}` };
  const items = Array.isArray(res.json?.items) ? res.json.items : [];
  if (!items.length) return { none: 'sin resultados' };
  const candidates = items.map((it) => {
    const s = scoreSearchCandidate({ title: it.title, snippet: it.snippet, link: it.image?.contextLink ?? it.link }, p);
    return {
      url: it.link,
      title: String(it.title ?? '').slice(0, 120),
      context: it.image?.contextLink ?? null,
      width: it.image?.width ?? null,
      height: it.image?.height ?? null,
      score: s.score,
    };
  });
  candidates.sort((a, b) => b.score - a.score);
  return { provider: 'google_cse', match_method: 'name_search', query: q, candidates };
}

async function providerSerpapi(p) {
  if (!process.env.SERPAPI_KEY) return { skipped: 'sin SERPAPI_KEY' };
  const q = buildSearchQuery(p);
  const url =
    `https://serpapi.com/search.json?engine=google_images&api_key=${encodeURIComponent(process.env.SERPAPI_KEY)}` +
    `&q=${encodeURIComponent(q)}&safe=active`;
  const res = await httpJson(url, { intervalKey: 'serpapi', intervalMs: 300 });
  if (!res.ok) return { error: res.error ?? `HTTP ${res.status}` };
  const items = Array.isArray(res.json?.images_results) ? res.json.images_results : [];
  if (!items.length) return { none: 'sin resultados' };
  const candidates = items.slice(0, 5).map((it) => {
    const s = scoreSearchCandidate({ title: it.title, snippet: it.source, link: it.source }, p);
    return {
      url: it.original,
      title: String(it.title ?? '').slice(0, 120),
      context: it.link ?? it.source ?? null,
      width: it.original_width ?? null,
      height: it.original_height ?? null,
      score: s.score,
    };
  });
  candidates.sort((a, b) => b.score - a.score);
  return { provider: 'serpapi', match_method: 'name_search', query: q, candidates };
}

async function providerBrave(p) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return { skipped: 'sin BRAVE_API_KEY' };
  const q = buildSearchQuery(p);
  const url =
    'https://api.search.brave.com/res/v1/images/search' +
    `?q=${encodeURIComponent(q)}&count=5&safesearch=strict`;
  const res = await httpJson(url, {
    intervalKey: 'brave',
    intervalMs: 1100, // límite del plan free: 1 req/s
    headers: { 'x-subscription-token': key },
  });
  if (!res.ok) return { error: res.error ?? `HTTP ${res.status}` };
  const items = Array.isArray(res.json?.results) ? res.json.results : [];
  if (!items.length) return { none: 'sin resultados' };
  const candidates = items
    .map((it) => {
      const pageUrl = it.url ?? it.source ?? it.meta_url?.url ?? it.meta_url?.hostname ?? null;
      const s = scoreSearchCandidate({ title: it.title, snippet: it.source ?? '', link: pageUrl }, p);
      return {
        url: it.properties?.url ?? it.thumbnail?.src ?? null,
        title: String(it.title ?? '').slice(0, 120),
        context: pageUrl,
        width: it.thumbnail?.width ?? null,
        height: it.thumbnail?.height ?? null,
        score: s.score,
      };
    })
    .filter((c) => c.url);
  if (!candidates.length) return { none: 'sin imagen utilizable' };
  candidates.sort((a, b) => b.score - a.score);
  return { provider: 'brave', match_method: 'name_search', query: q, candidates };
}

async function providerUpcitemdb(p) {
  const barcode = String(p.barcode ?? '').trim();
  if (!/^\d{8,14}$/.test(barcode)) return { skipped: 'no usable barcode' };
  const key = process.env.UPCITEMDB_KEY;
  const url = key
    ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${barcode}`
    : `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`;
  const res = await httpJson(url, {
    intervalKey: 'upcitemdb',
    intervalMs: 10000, // trial: 6 req/min
    headers: key ? { user_key: key } : {},
  });
  if (!res.ok) return { error: res.error ?? `HTTP ${res.status}` };
  const items = Array.isArray(res.json?.items) ? res.json.items : [];
  const item = items.find((it) => Array.isArray(it.images) && it.images.length);
  if (!item) return { none: 'sin ficha con imagen' };

  let score = 0.8;
  if (overlap(tokensOf(p.brand), tokensOf(`${item.brand ?? ''} ${p.brand ?? ''}`)) > 0) score += 0.05;
  if (overlap(tokensOf(cleanName(p.name)), tokensOf(item.title ?? '')) >= 0.5) score += 0.1;

  return {
    provider: 'upcitemdb',
    host: 'api.upcitemdb.com',
    match_method: 'barcode_exact',
    source_page: `https://www.upcitemdb.com/upc/${barcode}`,
    candidates: item.images.slice(0, 5).map((u) => ({
      url: u,
      title: String(item.title ?? '').slice(0, 120),
      extra: { brand: item.brand ?? null },
    })),
    confidence: Math.min(1, Number(score.toFixed(2))),
  };
}

async function providerWikimedia(p) {
  const q = buildSearchQuery(p);
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search' +
    `&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=5` +
    '&prop=imageinfo&iiprop=url|size&iiurlwidth=800';
  const res = await httpJson(url, { intervalKey: 'wikimedia', intervalMs: 350 });
  if (!res.ok) return { error: res.error ?? `HTTP ${res.status}` };
  const pages = Object.values(res.json?.query?.pages ?? {});
  if (!pages.length) return { none: 'sin resultados' };
  const candidates = pages
    .map((pg) => {
      const info = pg.imageinfo?.[0];
      if (!info?.url) return null;
      const s = scoreSearchCandidate({ title: pg.title, snippet: '', link: '' }, p);
      return {
        url: info.thumburl ?? info.url,
        title: String(pg.title ?? '').slice(0, 120),
        context: info.descriptionurl ?? null,
        width: info.thumbwidth ?? info.width ?? null,
        height: info.thumbheight ?? info.height ?? null,
        score: Math.min(0.4, s.score), // genérico: siempre requiere revisión
      };
    })
    .filter(Boolean);
  candidates.sort((a, b) => b.score - a.score);
  return { provider: 'wikimedia', match_method: 'commons_search', query: q, candidates };
}

const PROVIDERS_IMPL = {
  openfacts: { fn: providerOpenfacts, requires: [] },
  upcitemdb: { fn: providerUpcitemdb, requires: [] },
  brave: { fn: providerBrave, requires: ['BRAVE_API_KEY'] },
  google_cse: { fn: providerGoogleCse, requires: ['GOOGLE_CSE_KEY', 'GOOGLE_CSE_CX'] },
  serpapi: { fn: providerSerpapi, requires: ['SERPAPI_KEY'] },
  wikimedia: { fn: providerWikimedia, requires: [] },
};

function resolveProviders() {
  const names = PROVIDERS.includes('auto')
    ? ['openfacts', 'brave', 'google_cse', 'serpapi']
    : PROVIDERS;
  const active = [];
  for (const name of names) {
    const impl = PROVIDERS_IMPL[name];
    if (!impl) throw new Error(`proveedor desconocido: ${name}`);
    const missing = impl.requires.filter((k) => !process.env[k]);
    if (missing.length) {
      if (PROVIDERS.includes('auto')) continue; // en auto se omite silenciosamente
      throw new Error(`proveedor ${name}: falta ${missing.join(', ')} en el entorno`);
    }
    active.push(name);
  }
  if (!active.length) throw new Error('ningún proveedor disponible (revisa API keys o --providers)');
  return active;
}

// ─────────────────────────────── ejecución ─────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });

function loadManifest() {
  const byProduct = new Map();
  if (!fs.existsSync(MANIFEST)) return byProduct;
  const lines = fs.readFileSync(MANIFEST, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      byProduct.set(rec.product_id, rec); // la última línea gana
    } catch {}
  }
  return byProduct;
}

const providerNames = resolveProviders();
const input = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
let products = input.products ?? [];
if (ACTIVE_ONLY) products = products.filter((p) => p.is_active);
if (ONLY) {
  const only = String(ONLY).trim();
  products = products.filter((p) =>
    [p.barcode, p.plu, p.sku, p.external_id].some((x) => x != null && String(x).trim() === only),
  );
  if (!products.length) {
    console.error(`--only=${only}: no hay producto faltante con ese identificador`);
    process.exit(1);
  }
}

const manifest = loadManifest();
const pending = products.filter((p) => {
  const prev = manifest.get(p.id);
  if (!prev) return true;
  if (RETRY) return ['none', 'review', 'error'].includes(prev.status);
  return false;
});
const work = (() => {
  if (SAMPLE > 0) {
    // Muestra uniforme sobre los pendientes (no sesgada por el orden alfabético).
    const step = Math.max(1, Math.floor(pending.length / SAMPLE));
    return pending.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  }
  return LIMIT > 0 ? pending.slice(0, LIMIT) : pending;
})();

console.log(`Faltantes en ${path.relative(ROOT, INPUT_FILE)}: ${products.length}`);
console.log(`Proveedores: ${providerNames.join(', ')}${ONLY ? `  ·  solo ${ONLY}` : ''}${ACTIVE_ONLY ? '  ·  solo activos' : ''}`);
console.log(`Ya en manifest: ${manifest.size}  ·  por procesar ahora: ${work.length}${LIMIT ? ` (--limit=${LIMIT})` : ''}${SAMPLE ? ` (--sample=${SAMPLE})` : ''}`);

if (DRY) {
  for (const p of work.slice(0, 20)) {
    const { code, kind } = codeFor(p);
    const q = buildSearchQuery(p);
    const bc = /^\d{8,14}$/.test(String(p.barcode ?? '')) ? String(p.barcode) : '(sin barcode)';
    console.log(`  #${p.id} [${kind}:${code}] bc=${bc} q="${q}"`);
  }
  if (work.length > 20) console.log(`  ... y ${work.length - 20} más`);
  console.log('\n[dry-run] sin llamadas de red ni escrituras.');
  process.exit(0);
}
if (!work.length) {
  console.log('Nada por procesar (usa --retry para reintentar none/review/error).');
}

const run = { processed: 0, candidate: 0, review: 0, none: 0, error: 0, skipped: 0 };
const startedAt = Date.now();
const foundSample = [];
const errorsSample = [];

for (const p of work) {
  const { code, kind } = codeFor(p);
  const base = {
    product_id: p.id,
    code,
    code_kind: kind,
    name: p.name ?? null,
    brand: p.brand ?? null,
    category: p.category ?? null,
    is_active: !!p.is_active,
  };

  const attempts = [];
  const notes = [];
  let best = null;
  let anyCandidate = false;
  let hardError = null;

  for (const name of providerNames) {
    const { fn } = PROVIDERS_IMPL[name];
    const out = await fn(p);
    attempts.push({ provider: name, result: out.error ? 'error' : out.none ? 'none' : out.skipped ? 'skipped' : 'ok' });
    if (out.error) {
      hardError = out.error;
      continue;
    }
    if (out.skipped) {
      run.skipped++;
      notes.push(`${name}: ${out.skipped}`);
      continue;
    }
    if (out.none) {
      notes.push(`${name}: ${out.none}`);
      continue;
    }
    if (out.candidates?.length) {
      anyCandidate = true;
      const top = out.candidates.reduce((a, b) => ((b.score ?? out.confidence ?? 0) > (a.score ?? out.confidence ?? 0) ? b : a));
      const confidence = out.confidence ?? top.score ?? 0;
      const option = {
        provider: out.provider,
        host: out.host ?? null,
        match_method: out.match_method,
        query: out.query ?? null,
        source_page: out.source_page ?? null,
        confidence,
        candidate_url: top.url,
        candidates: out.candidates.slice(0, 5),
      };
      if (!best || option.confidence > best.confidence) best = option;
      // El EAN es autoritativo; si un buscador da >=0.7 tampoco gastamos
      // cuota en los siguientes proveedores.
      if (out.match_method === 'barcode_exact' || option.confidence >= 0.7) break;
    }
  }

  const prev = manifest.get(p.id);
  const status = best ? (best.confidence >= MIN_CONF ? 'candidate' : 'review') : hardError && !anyCandidate ? 'error' : 'none';
  const record = {
    ...base,
    provider: best?.provider ?? null,
    host: best?.host ?? null,
    match_method: best?.match_method ?? null,
    query: best?.query ?? null,
    source_page: best?.source_page ?? null,
    confidence: best?.confidence ?? 0,
    status,
    candidate_url: best?.candidate_url ?? null,
    candidates: best?.candidates ?? [],
    attempts: (prev?.attempts ?? 0) + 1,
    checked_at: new Date().toISOString(),
    error: hardError,
    note: best ? null : hardError ? 'reintentar con --retry' : notes.slice(0, 2).join(' | '),
  };

  fs.appendFileSync(MANIFEST, JSON.stringify(record) + '\n');
  manifest.set(p.id, record);
  run.processed++;
  run[status]++;
  if (status === 'candidate' && foundSample.length < 8) {
    foundSample.push(`  #${record.product_id} c=${record.confidence.toFixed(2)} ${record.provider}/${record.match_method} ${String(record.candidate_url).slice(0, 72)}`);
  }
  if (status === 'error' && errorsSample.length < 5) {
    errorsSample.push(`  #${record.product_id} ${record.error}`);
  }
}

// ─────────────────────────────── resumen ───────────────────────────────────
const all = [...manifest.values()];
const byStatus = {};
const byProvider = {};
const noneReason = { con_barcode: 0, sin_barcode: 0 };
const byConfidence = { '0.9-1.0': 0, '0.7-0.9': 0, '0.45-0.7': 0, '0-0.45': 0 };
for (const r of all) {
  byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  if (r.provider) byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
  if (r.status === 'none') noneReason[r.code_kind === 'barcode' ? 'con_barcode' : 'sin_barcode']++;
  if (r.status === 'candidate') {
    if (r.confidence >= 0.9) byConfidence['0.9-1.0']++;
    else if (r.confidence >= 0.7) byConfidence['0.7-0.9']++;
    else if (r.confidence >= 0.45) byConfidence['0.45-0.7']++;
    else byConfidence['0-0.45']++;
  }
}

const summary = {
  generated_at: new Date().toISOString(),
  input_file: path.relative(ROOT, INPUT_FILE).replace(/\\/g, '/'),
  providers: providerNames,
  run: { ...run, seconds: Math.round((Date.now() - startedAt) / 1000) },
  totals: {
    products_missing: products.length,
    products_with_result: all.length,
    by_status: byStatus,
    none_reason: noneReason,
    candidates_by_provider: byProvider,
    candidates_by_confidence: byConfidence,
  },
  filters_applied: { only: ONLY ?? null, active_only: ACTIVE_ONLY, retry: RETRY, min_confidence: MIN_CONF },
};
fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));

console.log(`\n== Run ==`);
console.log(`procesados: ${run.processed}  ·  candidate: ${run.candidate}  ·  review: ${run.review}  ·  none: ${run.none}  ·  error: ${run.error}  ·  skipped: ${run.skipped}`);
console.log(`segundos: ${summary.run.seconds}`);
if (foundSample.length) {
  console.log('muestra de URLs encontradas:');
  console.log(foundSample.join('\n'));
}
if (errorsSample.length) {
  console.log('errores:');
  console.log(errorsSample.join('\n'));
}
console.log(`\n== Totales manifest (${all.length} productos rastreados) ==`);
console.log(`status: ${JSON.stringify(byStatus)}`);
console.log(`candidatos por proveedor: ${JSON.stringify(byProvider)}`);
console.log(`candidatos por confianza: ${JSON.stringify(byConfidence)}`);
console.log(`\nmanifest: ${path.relative(ROOT, MANIFEST)}`);
console.log(`resumen : ${path.relative(ROOT, SUMMARY)}`);
