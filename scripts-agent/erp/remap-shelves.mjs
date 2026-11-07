/**
 * Remapea las estanterías físicas de las categorías viejas (árbol web por
 * prefijo de SKU) a las categorías reales del ERP (TIDCATE).
 *
 * El prefijo del SKU NO codifica la categoría TIDCATE (ej. una salsa puede
 * venir con INCATE=050703), así que el mapeo se hace por NOMBRE de categoría:
 * las hojas viejas se traducen a una o varias hojas TIDCATE equivalentes.
 * Las hojas sin equivalente (farmacia, ferretería, servicios…) se eliminan y
 * se reportan; la estantería queda sin categorías hasta que se asigne a mano.
 *
 * Uso:
 *   node scripts-agent/erp/remap-shelves.mjs            # dry-run
 *   node scripts-agent/erp/remap-shelves.mjs --apply
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, args, log } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;

const erp = createErpClient();
const pg = createPg();
await pg.connect();
await pg.query("SET app.erp_sync = 'on'");
const q = (t, p) => pg.query(t, p);

// ─────────────────────────── categorías del ERP ───────────────────────────
log('⏳ Leyendo TIDCATE…');
const cateRes = await erp.sql('SELECT CTABCOD, CTABDES FROM tidcate', { limit: 10000 });
const erpCats = cateRes.rows
  .map((r) => ({ code: s(r[0]), name: s(r[1]) || s(r[0]) }))
  .filter((c) => c.code);
const erpCodes = erpCats.map((c) => c.code);
const newCats = (
  await q('SELECT id, code, name FROM categories WHERE code = ANY($1::text[])', [erpCodes])
).rows;
const newIdByCode = new Map(newCats.map((r) => [String(r.code).trim(), Number(r.id)]));
const newCodeByName = new Map();
for (const c of erpCats) {
  const code = newIdByCode.has(c.code) ? c.code : null;
  if (!code) continue;
  const key = norm(c.name);
  // Preferir hojas (código más largo) ante nombres repetidos.
  const prev = newCodeByName.get(key);
  if (!prev || code.length > prev.length) newCodeByName.set(key, code);
}

const oldCats = (
  await q(
    `SELECT id, code, name FROM categories
      WHERE code IS NOT NULL AND NOT (code = ANY($1::text[]))
      ORDER BY length(code), code`,
    [erpCodes],
  )
).rows;
const oldById = new Map(oldCats.map((c) => [Number(c.id), c]));
log(`   ${erpCodes.length} categorías TIDCATE · ${oldCats.length} categorías viejas`);

// ─────────────────────────── equivalencias por nombre ───────────────────────────
const range = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(6, '0'));
const BEEF = range(20101, 20110);
const PORK = range(20201, 20208);
const CHICKEN = range(20301, 20303);
const FISH = range(20401, 20403);
const MEAT = [...BEEF, ...PORK, ...CHICKEN, ...FISH];
const CHARCUTERIE = range(30101, 30106);
const FRUITS = range(40101, 40109);
const VEGETABLES = range(40201, 40210);
const FRESH = [...FRUITS, ...VEGETABLES];
const OILS = range(50201, 50203);
const PASTA = range(50501, 50502);
const CANNED = range(50701, 50705);
const COFFEE = range(50901, 50904);
const TEA = ['050907', '050908'];
const POWDER_MILK = range(51001, 51002);
const LIQUID_MILK = range(60101, 60104);
const DAIRY = [...POWDER_MILK, ...LIQUID_MILK];
const BABY = range(80101, 80104);
const WINES = range(70101, 70105);
const PETS = range(90101, 90103);
const CLEANING = range(100101, 100104);
const GROCERY = [
  ...range(50101, 50102),
  ...OILS,
  ...range(50301, 50303),
  ...range(50401, 50403),
  ...PASTA,
  ...range(50601, 50603),
  ...CANNED,
  ...range(50801, 50803),
  ...COFFEE,
  ...TEA,
  ...POWDER_MILK,
];
const APPLIANCES = [
  ...range(10101, 10103),
  ...range(10201, 10205),
  ...range(10301, 10310),
  ...range(10401, 10406),
  ...range(10501, 10503),
  ...range(10601, 10603),
];

const OLD_NAME_MAP = {
  'ADEREZOS-SALSAS': ['050601', '050602', '050603'],
  CAFE: COFFEE,
  'CARNES PROCESADAS': CHARCUTERIE,
  'CARNE EN CANAL M.P.': BEEF,
  'CARNES PROC M.P.': BEEF,
  'CARNE EN CORTES P.T.': PORK,
  'CARNES PROC P.T.': PORK,
  CARNES: MEAT,
  CEREALES: ['050102'],
  CHARCUTERIA: CHARCUTERIE,
  CHOCOLATES: ['050905', '050906'],
  'COMPLEMENTOS ALIMENTICIOS': ['050403'],
  CONDIMENTOS: ['050303'],
  ENDULZANTES: ['050803'],
  ENLATADOS: CANNED,
  FRUVER: FRESH,
  GRANO: ['050102'],
  GRASAS: OILS,
  'INFANTIL-ALIMENTOS': BABY,
  LACTEOS: DAIRY,
  'MODIFICADORES DE LECHE': ['051002', '060104'],
  'PASTAS ALIMENTICIAS': PASTA,
  REFRIGERADOS: LIQUID_MILK,
  'SOPAS-CALDOS-BASES': ['050302', '050401', '050402', '050403'],
  'TE-TISANAS': TEA,
  HARINAS: ['050102'],
  CAFETERIA: COFFEE,
  'ASEO BAÑOS': CLEANING,
  'ASEO COCINA-HOGAR': CLEANING,
  'ASEO PISOS': CLEANING,
  'ASEO ROPA': CLEANING,
  DESECHABLES: CLEANING,
  'BOLSA PLASTICA MER': CLEANING,
  'IMP. CONS BOLSAS': CLEANING,
  'BOLSA REUTILIZABLE': CLEANING,
  'LIMPIEZA Y DESINFECCION': CLEANING,
  LICORES: WINES,
  MASCOTAS: PETS,
  'ACCESORIOS HOGAR': APPLIANCES,
  'ACCESORIOS DEL HOGAR': APPLIANCES,
  'ELECTRODOMESTICOS Y GASODOMESTICOS': APPLIANCES,
  ALIMENTOS: GROCERY,
};

// Respaldo cuando la estantería no recibe ninguna categoría de sus hojas.
const SHELF_FALLBACK = {
  CARNES: MEAT,
  FRUVER: FRESH,
  'CAFE Y TE': [...COFFEE, ...TEA],
  'LACTEOS HUEVOS Y REFRIGERADOS': DAIRY,
  'DESPENSA ABARROTES': GROCERY,
  'DULCERIA Y PASABOCAS': ['050905', '050906'],
  'LINEA HOGAR': APPLIANCES,
  MASCOTAS: PETS,
  CHARCUTERIA: CHARCUTERIE,
  BEBIDAS: [...WINES, '060104'],
  CONGELADOS: FISH,
  PANADERIA: ['050403'],
};

/** Normaliza un nombre para comparar: sin acentos, sin "(codigo)", alfanumérico. */
function norm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(\s*\d+\s*\)/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

// Las claves se normalizan igual que los nombres (guiones y ñ incluidos).
const oldMapByKey = new Map(
  Object.entries(OLD_NAME_MAP).map(([key, codes]) => [norm(key), codes]),
);
const shelfFallbackByKey = new Map(
  Object.entries(SHELF_FALLBACK).map(([key, codes]) => [norm(key), codes]),
);

function codesForCat(cat) {
  const name = norm(cat.name);
  const mapped = oldMapByKey.get(name);
  if (mapped) return mapped;
  const exact = newCodeByName.get(name);
  return exact ? [exact] : [];
}

// ─────────────────────────── estanterías actuales ───────────────────────────
const shelfRows = (
  await q(
    `SELECT sc.shelf_id, sh.name AS shelf_name, sc.category_id
       FROM shelf_categories sc
       JOIN shelves sh ON sh.id = sc.shelf_id
      ORDER BY sh.code, sc.category_id`,
  )
).rows;
const shelves = new Map(); // shelfId -> { name, oldCats: Set<oldId>, newIds: Set<newId> }
for (const row of shelfRows) {
  const id = Number(row.shelf_id);
  if (!shelves.has(id)) shelves.set(id, { name: s(row.shelf_name), oldCats: new Set(), newIds: new Set() });
  const entry = shelves.get(id);
  entry.oldCats.add(Number(row.category_id));
  const cat = oldById.get(Number(row.category_id));
  if (!cat) continue;
  for (const code of codesForCat(cat)) {
    const newId = newIdByCode.get(code);
    if (newId) entry.newIds.add(newId);
  }
}

// Respaldo por nombre de estantería para las que quedaron vacías.
const emptyAfterMap = [];
for (const [id, sh] of shelves) {
  if (sh.newIds.size) continue;
  const codes = shelfFallbackByKey.get(norm(sh.name)) || [];
  for (const code of codes) {
    const newId = newIdByCode.get(code);
    if (newId) sh.newIds.add(newId);
  }
  if (!sh.newIds.size) emptyAfterMap.push(`${id} ${sh.name}`);
}

const mappedShelves = [...shelves.values()].filter((sh) => sh.newIds.size).length;
const totalNew = [...shelves.values()].reduce((acc, sh) => acc + sh.newIds.size, 0);
log(`   estanterías: ${shelves.size} · con categoría TIDCATE: ${mappedShelves} · asignaciones: ${totalNew}`);
if (emptyAfterMap.length) {
  log(`   ⚠️  sin equivalente (${emptyAfterMap.length}): ${emptyAfterMap.join(' · ')}`);
}

const show = newCats.filter((c) => [...shelves.values()].some((sh) => sh.newIds.has(Number(c.id))));
for (const sh of [...shelves.values()].slice(0, 6)) {
  const codes = show.filter((c) => sh.newIds.has(Number(c.id))).map((c) => c.code);
  log(`   ${sh.name} → ${codes.slice(0, 12).join(',')}${codes.length > 12 ? '…' : ''}`);
}

if (!APPLY) {
  log('\n🧪 DRY-RUN — nada escrito. Usa --apply para remapear.');
  await pg.end();
  process.exit(0);
}

// ─────────────────────────── aplicar ───────────────────────────
log('⏳ Reemplazando shelf_categories…');
const oldIds = oldCats.map((c) => Number(c.id));
await q('DELETE FROM shelf_categories WHERE category_id = ANY($1::bigint[])', [oldIds]);

const rows = [];
for (const [shelfId, sh] of shelves) {
  for (const categoryId of sh.newIds) rows.push([shelfId, categoryId]);
}
for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500);
  const values = chunk.map((_, j) => `($${j * 2 + 1},$${j * 2 + 2})`).join(',');
  await q(
    `INSERT INTO shelf_categories (shelf_id, category_id) VALUES ${values}
     ON CONFLICT DO NOTHING`,
    chunk.flat(),
  );
}

// Ocultar categorías viejas que ya no tengan productos ni referencias.
const hidden = await q(
  `UPDATE categories c SET is_active=false, updated_at=now()
    WHERE c.id = ANY($1::bigint[]) AND c.is_active
      AND NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.category_id=c.id)
      AND NOT EXISTS (SELECT 1 FROM shelf_categories sc WHERE sc.category_id=c.id)
      AND NOT EXISTS (SELECT 1 FROM saved_filters sf WHERE sf.category_ids @> to_jsonb(c.id))`,
  [oldIds],
);
log(`   asignaciones: ${rows.length} · categorías viejas ocultas: ${hidden.rowCount}`);
log('✅ Remapeo terminado.');
await pg.end();
