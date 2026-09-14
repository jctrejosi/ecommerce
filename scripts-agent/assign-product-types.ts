/**
 * Asigna product_type_assignments a partir de:
 *  1) fine-to-broad.json (tipo fino CATEGORIA -> tipo amplio)
 *  2) fallback por NOMBRE de producto (lotes pequeños a DeepSeek) para los que
 *     quedan en OTROS o sin tipo fino.
 *
 * Idempotente: reemplaza las asignaciones de los productos procesados.
 * Solo imprime agregados. Uso:
 *   (desde backend/)
 *   NODE_PATH=./node_modules ts-node --transpile-only --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' ../scripts-agent/assign-product-types.ts [--dry]
 */
import { readFileSync } from 'fs';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
loadEnv({ path: path.join(BACKEND, '.env.development.local') });

const DRY = process.argv.includes('--dry');
const trim = (v: unknown) => String(v ?? '').trim();
const load = (f: string) => JSON.parse(readFileSync(path.join(BACKEND, 'data/JSON', f), 'latin1'));

// env del bot para la API de DeepSeek
function botEnv() {
  const out: Record<string, string> = { ...process.env } as any;
  try {
    for (const line of readFileSync(path.join(ROOT, 'bot', '.env'), 'utf-8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}
const be = botEnv();
const API_KEY = be.DEEPSEEK_API_KEY;
const MODEL = be.DEEPSEEK_MODEL || 'deepseek-chat';
const API_URL = be.DEEPSEEK_API_URL || 'https://api.deepseek.com';

const TIPOS = ['CARNES', 'BEBE', 'CUIDADO', 'DESPENSA', 'ELECTRO', 'FRUTAS', 'HOGAR', 'LACTEOS', 'LIMPIEZA', 'MASCOTAS', 'TECNO', 'VINOS'];

async function clasificarNombres(items: { i: number; name: string }[]): Promise<Record<number, string>> {
  const lista = items.map((it) => `${it.i}. ${it.name}`).join('\n');
  const system =
    `Clasificas productos de un supermercado en UNA de estas categorías: ${TIPOS.join(', ')}.\n` +
    `Devuelve SOLO JSON {"<índice>": "<CATEGORÍA>"} para cada índice. Sin texto extra.`;
  for (let intento = 1; intento <= 3; intento++) {
    const resp = await fetch(`${API_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Clasifica:\n${lista}` },
        ],
        temperature: 0.1,
        max_tokens: 6000,
      }),
    });
    if (!resp.ok) continue;
    const data: any = await resp.json();
    const content: string = data.choices?.[0]?.message?.content ?? '';
    const s = content.indexOf('{');
    const e = content.lastIndexOf('}');
    if (s < 0 || e < 0) continue;
    try {
      const raw = JSON.parse(content.slice(s, e + 1));
      const out: Record<number, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        const idx = Number(k);
        const tipo = typeof v === 'string' ? v.trim().toUpperCase() : '';
        if (Number.isFinite(idx) && TIPOS.includes(tipo)) out[idx] = tipo;
      }
      return out;
    } catch {
      continue;
    }
  }
  return {};
}

async function main() {
  const mapping: Record<string, string> = JSON.parse(readFileSync(path.join(__dirname, 'fine-to-broad.json'), 'utf-8'));
  const catalog = load('CATALOGO.JSON').PRODUCTOS as any[];
  const fineByExternal = new Map<string, string>();
  for (const p of catalog) fineByExternal.set(trim(p.CODIGO), trim(p.CATEGORIA));

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const typeRows = await client.query(`SELECT id, code FROM product_types`);
  const typeId = new Map<string, number>();
  for (const t of typeRows.rows) typeId.set(String(t.code).toUpperCase(), Number(t.id));
  const missingTypes = TIPOS.filter((t) => !typeId.has(t));
  if (missingTypes.length) console.warn('⚠️ Tipos que no existen en la BD (se omiten):', missingTypes.join(', '));

  const products = await client.query(
    `SELECT id, external_id, name FROM products WHERE deleted_at IS NULL ORDER BY id`,
  );

  const desired = new Map<number, string>(); // productId -> broad type
  const pendientes: { i: number; name: string; pid: number }[] = [];
  let i = 0;
  for (const p of products.rows) {
    const pid = Number(p.id);
    const fine = fineByExternal.get(trim(p.external_id)) ?? '';
    const broad = mapping[fine];
    if (broad && broad !== 'OTROS' && typeId.has(broad)) desired.set(pid, broad);
    else pendientes.push({ i: i++, name: trim(p.name), pid });
  }
  console.log(`Directos por tipo fino: ${desired.size} | pendientes por nombre: ${pendientes.length}`);

  // Fallback por nombre en lotes
  const BATCH = 40;
  let clasificados = 0;
  for (let b = 0; b < pendientes.length; b += BATCH) {
    const lote = pendientes.slice(b, b + BATCH);
    const res = await clasificarNombres(lote.map(({ i, name }) => ({ i, name })));
    for (const it of lote) {
      const tipo = res[it.i];
      if (tipo && typeId.has(tipo)) {
        desired.set(it.pid, tipo);
        clasificados++;
      }
    }
    console.log(`  fallback lote ${Math.floor(b / BATCH) + 1}/${Math.ceil(pendientes.length / BATCH)}: +${Object.keys(res).length}`);
  }

  const porTipo = new Map<string, number>();
  for (const t of desired.values()) porTipo.set(t, (porTipo.get(t) ?? 0) + 1);
  console.log('Asignaciones propuestas:', desired.size, '| sin asignar:', products.rowCount - desired.size);
  for (const [t, n] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${t}: ${n}`);

  if (DRY) {
    console.log('(--dry) No se escribió en la BD.');
    await client.end();
    return;
  }

  const role = await client.query(`SELECT id FROM users ORDER BY id LIMIT 1`);
  const ids = [...desired.keys()];
  await client.query('BEGIN');
  try {
    await client.query(`DELETE FROM product_type_assignments WHERE product_id = ANY($1::bigint[])`, [ids]);
    // Insert en bloques
    const values: any[] = [];
    const params: any[] = [];
    let n = 1;
    for (const [pid, tipo] of desired) {
      values.push(`($${n++}, $${n++})`);
      params.push(pid, typeId.get(tipo)!);
    }
    const CHUNK = 1000;
    for (let k = 0; k < values.length; k += CHUNK) {
      const vchunk = values.slice(k, k + CHUNK);
      const pchunk = params.slice(k * 2, (k + CHUNK) * 2);
      const renum = vchunk.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2})`).join(',');
      await client.query(`INSERT INTO product_type_assignments (product_id, product_type_id) VALUES ${renum}`, pchunk);
    }
    await client.query('COMMIT');
    console.log('✅ Escrito en la BD:', desired.size, 'asignaciones.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }

  const check = await client.query(`
    SELECT pt.code, count(DISTINCT pta.product_id)::int AS n
    FROM product_types pt
    LEFT JOIN product_type_assignments pta ON pta.product_type_id = pt.id
    GROUP BY pt.code ORDER BY n DESC`);
  console.log('Verificación BD:', check.rows.map((r) => `${r.code}=${r.n}`).join(' '));
  await client.end();
}

void main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
