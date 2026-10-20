// Exporta las rutas de imágenes de producto referenciadas por la BD,
// relativas a la carpeta db/ (para tar -C db). Una por línea.
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const r = await client.query(`
    SELECT DISTINCT path
    FROM media
    WHERE path LIKE '/static/products/%'
    ORDER BY path
  `);
  for (const row of r.rows) {
    const rel = row.path.slice('/static/products/'.length);
    process.stdout.write(`db/images_static/products/${rel}\n`);
  }
  await client.end();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
