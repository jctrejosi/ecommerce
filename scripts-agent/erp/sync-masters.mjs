/**
 * Sincroniza los MAESTROS del ERP (Advantage) hacia Postgres, en vivo (no usa
 * las copias .ADT): marcas, tipos de producto, categorías y bodegas.
 *
 *   TIDMARCAS → brands           (upsert por code; renombra)
 *   TIDTPRO   → product_types    (upsert por code; renombra)
 *   TIDTAB    → categories       (upsert por code; renombra + re-parent + nivel)
 *   TIDBODE   → branches         (upsert por code; renombra)
 *
 * Modelo: mismo que sync-catalog.mjs — diff por huella contra `erp_snapshot`
 * (erp_table = 'TIDMARCAS' | 'TIDTPRO' | 'TIDTAB' | 'TIDBODE') y merge por
 * CÓDIGO ERP (no por nombre). Corre con `SET app.erp_sync='on'` para no
 * reencolar lo que viene del ERP.
 *
 * Bajas: con `--prune` desactiva (nunca borra) las filas ERP que ya no están en
 * el maestro correspondiente. Sin `--prune` solo crea y actualiza.
 *
 * Tipos activos: por defecto NO toca `product_types.is_active` (respeta los que
 * estén curados en la web). Con `--types-active=erp` copia `TIDTPRO.HABILITA`.
 *
 * Uso:
 *   node scripts-agent/erp/sync-masters.mjs --dry-run
 *   node scripts-agent/erp/sync-masters.mjs
 *   node scripts-agent/erp/sync-masters.mjs --prune --types-active=erp
 *   node scripts-agent/erp/sync-masters.mjs --reset-snapshot
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, sha1, args, log } from './lib.mjs';

const a = args();
const DRY = !!a['dry-run'];
const PRUNE = !!a.prune;
const TYPES_ACTIVE_ERP = !!a['types-active=erp'];
const RESET = !!a['reset-snapshot'];

const slugify = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);

/** Código de bodega normalizado: "01" → "1" (TIDSAL.INSUC usa 1, 2, 11). */
const normCode = (v) => {
  const raw = String(v ?? '').trim();
  const num = Number(raw);
  if (raw !== '' && Number.isFinite(num)) return String(Math.trunc(num));
  return raw.replace(/^0+/, '') || '0';
};

const erp = createErpClient();
const pg = createPg();
await pg.connect();
await pg.query("SET app.erp_sync = 'on'");
const q = (t, p) => pg.query(t, p);

async function loadAll(sql, limit = 5000) {
  const out = [];
  let offset = 0;
  for (;;) {
    const res = await erp.sql(sql, { limit, offset });
    if (!res.rows.length) break;
    out.push(...res.rows);
    if (res.rows.length < limit) break;
    offset += res.rows.length;
  }
  return out;
}

/** Aplica/guarda el snapshot de una tabla y devuelve las claves con cambios. */
async function changedKeys(erpTable, hashes) {
  if (RESET && !DRY) await q('DELETE FROM erp_snapshot WHERE erp_table = $1', [erpTable]);
  const snap = new Map(
    (await q('SELECT erp_key, hash FROM erp_snapshot WHERE erp_table = $1', [erpTable])).rows.map(
      (r) => [r.erp_key, r.hash],
    ),
  );
  const changed = [...hashes.entries()].filter(([k, h]) => snap.get(k) !== h).map(([k]) => k);
  if (!DRY) {
    const rows = [...hashes.entries()];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      let idx = 0;
      const params = [];
      const tuples = chunk.map(([k, h]) => {
        params.push(k, h, erpTable);
        return `($${++idx},$${++idx},$${++idx},now())`;
      });
      await pg.query(
        `INSERT INTO erp_snapshot (erp_key, hash, erp_table, synced_at)
         VALUES ${tuples.join(',')}
         ON CONFLICT (erp_key, erp_table) DO UPDATE SET hash=EXCLUDED.hash, synced_at=now()`,
        params,
      );
    }
  }
  return changed;
}

const storeId = (await q('SELECT id FROM store ORDER BY id LIMIT 1')).rows[0]?.id;
const NOW = new Date().toISOString();

// ─────────────────────────── marcas (TIDMARCAS) ───────────────────────────

log('⏳ Leyendo TIDMARCAS…');
const brands = await loadAll('SELECT MCODIGO, MNOMBRE FROM tidmarcas');
const brandByCode = new Map();
const brandHashes = new Map();
for (const r of brands) {
  const code = s(r[0]);
  const name = s(r[1]).trim();
  if (!code || !name) continue;
  brandByCode.set(code, name);
  brandHashes.set(code, sha1([code, name]));
}
const brandChanged = await changedKeys('TIDMARCAS', brandHashes);
let bUp = 0;
let bErr = 0;
for (const code of brandChanged) {
  const name = brandByCode.get(code);
  if (!name) continue;
  if (DRY) {
    bUp++;
    continue;
  }
  const nm = name.slice(0, 100);
  try {
    // 1) ya existe por código → renombrar (esto refleja el cambio del ERP).
    const byCode = await q('SELECT id FROM brands WHERE code = $1 AND deleted_at IS NULL LIMIT 1', [code]);
    if (byCode.rows[0]) {
      const owner = await q('SELECT id FROM brands WHERE name = $1 AND id <> $2 LIMIT 1', [nm, byCode.rows[0].id]);
      if (owner.rows[0]) throw new Error(`nombre ya usado por brand ${owner.rows[0].id}`);
      await q('UPDATE brands SET name = $1, is_active = true, updated_at = $2 WHERE id = $3', [nm, NOW, byCode.rows[0].id]);
    } else {
      // 2) existe por nombre (activo o borrado) → adoptar el código y revivir si hacía falta.
      const byName = await q(
        "SELECT id, deleted_at FROM brands WHERE lower(name) = lower($1) ORDER BY (deleted_at IS NULL) DESC, (code IS NULL) DESC LIMIT 1",
        [nm],
      );
      if (byName.rows[0]) {
        await q(
          'UPDATE brands SET code = $1, name = $2, is_active = true, deleted_at = NULL, updated_at = $3 WHERE id = $4',
          [code, nm, NOW, byName.rows[0].id],
        );
      } else {
        // 3) nuevo.
        const slug = `${slugify(nm) || 'marca'}-${code}`.slice(0, 100);
        await q(
          `INSERT INTO brands (code, name, slug, website, description, country, is_active, created_at, updated_at)
           VALUES ($1,$2,$3,'','Importado ERP (TIDMARCAS)','',true,$4,$4)
           ON CONFLICT (code) WHERE (code IS NOT NULL AND deleted_at IS NULL)
           DO UPDATE SET name=EXCLUDED.name, is_active=true, updated_at=EXCLUDED.updated_at`,
          [code, nm, slug, NOW],
        );
      }
    }
    bUp++;
  } catch (e) {
    bErr++;
    log(`⚠️ marca ${code} "${nm}": ${String(e.message).slice(0, 120)}`);
  }
}
log(`🏷️  Marcas: ${brandByCode.size} en ERP · ${bUp} actualizadas · ${bErr} conflictos`);

// ─────────────────────────── tipos (TIDTPRO) ───────────────────────────

log('⏳ Leyendo TIDTPRO…');
const types = await loadAll('SELECT CODIGO, NOMBRE, HABILITA FROM tidtpro');
const typeByCode = new Map();
const typeHashes = new Map();
for (const r of types) {
  const code = s(r[0]);
  const name = s(r[1]).trim();
  if (!code || !name) continue;
  const hab = s(r[2]).toUpperCase() === 'T';
  typeByCode.set(code, { name, hab });
  typeHashes.set(code, sha1([code, name, hab]));
}
const typeChanged = await changedKeys('TIDTPRO', typeHashes);
let tUp = 0;
for (const code of typeChanged) {
  const { name, hab } = typeByCode.get(code);
  const active = TYPES_ACTIVE_ERP ? hab : false;
  if (!DRY) {
    await q(
      `INSERT INTO product_types (code, name, description, is_active, created_at, updated_at)
       VALUES ($1,$2,'Importado ERP',$3,$4,$4)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name` +
        (TYPES_ACTIVE_ERP ? ', is_active=EXCLUDED.is_active, updated_at=EXCLUDED.updated_at' : ''),
      [code.slice(0, 10), name.slice(0, 100), active, NOW],
    );
  }
  tUp++;
}
log(`🆔 Tipos: ${typeByCode.size} en ERP · ${tUp} actualizados${TYPES_ACTIVE_ERP ? ' (is_active=HABILITA)' : ''}`);

// ─────────────────────────── categorías (TIDTAB) ───────────────────────────

log('⏳ Leyendo TIDTAB…');
const tabs = await loadAll('SELECT CTABCOD, CTABDES, CTABCOD1 FROM tidtab');
const catName = new Map();
const catParent = new Map();
const catHashes = new Map();
for (const r of tabs) {
  const code = s(r[0]);
  if (!code) continue;
  catName.set(code, s(r[1]) || code);
  catParent.set(code, s(r[2]) || null);
  catHashes.set(code, sha1([code, s(r[1]), s(r[2])]));
}
const catChanged = await changedKeys('TIDTAB', catHashes);
const catIdByCode = new Map(
  (await q('SELECT id, code FROM categories WHERE code IS NOT NULL')).rows.map((r) => [s(r.code), Number(r.id)]),
);
// padres antes que hijos (códigos más cortos primero)
const catOrder = [...catChanged].sort((x, y) => x.length - y.length || x.localeCompare(y));
let cUp = 0;
for (const code of catOrder) {
  const name = (catName.get(code) || `Categoría ERP ${code}`).slice(0, 100);
  const parentCode = catParent.get(code) || null;
  const parentId = parentCode ? catIdByCode.get(parentCode) ?? null : null;
  let level = 0;
  for (let cur = parentCode, g = 0; cur && g < 20; g++) {
    level++;
    cur = catParent.get(cur) || null;
  }
  const slug = `${slugify(name) || 'cat'}-${code}`.slice(0, 100);
  if (!DRY) {
    const r = (
      await q(
        `INSERT INTO categories (parent_id, name, slug, code, level, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,true,$6,$6)
         ON CONFLICT (code) WHERE (code IS NOT NULL AND deleted_at IS NULL)
         DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id,
           level=EXCLUDED.level, is_active=true, updated_at=EXCLUDED.updated_at
         RETURNING id`,
        [parentId, name, slug, code, level, NOW],
      )
    ).rows[0];
    catIdByCode.set(code, Number(r.id));
  }
  cUp++;
}
log(`🌳 Categorías: ${catName.size} en ERP · ${cUp} actualizadas`);

// ─────────────────── bodegas (TIDBODE) + nombres (TIDSUCUR) ───────────────────

const cleanName = (v) => v.replace(/^[A-Z]{1,3}\.\s*/, '').trim();

log('⏳ Leyendo TIDBODE y TIDSUCUR…');
const bodes = await loadAll('SELECT CODIGO FROM tidbode');
const bodeCodes = [...new Set(bodes.map((r) => normCode(r[0])).filter(Boolean))];

// Existencia: una branch por bodega (código 1, 2, 11). El nombre se resuelve abajo.
let boUp = 0;
for (const code of bodeCodes) {
  if (!DRY) {
    await q(
      `INSERT INTO branches (code, name, address, city, phone, store_id, email, manager_name, manager_phone, branch_type, location, is_active, created_at, updated_at)
       VALUES ($1,$2,'PENDIENTE (ERP)','Manizales','0000000',$3,$4,'PENDIENTE','0000000','STORE','0,0',true,$5,$5)
       ON CONFLICT (code) DO NOTHING`,
      [code, `TID Sucursal ${code}`, storeId, `sucursal${code}@pendiente.local`, NOW],
    );
  }
  boUp++;
}

// Nombres amigables desde TIDSUCUR: SUCURSAL '011' → bodega '01' → 'MERCALDAS CENTRO'.
// Preferimos el punto principal (tercer carácter '1' = S., supermercado).
const sucurs = await loadAll('SELECT SUCURSAL, CTNOMBRE FROM tidsucur');
const nameByBodega = new Map();
for (const r of sucurs) {
  const suc = s(r[0]).trim();
  if (suc.length < 2) continue;
  const bodega = normCode(suc.slice(0, 2));
  if (!bodeCodes.includes(bodega)) continue; // solo las bodegas reales de TIDBODE
  const name = cleanName(s(r[1]));
  if (!name) continue;
  const kind = suc.slice(2);
  if (!nameByBodega.has(bodega) || kind === '1') nameByBodega.set(bodega, name);
}
const nameHashes = new Map([...nameByBodega.entries()].map(([c, n]) => [c, sha1([c, n])]));
const nameChanged = await changedKeys('TIDSUCUR', nameHashes);
for (const code of nameChanged) {
  const name = nameByBodega.get(code);
  if (!name) continue;
  if (!DRY) {
    await q('UPDATE branches SET name = $1, updated_at = $2 WHERE code = $3 AND deleted_at IS NULL', [name.slice(0, 100), NOW, code]);
  }
  boUp++;
}
log(`🏬 Bodegas: ${bodeCodes.length} aseguradas · ${nameByBodega.size} nombres desde TIDSUCUR (${boUp} tocadas)`);

// ─────────────────────────── bajas (opcional) ───────────────────────────

if (PRUNE) {
  const brandCodes = [...brandByCode.keys()];
  const catCodes = [...catName.keys()];
  let rb = 0;
  let rc = 0;
  if (!DRY) {
    rb = (
      await q(
        `UPDATE brands SET is_active=false, updated_at=now()
          WHERE code IS NOT NULL AND description LIKE 'Importado ERP%'
            AND NOT (code = ANY($1::text[]))`,
        [brandCodes],
      )
    ).rowCount;
    rc = (
      await q(
        `UPDATE categories SET is_active=false, updated_at=now()
          WHERE code IS NOT NULL AND NOT (code = ANY($1::text[]))
            AND NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.category_id=categories.id)`,
        [catCodes],
      )
    ).rowCount;
  }
  log(`🧹 Prune: ${rb} marcas y ${rc} categorías desactivadas`);
} else {
  log('🧹 Prune desactivado (usa --prune para desactivar bajas del ERP)');
}

log(`\n${DRY ? '🧪 DRY-RUN — nada escrito.' : '✅ Maestros sincronizados.'}`);
await pg.end();
