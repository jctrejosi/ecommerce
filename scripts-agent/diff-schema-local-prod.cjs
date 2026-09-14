/**
 * SOLO LECTURA. Compara el ESQUEMA (tablas y columnas) entre LOCAL y PRODUCCIÓN.
 * No modifica nada.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/diff-schema-local-prod.cjs
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BACKEND_DIR = path.resolve(__dirname, '..', 'backend');

function parseEnv(f) {
  const r = {};
  for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    r[k] = v;
  }
  return r;
}

async function schema(url, ssl) {
  const c = new Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await c.connect();
  const tabs = (await c.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  )).rows.map((x) => x.tablename);
  const cols = {};
  for (const t of tabs) {
    const r = await c.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [t],
    );
    cols[t] = r.rows;
  }
  await c.end();
  return { tabs: new Set(tabs), cols };
}

async function main() {
  const env = parseEnv(path.join(BACKEND_DIR, '.env.development.local'));
  const L = env.LOCAL_DATABASE_URL || env.DATABASE_URL;
  const P = env.PROD_DATABASE_URL;
  if (!L || !P) throw new Error('Faltan URLs');

  const [a, b] = await Promise.all([
    schema(L, false),
    schema(P, { rejectUnauthorized: false }),
  ]);

  const onlyLocal = [...a.tabs].filter((t) => !b.tabs.has(t));
  const onlyProd = [...a.tabs].filter(() => false).concat([...b.tabs].filter((t) => !a.tabs.has(t)));

  console.log('TABLAS solo en LOCAL:', onlyLocal.length ? onlyLocal.join(', ') : '(ninguna)');
  console.log('TABLAS solo en PROD :', onlyProd.length ? onlyProd.join(', ') : '(ninguna)');

  console.log('\nDIFERENCIAS DE COLUMNAS (tablas presentes en ambos):');
  let total = 0;
  for (const t of [...a.tabs].filter((t) => b.tabs.has(t)).sort()) {
    const ac = a.cols[t] || [];
    const bc = b.cols[t] || [];
    const aNames = new Set(ac.map((x) => x.column_name));
    const bNames = new Set(bc.map((x) => x.column_name));
    const onlyA = [...aNames].filter((x) => !bNames.has(x));
    const onlyB = [...bNames].filter((x) => !aNames.has(x));
    if (onlyA.length || onlyB.length) {
      total += onlyA.length + onlyB.length;
      console.log(`\n  ${t}:`);
      if (onlyA.length) console.log(`    solo en LOCAL: ${onlyA.join(', ')}`);
      if (onlyB.length) console.log(`    solo en PROD : ${onlyB.join(', ')}`);
    }
  }
  console.log(total ? `\n⚠ ${total} columnas difieren.` : '\n✅ Esquema idéntico.');
  console.log('(inspección terminada — sin cambios)');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
