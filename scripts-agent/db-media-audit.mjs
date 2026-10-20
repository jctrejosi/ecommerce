// Auditoría de columnas de medios: cuenta rutas locales/absolutas y muestra
// prefijos, sin volcar filas. Uso:
//   docker exec -i -w /app/backend mercaldas_app node - < db-media-audit.mjs
const { Client } = require('pg');

const nameRe = /(image|img|url|path|avatar|photo|logo|media|banner|icon|picture)/i;

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const cols = await client.query(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying')
    ORDER BY table_name, column_name
  `);

  const rows = [];
  for (const c of cols.rows) {
    if (!nameRe.test(c.column_name)) continue;
    const t = `"${c.table_schema}"."${c.table_name}"`;
    const col = `"${c.column_name}"`;
    const q = `
      SELECT
        count(*) FILTER (WHERE ${col} IS NOT NULL AND ${col} <> '')::int AS total,
        count(*) FILTER (WHERE ${col} LIKE '/static/%')::int AS rel_static,
        count(*) FILTER (WHERE ${col} LIKE 'http://localhost:3000/%')::int AS dev_localhost,
        count(*) FILTER (WHERE ${col} LIKE 'http://127.0.0.1%')::int AS dev_loopback,
        count(*) FILTER (WHERE ${col} LIKE 'http://%' AND ${col} NOT LIKE 'http://localhost:3000/%' AND ${col} NOT LIKE 'http://127.0.0.1%')::int AS http_other,
        count(*) FILTER (WHERE ${col} LIKE 'https://%')::int AS https_any,
        count(*) FILTER (WHERE ${col} LIKE '%res.cloudinary.com/%')::int AS cloudinary
      FROM ${t}
    `;
    try {
      const r = (await client.query(q)).rows[0];
      if (r.total > 0) rows.push({ table: c.table_name, column: c.column_name, ...r });
    } catch (e) {
      rows.push({ table: c.table_name, column: c.column_name, error: e.message });
    }
  }

  console.log(JSON.stringify(rows, null, 2));

  const prefixes = new Set();
  for (const c of cols.rows) {
    if (!nameRe.test(c.column_name)) continue;
    const t = `"${c.table_schema}"."${c.table_name}"`;
    const col = `"${c.column_name}"`;
    try {
      const r = await client.query(`
        SELECT DISTINCT substring(${col} from 1 for 50) AS p
        FROM ${t}
        WHERE ${col} LIKE 'http://localhost:3000/%'
        LIMIT 30
      `);
      for (const x of r.rows) prefixes.add(`${c.table_name}.${c.column_name} => ${x.p}`);
    } catch {}
  }

  console.log('--- prefijos localhost ---');
  console.log([...prefixes].join('\n'));

  await client.end();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
