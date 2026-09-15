/**
 * Lógica compartida para obtener/garantizar logos de marcas del carousel.
 * Usada por:
 *   - fetch-brand-logos.js           (BD local)
 *   - sync-brand-logos-supabase.js   (BD remota Supabase)
 */
const fs = require('fs');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;

// ── Env ──
function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

function configCloudinary(env) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
  return cloudinary;
}

// ── Dominios oficiales candidatos por marca (para buscar el logo) ──
const DOMAINS = {
  ALPINA: ['alpina.com.co', 'alpina.com'],
  ALQUERIA: ['alqueriacorp.com', 'alqueria.com.co'],
  ARIEL: ['ariel.co', 'ariel.com'],
  CASILLERO: ['casillerodeldiablo.com'],
  'CASILLERO DEL DIABLO': ['casillerodeldiablo.com'],
  COLGATE: ['colgate.com', 'colgate.com.co'],
  'COLGATE PLAX': ['colgate.com'],
  'HEAD SHOULDERS': ['headandshoulders.com'],
  HUGGIES: ['huggies.com.co', 'huggies.com'],
  'JUAN VALDEZ': ['juanvaldez.com', 'juanvaldez.co'],
  NESTLE: ['nestle.com.co', 'nestle.com'],
  PROTEX: ['protex.com', 'protex.com.co', 'colgate.com'],
  PROTEXION: ['protex.com', 'protex.com.co', 'colgate.com'],
};

const FETCH_TIMEOUT_MS = 12_000;

async function downloadFirst(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (Mercaldas-brand-logos/1.0)' },
      });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) continue;
      return { buffer: buf, mime: type.split(';')[0].trim() };
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

function brandUrlCandidates(brand) {
  const domains = DOMAINS[String(brand.name ?? '').toUpperCase()] ?? [];
  const urls = [];
  for (const d of domains) {
    urls.push(`https://logo.clearbit.com/${d}`);
    urls.push(`https://www.google.com/s2/favicons?domain=${d}&sz=128`);
  }
  return urls;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function brandPublicId(brand) {
  const base = (brand.code || brand.slug || brand.name || '').toString();
  const id = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || 'marca';
}

function uploadToCloudinary(buffer, brand) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: 'brands',
          public_id: `${brandPublicId(brand)}_${Date.now()}`,
          resource_type: 'image',
          format: 'png',
        },
        (err, result) => (err ? reject(err) : resolve(result)),
      )
      .end(buffer);
  });
}

// ── Media: garantiza una fila (reutiliza por checksum o path) ──
async function ensureMedia(pool, meta) {
  if (meta.checksum) {
    const byChecksum = await pool.query(
      `SELECT id, path FROM media WHERE checksum = $1 LIMIT 1`,
      [meta.checksum],
    );
    if (byChecksum.rows.length) {
      return { id: byChecksum.rows[0].id, path: byChecksum.rows[0].path };
    }
  }
  if (meta.path) {
    const byPath = await pool.query(
      `SELECT id, path FROM media WHERE path = $1 LIMIT 1`,
      [meta.path],
    );
    if (byPath.rows.length) {
      return { id: byPath.rows[0].id, path: byPath.rows[0].path };
    }
  }
  const inserted = await pool.query(
    `INSERT INTO media
       (status, media_type, provider, path, file_name, mime_type, size_bytes, checksum, is_public, alt_text)
     VALUES ('active', 'image', 'cloudinary', $1, $2, $3, $4, $5, TRUE, $6)
     RETURNING id`,
    [
      meta.path,
      meta.file_name,
      meta.mime_type,
      meta.size_bytes,
      meta.checksum,
      meta.alt_text ?? null,
    ],
  );
  return { id: inserted.rows[0].id, path: meta.path };
}

/**
 * Garantiza logos para las marcas del carousel (reglas de
 * LandingService.getPublicBrands) de la BD del `pool`:
 *   - si `landing_brands` (settings) tiene códigos → esas marcas
 *   - si no → is_active AND is_featured
 *
 * Para cada marca sin logo:
 *   1. si `lookup` devuelve una fila media existente (p. ej. desde otra BD),
 *      se reutiliza ese asset (mismo Cloudinary);
 *   2. si no, descarga de internet y sube a Cloudinary.
 * Crea la fila en media y enlaza brands.logo_media_id.
 */
async function ensureBrandLogos(pool, { lookup = null, label = 'BD' } = {}) {
  const force = process.env.FORCE === '1';

  const { rows: settings } = await pool.query(
    `SELECT value FROM settings WHERE key = 'landing_brands' AND value IS NOT NULL LIMIT 1`,
  );
  let selected = [];
  try {
    const raw = settings[0]?.value;
    if (Array.isArray(raw)) selected = raw.map(String);
    else if (typeof raw === 'string') selected = JSON.parse(raw).map(String);
  } catch {
    selected = [];
  }

  const params = selected.length
    ? ['is_active = TRUE AND deleted_at IS NULL AND code = ANY($1)', [selected]]
    : ['is_active = TRUE AND is_featured = TRUE AND deleted_at IS NULL', []];
  const { rows: brands } = await pool.query(
    `SELECT b.id, b.name, b.code, b.slug, b.logo_media_id, m.path AS logo_path
       FROM brands b
       LEFT JOIN media m ON m.id = b.logo_media_id
      WHERE ${params[0]}
      ORDER BY b.name`,
    params[1],
  );

  console.log(
    `[${label}] Marcas objetivo: ${brands.length} (${selected.length ? 'selección landing_brands' : 'destacadas is_featured'})`,
  );

  const results = [];
  for (const brand of brands) {
    if (!force && brand.logo_path) {
      results.push({ name: brand.name, ok: 'ya tenía logo', path: brand.logo_path });
      continue;
    }

    // 1) Reutilizar asset conocido (misma cuenta Cloudinary)…
    let media = null;
    if (lookup) {
      const meta = await lookup(brand);
      if (meta) {
        media = await ensureMedia(pool, meta);
        results.push({ name: brand.name, ok: 'reutilizada', path: media.path });
      }
    }
    if (!media) {
      // 2) …o descargar y subir.
      const found = await downloadFirst(brandUrlCandidates(brand));
      if (!found) {
        results.push({ name: brand.name, ok: '⚠️ sin imagen disponible' });
        continue;
      }
      const up = await uploadToCloudinary(found.buffer, brand);
      media = await ensureMedia(pool, {
        path: up.secure_url,
        file_name: `${brandPublicId(brand)}.png`,
        mime_type: found.mime || 'image/png',
        size_bytes: found.buffer.length,
        checksum: sha256(found.buffer),
        alt_text: `Logo de ${brand.name}`,
      });
      results.push({ name: brand.name, ok: 'descargada + subida', path: media.path });
    }

    await pool.query(
      `UPDATE brands SET logo_media_id = $1, updated_at = now() WHERE id = $2`,
      [media.id, brand.id],
    );
  }
  return results;
}

module.exports = {
  loadEnv,
  configCloudinary,
  downloadFirst,
  brandUrlCandidates,
  sha256,
  brandPublicId,
  uploadToCloudinary,
  ensureMedia,
  ensureBrandLogos,
};
