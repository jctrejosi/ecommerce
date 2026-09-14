/**
 * Inspección (solo lectura) del estado de product_type_assignments.
 *
 * No imprime filas: solo agregados y una muestra corta, para no llenar el
 * contexto del agente. Ejecutar desde backend/:
 *   NODE_PATH=./node_modules ./node_modules/.bin/ts-node --transpile-only \
 *     --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' \
 *     ../scripts-agent/inspect-product-types.ts
 */
import { readFileSync } from 'fs';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

const BACKEND = path.resolve(__dirname, '../backend');
loadEnv({ path: path.join(BACKEND, '.env.development.local') });

const trim = (v: unknown) => String(v ?? '').trim();

function loadJson(file: string): any {
  return JSON.parse(readFileSync(path.join(BACKEND, 'data/JSON', file), 'latin1'));
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  // ¿A qué apunta la conexión? (solo host, sin credenciales)
  const host = await client.query('SELECT current_database() AS db, inet_server_addr() AS host');
  console.log('BD:', host.rows[0].db, '| host:', host.rows[0].host);

  const totals = await client.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE deleted_at IS NULL)::int AS vivos
    FROM products`);
  console.log('Productos:', totals.rows[0]);

  const assigned = await client.query(`
    SELECT count(DISTINCT pta.product_id)::int AS con_tipo,
           count(*)::int AS filas
    FROM product_type_assignments pta
    JOIN products p ON p.id = pta.product_id
    WHERE p.deleted_at IS NULL`);
  console.log('Asignaciones:', assigned.rows[0]);

  const types = await client.query(`
    SELECT pt.id, pt.code, pt.name, pt.is_active,
           count(DISTINCT p.id)::int AS productos
    FROM product_types pt
    LEFT JOIN product_type_assignments pta ON pta.product_type_id = pt.id
    LEFT JOIN products p ON p.id = pta.product_id AND p.deleted_at IS NULL
    GROUP BY pt.id, pt.code, pt.name, pt.is_active
    ORDER BY productos DESC, pt.name ASC`);
  console.log('Tipos de producto:', types.rowCount);
  const vacios = types.rows.filter((r) => r.productos === 0);
  console.log('Tipos SIN productos:', vacios.length, '-', vacios.slice(0, 15).map((r) => r.code).join(', '));
  console.log('Muestra tipos con conteo:', types.rows.slice(0, 10).map((r) => `${r.code}=${r.productos}`).join(' '));

  // Regla de mapeo por origen: products.external_id -> CATALOGO.CATEGORIA -> product_types.code
  const catalog: { PRODUCTOS?: any[] } = loadJson('CATALOGO.JSON');
  const catByExternalId = new Map<string, string>();
  for (const p of catalog.PRODUCTOS ?? []) {
    const ext = trim(p.CODIGO);
    const cat = trim(p.CATEGORIA);
    if (ext) catByExternalId.set(ext, cat);
  }
  const typeByCode = new Map<string, { id: number; name: string }>();
  for (const t of types.rows) typeByCode.set(trim(t.code), { id: Number(t.id), name: t.name });

  const missing = await client.query(`
    SELECT p.id, p.external_id
    FROM products p
    WHERE p.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM product_type_assignments a WHERE a.product_id = p.id)`);

  let resolubles = 0;
  const porTipo = new Map<string, number>();
  const noResuelve: string[] = [];
  for (const row of missing.rows) {
    const ext = trim(row.external_id);
    const code = catByExternalId.get(ext) ?? '';
    if (code && typeByCode.has(code)) {
      resolubles++;
      porTipo.set(code, (porTipo.get(code) ?? 0) + 1);
    } else {
      noResuelve.push(ext || `id:${row.id}`);
    }
  }
  console.log('Sin asignación:', missing.rowCount, '| resolubles por regla:', resolubles, '| no resuelven:', noResuelve.length);
  console.log('Distribución resoluble:', [...porTipo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([c, n]) => `${c}=${n}`).join(' '));
  if (noResuelve.length) console.log('Muestra no resuelven:', noResuelve.slice(0, 15).join(', '));

  await client.end();
}

void main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
