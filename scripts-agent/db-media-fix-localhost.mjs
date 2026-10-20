// Normaliza las rutas de media que quedaron con el host de desarrollo
// (http://localhost:3000/static/...) a rutas relativas (/static/...).
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const r = await client.query(`
    UPDATE media
    SET path = regexp_replace(path, '^http://localhost:3000', '')
    WHERE path LIKE 'http://localhost:3000/%'
    RETURNING id, path
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  await client.end();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
