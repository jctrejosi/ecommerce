// Verificar tablas creadas en Supabase
const { Client } = require('/home/jk/Projects/dsi/mercaldas-ecommerce/backend/node_modules/pg');

const url =
  'postgresql://postgres.idiypzqlbjeqgphjlabz:Ju%40n5826227567@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require';

async function main() {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  try {
    await c.connect();
    const t = await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
    );
    console.log('[INFO] Tablas en Supabase:', t.rows.length);
    console.log(t.rows.map((x) => x.table_name).join(', '));
    await c.end();
  } catch (e) {
    console.log('[FAIL]', e.code || '', e.message);
    try { await c.end(); } catch {}
  }
}

main();
