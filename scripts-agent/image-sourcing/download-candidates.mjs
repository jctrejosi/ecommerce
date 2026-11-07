#!/usr/bin/env node
/**
 * Fase 2 — Descarga a staging los candidatos del manifest de rastreo.
 *
 * Lee `db/image-sourcing/candidates.ndjson` (última línea por producto gana),
 * filtra `status=candidate` y `confidence >= --min-confidence`, y descarga a
 * `db/image-staging/raw/<code>.<ext>` validando con `sharp`.
 *
 * NO toca `db/images_static/` ni la BD. Deja constancia en
 * `db/image-staging/downloads.ndjson` con sha256 y `bg_pending=true` (la
 * limpieza de fondo es la Fase 3, un servicio aparte).
 *
 * Reanudable: omite archivos ya descargados (o los reintenta con --force).
 *
 * Uso:
 *   node scripts-agent/image-sourcing/download-candidates.mjs
 *   node scripts-agent/image-sourcing/download-candidates.mjs --min-confidence=0.9
 *   node scripts-agent/image-sourcing/download-candidates.mjs --include-review
 *   node scripts-agent/image-sourcing/download-candidates.mjs --limit=50
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const arg = (name, def) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
};

const MANIFEST = path.resolve(ROOT, String(arg('manifest', 'db/image-sourcing/candidates.ndjson')));
const OUT_DIR = path.resolve(ROOT, String(arg('dir', 'db/image-staging')));
const RAW_DIR = path.join(OUT_DIR, 'raw');
const DOWNLOADS = path.join(OUT_DIR, 'downloads.ndjson');

const MIN_CONF = Number(arg('min-confidence', 0.9));
const MIN_SIDE = Number(arg('min-side', 600));
const LIMIT = Number(arg('limit', 0)) || 0;
const INCLUDE_REVIEW = arg('include-review', false) === true;
const FORCE = arg('force', false) === true;
const TIMEOUT = Number(arg('timeout', 30000)) || 30000;

const USER_AGENT =
  'MercaldasEcommerceBot/1.0 (image sourcing; contacto: dev@mercaldas.local)';

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function readManifest() {
  if (!fs.existsSync(MANIFEST)) throw new Error(`No existe ${MANIFEST}`);
  const byProduct = new Map();
  const text = fs.readFileSync(MANIFEST, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      if (r && r.product_id != null) byProduct.set(r.product_id, r);
    } catch {
      // línea parcial (el rastreador puede estar escribiendo): se ignora
    }
  }
  return byProduct;
}

function readDownloads() {
  const set = new Set();
  if (!fs.existsSync(DOWNLOADS)) return set;
  for (const line of fs.readFileSync(DOWNLOADS, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      if (r && r.product_id != null) set.add(r.product_id);
    } catch {
      /* noop */
    }
  }
  return set;
}

function extFromUrl(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    const m = p.match(/\.(jpe?g|png|webp)$/);
    if (m) return m[1] === 'jpeg' ? '.jpg' : `.${m[1]}`;
  } catch {
    /* noop */
  }
  return null;
}

/**
 * Open*Facts sirve miniaturas `.400.jpg`. También publica la original como
 * `.full.jpg`; se prueban ambas para no quedarse con 400 px.
 */
function expandUrlVariants(url) {
  const out = [url];
  const candidates = [
    url.replace(/(\.[^./]+\.\d+)\.(?:400|200|100)(\.(?:jpe?g|png|webp))$/i, '$1.full$2'),
    url.replace(/\.(?:400|200|100)(\.(?:jpe?g|png|webp))$/i, '.full$1'),
  ];
  for (const u of candidates) if (u !== url && !out.includes(u)) out.push(u);
  return out;
}

async function download(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'image/*' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('respuesta vacía');
    return { buf, mime };
  } finally {
    clearTimeout(timer);
  }
}

function safeCode(code, productId) {
  return String(code || productId).replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function main() {
  const manifest = readManifest();
  const done = readDownloads();

  let work = [...manifest.values()].filter((r) => {
    if (r.status === 'candidate') return r.confidence >= MIN_CONF;
    if (INCLUDE_REVIEW && r.status === 'review') return true;
    return false;
  });

  if (!FORCE) work = work.filter((r) => !done.has(r.product_id));
  if (LIMIT) work = work.slice(0, LIMIT);

  fs.mkdirSync(RAW_DIR, { recursive: true });

  console.log(`Manifest: ${manifest.size} productos · a descargar: ${work.length}`);
  if (!work.length) {
    console.log('Nada por descargar (ajusta --min-confidence o usa --force).');
    return;
  }

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  const append = (obj) => fs.appendFileSync(DOWNLOADS, JSON.stringify(obj) + '\n');

  for (const r of work) {
    const code = safeCode(r.code, r.product_id);
    const urls = [r.candidate_url, ...(r.candidates || []).map((c) => c.url)]
      .filter((u, i, arr) => u && arr.indexOf(u) === i)
      .flatMap(expandUrlVariants)
      .filter((u, i, arr) => arr.indexOf(u) === i);

    let saved = null;
    let lastErr = null;

    for (const url of urls) {
      try {
        const { buf, mime } = await download(url);
        const ext = EXT_BY_MIME[mime] || extFromUrl(url) || '.jpg';
        const mimeFinal = MIME_BY_EXT[ext] || mime;

        const meta = await sharp(buf).metadata();
        const w = meta.width || 0;
        const h = meta.height || 0;
        if (Math.max(w, h) < MIN_SIDE) throw new Error(`imagen pequeña ${w}x${h}`);

        const file = `${code}${ext}`;
        const dest = path.join(RAW_DIR, file);
        if (fs.existsSync(dest) && !FORCE) {
          skipped++;
          saved = { skipped: true, file, url };
          break;
        }

        fs.writeFileSync(dest, buf);
        const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

        append({
          product_id: r.product_id,
          code: r.code,
          code_kind: r.code_kind,
          name: r.name,
          brand: r.brand,
          provider: r.provider,
          match_method: r.match_method,
          confidence: r.confidence,
          source_page: r.source_page ?? null,
          source_url: url,
          file: `db/image-staging/raw/${file}`,
          mime_type: mimeFinal,
          bytes: buf.length,
          width: w,
          height: h,
          sha256,
          bg_pending: true,
          status: 'downloaded',
          downloaded_at: new Date().toISOString(),
        });

        saved = { file, url };
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (saved) ok++;
    else {
      failed++;
      errors.push(`#${r.product_id} ${r.code}: ${lastErr?.message ?? 'sin URL'}`);
      if (errors.length <= 10) console.log(`  ✗ ${errors[errors.length - 1]}`);
    }
  }

  console.log(`\nDescargadas: ${ok} | Omitidas (ya estaban): ${skipped} | Fallidas: ${failed}`);
  console.log(`Staging: ${path.relative(ROOT, RAW_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
