// Distribución de rutas de `media.path` por prefijo, sin volcar filas.
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const r = await client.query(`
    SELECT
      split_part(path, '/', 2) AS seg2,
      split_part(path, '/', 3) AS seg3,
      count(*)::int AS n
    FROM media
    WHERE path LIKE '/static/%'
    GROUP BY 1, 2
    ORDER BY n DESC
  `);
  console.log('--- media.path por prefijo ---');
  console.log(JSON.stringify(r.rows, null, 2));

  const bad = await client.query(`
    SELECT id, path FROM media
    WHERE path LIKE 'http://localhost:3000/%'
    ORDER BY id
  `);
  console.log('--- filas localhost ---');
  console.log(JSON.stringify(bad.rows, null, 2));

  await client.end();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
