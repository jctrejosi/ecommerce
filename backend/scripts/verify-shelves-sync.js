// Verifica que estanterías y ubicaciones sean idénticas entre dos URLs
// Uso: node scripts/verify-shelves-sync.js <url1> <url2>
const { Pool } = require('pg');

async function snapshot(url) {
  const pool = new Pool({
    connectionString: url,
    ssl: /sslmode=require|ssl=true|pooler\.supabase/i.test(url) ? { rejectUnauthorized: false } : false,
  });
  const out = { shelves: {}, locations: {} };
  const s = await pool.query(
    `SELECT md5(string_agg(id::text||':'||branch_id||':'||code||':'||pos_x||':'||pos_y||':'||width||':'||height||':'||rotation, ',' ORDER BY id)) h
     FROM shelves`,
  );
  out.shelvesHash = s.rows[0].h;
  const r = await pool.query(
    `SELECT branch_id, count(*) n,
       md5(string_agg(product_variant_id::text||':'||shelf_id::text||':'||row_number::text, ',' ORDER BY product_variant_id)) h
     FROM product_locations GROUP BY branch_id ORDER BY branch_id`,
  );
  for (const row of r.rows) out.locations[Number(row.branch_id)] = { n: row.n, h: row.h };
  const rows = await pool.query('SELECT count(*) n FROM shelf_rows');
  out.shelfRows = rows.rows[0].n;
  await pool.end();
  return out;
}

(async () => {
  const [url1, url2] = process.argv.slice(2);
  if (!url1 || !url2) {
    console.error('Uso: node scripts/verify-shelves-sync.js <url1> <url2>');
    process.exit(1);
  }
  const [a, b] = await Promise.all([snapshot(url1), snapshot(url2)]);
  const branchIds = [...new Set([...Object.keys(a.locations), ...Object.keys(b.locations)])].sort(
    (x, y) => Number(x) - Number(y),
  );
  let ok = true;
  console.log(`shelves hash  ${a.shelvesHash === b.shelvesHash ? '✅ igual' : `❌ ${a.shelvesHash} vs ${b.shelvesHash}`}`);
  console.log(`shelf_rows    ${a.shelfRows === b.shelfRows ? `✅ ${a.shelfRows}` : `❌ ${a.shelfRows} vs ${b.shelfRows}`}`);
  for (const id of branchIds) {
    const la = a.locations[id];
    const lb = b.locations[id];
    const same = la && lb && la.n === lb.n && la.h === lb.h;
    if (!same) ok = false;
    console.log(`branch ${id}: ${same ? '✅' : '❌'} ${la ? `${la.n} · ${la.h}` : 'N/A'} vs ${lb ? `${lb.n} · ${lb.h}` : 'N/A'}`);
  }
  console.log(ok ? '\n✅ LOCAL == PRODUCCIÓN (estanterías y ubicaciones)' : '\n❌ HAY DIFERENCIAS');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
