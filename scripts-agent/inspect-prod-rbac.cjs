/**
 * Inspección SOLO LECTURA del estado de RBAC (usuarios/roles/permisos) y del
 * esquema de esas tablas en LOCAL vs PRODUCCIÓN (Supabase).
 *
 * No modifica nada. Lee las URLs desde backend/.env.development.local.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/inspect-prod-rbac.cjs
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BACKEND_DIR = path.resolve(__dirname, '..', 'backend');

function parseEnv(filePath) {
  const result = {};
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function mask(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//***@${u.hostname}:${u.port || 5432}/${(u.pathname || '').replace(/^\//, '')}`;
  } catch {
    return String(url).replace(/\/\/[^@]*@/, '//***@');
  }
}

const RBAC_TABLES = ['roles', 'permissions', 'role_permissions', 'user_roles', 'users'];

async function tables(client) {
  const r = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return new Set(r.rows.map((x) => x.tablename));
}

async function columns(client, table) {
  const r = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return r.rows;
}

async function inspect(label, url, ssl) {
  const c = new Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await c.connect();
  const tset = await tables(c);
  console.log(`\n===== ${label} =====`);
  console.log(`host: ${mask(url)}`);
  const out = { tableSet: tset, counts: {}, cols: {} };
  for (const t of RBAC_TABLES) {
    if (!tset.has(t)) {
      console.log(`  ✗ ${t}: NO EXISTE`);
      continue;
    }
    const cnt = (await c.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;
    out.counts[t] = cnt;
    out.cols[t] = await columns(c, t);
    console.log(`  ✓ ${t}: ${cnt} filas`);
  }
  await c.end();
  return out;
}

async function main() {
  const envPath = path.join(BACKEND_DIR, '.env.development.local');
  const env = parseEnv(envPath);
  const LOCAL_URL = env.LOCAL_DATABASE_URL || env.DATABASE_URL;
  const PROD_URL = env.PROD_DATABASE_URL;

  if (!LOCAL_URL) throw new Error('No se encontró DATABASE_URL/LOCAL_DATABASE_URL local.');
  if (!PROD_URL || PROD_URL.includes('user:password@host')) throw new Error('No se encontró PROD_DATABASE_URL.');

  const local = await inspect('LOCAL', LOCAL_URL, false);
  const prod = await inspect('PRODUCCIÓN (Supabase)', PROD_URL, { rejectUnauthorized: false });

  console.log('\n===== DIFERENCIAS (RBAC) =====');
  for (const t of RBAC_TABLES) {
    const lc = local.counts[t];
    const pc = prod.counts[t];
    if (lc === undefined && pc === undefined) continue;
    if (lc !== pc) {
      console.log(`  ${t}: local=${lc ?? '∅'} prod=${pc ?? '∅'}  ← DIFERENCIA`);
    }
  }

  console.log('\n===== DIFERENCIAS DE ESQUEMA (columnas) =====');
  for (const t of RBAC_TABLES) {
    const lcols = local.cols[t] || [];
    const pcols = prod.cols[t] || [];
    if (!lcols.length && !pcols.length) continue;
    const lnames = new Set(lcols.map((c) => c.column_name));
    const pnames = new Set(pcols.map((c) => c.column_name));
    const onlyLocal = [...lnames].filter((x) => !pnames.has(x));
    const onlyProd = [...pnames].filter((x) => !lnames.has(x));
    if (onlyLocal.length || onlyProd.length) {
      console.log(`  ${t}:`);
      if (onlyLocal.length) console.log(`    solo en LOCAL:  ${onlyLocal.join(', ')}`);
      if (onlyProd.length) console.log(`    solo en PROD:   ${onlyProd.join(', ')}`);
    }
  }
  console.log('\n(inspección terminada — sin cambios)');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
