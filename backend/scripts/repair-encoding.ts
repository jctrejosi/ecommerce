/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/**
 * Repara los nombres corruptos (carácter de reemplazo U+FFFD) en:
 *   - products.name   (150 filas)
 *   - brands.name     (58 filas)
 *   - categories.name (4 filas)
 *
 * Causa raíz: los JSON exportados desde VISADS/Advantage están en Windows-1252
 * y se leyeron como UTF-8, convirtiendo cada byte > 0x7F (ñ, á, é...) en U+FFFD.
 *
 * Fuentes (los archivos que coinciden con la base actual, 2430 productos):
 *   - JSON/CATALOGO.JSON     → NOMBRE/PLU/CODIGO y MARCA (código) por producto
 *   - JSON/MARCAS.JSON       → código de marca → nombre real
 *   - JSON/CATEGORIAS.JSON   → código → nombre de categoría
 *   (CATALOGO_0.JSON / TIDTAB_0.JSON se usan como respaldo)
 *
 * Actualiza solo las filas con U+FFFD, emparejando por las mismas claves que
 * usa la importación (external_id/plu, brand_id vía MARCA, código).
 *
 * Uso: node dist/scripts/repair-encoding.js   (después de yarn build:scripts)
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, ilike } from 'drizzle-orm';
import { Pool } from 'pg';
import slugify from 'slugify';
import * as schema from '../drizzle/schema';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL missing');
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

const dataDir = path.join(__dirname, '..', '..', 'data');

/** U+FFFD (carácter de reemplazo) — marca los nombres corruptos. */
const FFFD = `%${String.fromCharCode(0xfffd)}%`;

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** Lee un JSON exportado de VISADS: UTF-8 si es válido, si no Windows-1252. */
function readJsonFile(...segments: string[]): any {
  const buf = fs.readFileSync(path.join(dataDir, ...segments));
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf);
  }
  return JSON.parse(text);
}

function buildSlug(parts: Array<string | number>) {
  return slugify(
    parts
      .map((part) => String(part).trim())
      .filter(Boolean)
      .join('-'),
    {
      lower: true,
      strict: true,
      locale: 'es',
      trim: true,
    },
  );
}

// ── Mapas desde los archivos fuente (ya con encoding correcto) ─────────────

function loadCatalog(name: string): { PRODUCTOS?: any[] } {
  try {
    return readJsonFile(...name.split('/'));
  } catch {
    return { PRODUCTOS: [] };
  }
}

// Catálogo completo (el que coincide con la base actual)
const catalog = loadCatalog('JSON/CATALOGO.JSON');
// Respaldo: export parcial (1000 productos)
const catalogPartial = loadCatalog('CATALOGO_0.JSON');

const productsSource = (catalog.PRODUCTOS ?? []).concat(
  catalogPartial.PRODUCTOS ?? [],
);

const nameByCodigo = new Map<string, string>();
const nameByPlu = new Map<string, string>();
const marcaCodeByCodigo = new Map<string, string>();
for (const row of productsSource) {
  const codigo = normalizeText(row.CODIGO);
  const plu = normalizeText(row.PLU);
  const nombre = normalizeText(row.NOMBRE);
  if (codigo && nombre) nameByCodigo.set(codigo, nombre);
  if (plu && nombre) nameByPlu.set(plu, nombre);
  if (codigo && normalizeText(row.MARCA)) {
    marcaCodeByCodigo.set(codigo, normalizeText(row.MARCA));
  }
}

// Marcas: código → nombre real (JSON/MARCAS.JSON)
const marcaNameByCode = new Map<string, string>();
let marcasFile: { MARCAS?: { CODIGO: string; NOMBRE: string }[] } = { MARCAS: [] };
try {
  marcasFile = readJsonFile('JSON/MARCAS.JSON');
} catch {
  /* sin respaldo de marcas */
}
for (const row of marcasFile.MARCAS ?? []) {
  const code = normalizeText(row.CODIGO);
  const name = normalizeText(row.NOMBRE);
  if (code && name) marcaNameByCode.set(code, name);
}

// Categorías: código → nombre real (JSON/CATEGORIAS.JSON, respaldo TIDTAB_0)
const categoryNameByCode = new Map<string, string>();
let categoriasFile: { CATEGORIAS?: { CODIGO: string; NOMBRE: string }[] } = {
  CATEGORIAS: [],
};
try {
  categoriasFile = readJsonFile('JSON/CATEGORIAS.JSON');
} catch {
  /* sin respaldo de categorías */
}
for (const row of categoriasFile.CATEGORIAS ?? []) {
  const code = normalizeText(row.CODIGO);
  const name = normalizeText(row.NOMBRE);
  if (code && name) categoryNameByCode.set(code, name);
}
try {
  const tidtab = readJsonFile('TIDTAB_0.JSON') as {
    TABLAS?: { CODIGO: string; NOMBRE: string }[];
  };
  for (const row of tidtab.TABLAS ?? []) {
    const code = normalizeText(row.CODIGO);
    const name = normalizeText(row.NOMBRE);
    if (code && name && !categoryNameByCode.has(code)) {
      categoryNameByCode.set(code, name);
    }
  }
} catch {
  /* sin respaldo TIDTAB */
}

// ── Reparación ─────────────────────────────────────────────────────────────

async function repairProducts(): Promise<number> {
  const corrupt = await db
    .select({
      id: schema.products.id,
      externalId: schema.products.externalId,
      plu: schema.products.plu,
      name: schema.products.name,
    })
    .from(schema.products)
    .where(ilike(schema.products.name, FFFD));

  let fixed = 0;
  for (const p of corrupt) {
    const codigo = normalizeText(p.externalId);
    const plu = normalizeText(p.plu);
    const name = nameByCodigo.get(codigo) ?? nameByPlu.get(plu);
    if (!name) {
      console.warn(`  ⚠️ sin fuente para producto ${p.id} (${p.name})`);
      continue;
    }
    const slug = buildSlug([name, codigo.slice(-6)]);
    await db
      .update(schema.products)
      .set({ name, slug })
      .where(eq(schema.products.id, p.id));
    fixed++;
  }
  return fixed;
}

async function repairBrands(): Promise<number> {
  const corrupt = await db
    .select({ id: schema.brands.id, name: schema.brands.name, code: schema.brands.code })
    .from(schema.brands)
    .where(ilike(schema.brands.name, FFFD));

  // Todos los nombres reales de marcas disponibles (para el matcher posicional)
  const allMarcaNames = [...marcaNameByCode.values()];

  // Nombre correcto de cada marca:
  // 1) por su `code` (código MARCAS.JSON) — determinista
  // 2) vía los productos que la usan (external_id → código MARCA → nombre)
  // 3) fallback: coincidencia posicional contra MARCAS.JSON (el U+FFFD ocupa
  //    exactamente la misma posición/longitud que el carácter original)
  let fixed = 0;
  for (const b of corrupt) {
    let name: string | null = null;
    const code = normalizeText(b.code);
    if (code) name = marcaNameByCode.get(code) ?? null;
    if (!name) name = await resolveBrandName(Number(b.id));
    if (!name) {
      const candidates = allMarcaNames.filter((n) =>
        matchesCorrupt(b.name, n),
      );
      name = candidates.length === 1 ? candidates[0] : null;
    }
    if (!name) {
      console.warn(`  ⚠️ sin fuente para marca ${b.id} (${b.name})`);
      continue;
    }
    const slug = buildSlug([name]);
    try {
      await db
        .update(schema.brands)
        .set({ name, slug })
        .where(eq(schema.brands.id, b.id));
      fixed++;
    } catch (err) {
      // Posible conflicto de slug único: se conserva el slug actual
      console.warn(`  ⚠️ conflicto de slug para "${name}", se conserva el slug`);
      await db
        .update(schema.brands)
        .set({ name })
        .where(eq(schema.brands.id, b.id));
      fixed++;
    }
  }
  return fixed;

  async function resolveBrandName(brandId: number): Promise<string | null> {
    const rows = await db
      .select({ externalId: schema.products.externalId })
      .from(schema.products)
      .where(eq(schema.products.brandId, brandId))
      .limit(5);
    for (const row of rows) {
      const marcaCode = marcaCodeByCodigo.get(normalizeText(row.externalId));
      if (marcaCode) {
        const name = marcaNameByCode.get(marcaCode);
        if (name) return name;
      }
    }
    return null;
  }
}

/**
 * Coincidencia posicional: el U+FFFD del nombre corrupto actuó como comodín
 * en la misma posición y longitud que el carácter original (cp1252 = 1 byte
 * por carácter), así que el nombre correcto debe encajar carácter a carácter.
 */
function matchesCorrupt(corrupt: string, candidate: string): boolean {
  if (corrupt.length !== candidate.length) return false;
  for (let i = 0; i < corrupt.length; i++) {
    if (corrupt[i] !== candidate[i] && corrupt[i] !== '\ufffd') return false;
  }
  return true;
}

async function repairCategories(): Promise<number> {
  const corrupt = await db
    .select({
      id: schema.categories.id,
      name: schema.categories.name,
      code: schema.categories.code,
    })
    .from(schema.categories)
    .where(ilike(schema.categories.name, FFFD));

  let fixed = 0;
  for (const c of corrupt) {
    // code puede ser "0103" o "departamento:101" (respaldo: último segmento)
    const rawCode = normalizeText(c.code);
    const code = rawCode.includes(':') ? rawCode.split(':').pop() ?? '' : rawCode;
    const name = categoryNameByCode.get(code);
    if (!name) {
      console.warn(`  ⚠️ sin fuente para categoría ${c.id} (${c.name}, code=${c.code})`);
      continue;
    }
    await db
      .update(schema.categories)
      .set({ name })
      .where(eq(schema.categories.id, c.id));
    fixed++;
  }
  return fixed;
}

async function main() {
  console.log('🔧 Reparando nombres corruptos (U+FFFD) desde los JSON fuente (Windows-1252)...');
  const p = await repairProducts();
  console.log(`✅ ${p} productos reparados`);
  const b = await repairBrands();
  console.log(`✅ ${b} marcas reparadas`);
  const c = await repairCategories();
  console.log(`✅ ${c} categorías reparadas`);
  await pool.end();
  console.log('Listo.');
}

void main();
