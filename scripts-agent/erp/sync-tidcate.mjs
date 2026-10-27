/**
 * Sincroniza el árbol de categorías TIDCATE (Advantage) → categories (Postgres).
 *
 * TIDCATE es la fuente de verdad de cómo se organizan los productos en el
 * ecommerce. Su jerarquía está codificada en CTABCOD por longitud:
 *   2 dígitos → nivel 0 (raíz)   01   Electrodomesticos
 *   4 dígitos → nivel 1          0101  Lavadoras-Secadoras
 *   6 dígitos → nivel 2 (hoja)   010101 Lavadora Secadora
 * El padre se deriva quitando los 2 últimos dígitos del código.
 *
 * No toca productos (product_categories se trata en `sync-catalog`). Sólo
 * deja el árbol de `categories` idéntico a TIDCATE: crea/renombra/re-parenta
 * los códigos de TIDCATE y desactiva los códigos que ya no existen.
 *
 * Uso:
 *   node scripts-agent/erp/sync-tidcate.mjs                 # dry-run
 *   node scripts-agent/erp/sync-tidcate.mjs --apply
 *   node scripts-agent/erp/sync-tidcate.mjs --from-adt --apply   # local (copia ADT)
 */
import { createErpClient, createPg } from './openads.mjs';
import { readAdt } from './adt.mjs';
import { s, args, log } from './lib.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const a = args();
const APPLY = !!a.apply;
const FROM_ADT = !!a['from-adt'];

const erp = createErpClient();
const pg = createPg();
await pg.connect();
await pg.query("SET app.erp_sync = 'on'");
const q = (t, p) => pg.query(t, p);

const slugify = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);

// ── Leer TIDCATE (ERP o copia ADT local) ──
const nodes = new Map(); // code -> { name, habilita }
if (FROM_ADT) {
  const adtPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../db/ads/fortuner-dicts/TIDCATE.ADT',
  );
  log(`⏳ Leyendo TIDCATE desde copia ADT: ${adtPath}`);
  const r = readAdt(adtPath);
  for (const row of r.rows) {
    const code = s(row.CTABCOD);
    if (!code) continue;
    nodes.set(code, { name: s(row.CTABDES) || code, habilita: String(row.HABILITA ?? '').trim() });
  }
} else {
  log('⏳ Leyendo TIDCATE del ERP…');
  const res = await erp.sql('SELECT CTABCOD, CTABDES, HABILITA FROM tidcate', { limit: 100000 });
  for (const r of res.rows) {
    const code = s(r[0]);
    if (!code) continue;
    nodes.set(code, { name: s(r[1]) || code, habilita: s(r[2]) });
  }
}
log(`   ${nodes.size} nodos TIDCATE`);

const parentOf = (code) => (code.length > 2 ? code.slice(0, -2) : null);
const levelOf = (code) => (code.length === 2 ? 0 : code.length === 4 ? 1 : 2);

// ── Estado actual en Postgres ──
const existing = await q('SELECT id, code, name, parent_id, level, slug, is_active FROM categories WHERE code IS NOT NULL');
const idByCode = new Map();
for (const r of existing.rows) idByCode.set(String(r.code).trim(), { id: Number(r.id), ...r });

// ── Upsert del árbol (de nivel 0 a 2, para resolver el parent_id) ──
const ordered = [...nodes.keys()].sort((x, y) => x.length - y.length || x.localeCompare(y));
const created = [];
const updated = [];
const toDeactivate = [];

for (const code of ordered) {
  const node = nodes.get(code);
  const parentCode = parentOf(code);
  const parentId = parentCode ? (idByCode.get(parentCode)?.id ?? null) : null;
  const level = levelOf(code);
  const isActive = node.habilita !== 'F'; // 'F' = inhabilitada; vacío/'T' = activa
  const slug = `${slugify(node.name) || 'cat'}-${code}`.slice(0, 100);
  const cur = idByCode.get(code);

  if (!APPLY) {
    if (!cur) created.push({ code, name: node.name, parentId, level });
    else if (
      cur.name !== node.name ||
      Number(cur.parent_id || 0) !== Number(parentId || 0) ||
      Number(cur.level || 0) !== level ||
      cur.is_active !== isActive
    ) {
      updated.push({ code, name: node.name, parentId, level, isActive });
    }
    idByCode.set(code, { id: cur?.id ?? -created.length, name: node.name, parent_id: parentId, level, is_active: isActive });
    continue;
  }

  const row = (
    await q(
      `INSERT INTO categories (parent_id, name, slug, code, level, is_active)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (code) WHERE (code IS NOT NULL AND deleted_at IS NULL)
       DO UPDATE SET
         parent_id = EXCLUDED.parent_id,
         name = EXCLUDED.name,
         level = EXCLUDED.level,
         is_active = EXCLUDED.is_active
       RETURNING id`,
      [parentId, node.name.slice(0, 100), slug, code, level, isActive],
    )
  ).rows[0];
  if (!cur) created.push({ code, name: node.name });
  else updated.push({ code, name: node.name });
  idByCode.set(code, { id: Number(row.id), name: node.name, parent_id: parentId, level, is_active: isActive });
}

// Categorías con código que ya no están en TIDCATE (p. ej. árbol TIDTAB viejo).
for (const [code, cur] of idByCode) {
  if (!nodes.has(code) && cur.is_active) toDeactivate.push({ code, name: cur.name });
}
if (APPLY && toDeactivate.length) {
  const codes = toDeactivate.map((c) => c.code);
  await q(
    `UPDATE categories SET is_active = false, updated_at = now()
      WHERE code = ANY($1::text[]) AND is_active`,
    [codes],
  );
}

log(
  `${APPLY ? '✅' : '🧪'} TIDCATE → categories: ${created.length} nuevas · ${updated.length} actualizadas · ` +
    `${toDeactivate.length} a desactivar${APPLY ? '' : ' (dry-run)'}`,
);

if (!APPLY) {
  log('\n🧪 DRY-RUN — nada escrito.');
  if (created.length) {
    log('   Nuevas:');
    for (const c of created.slice(0, 10)) log(`     ${c.code} → ${c.name} (parent ${c.parentId ?? '—'})`);
  }
  if (updated.length) {
    log('   Actualizadas (muestra):');
    for (const c of updated.slice(0, 10)) log(`     ${c.code} → ${c.name}`);
  }
  if (toDeactivate.length) {
    log('   A desactivar (códigos fuera de TIDCATE):');
    for (const c of toDeactivate.slice(0, 30)) log(`     ${c.code} = ${c.name}`);
    if (toDeactivate.length > 30) log(`     … y ${toDeactivate.length - 30} más`);
  }
}

await pg.end();
