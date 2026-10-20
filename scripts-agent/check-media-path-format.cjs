/**
 * Muestra corta del formato de `media.path` (relativo vs absoluto) para decidir
 * cómo normalizar el avatar de usuario.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-media-path-format.cjs
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const rel = await db.query(
      `SELECT count(*)::int AS n FROM media WHERE path LIKE '/static/%'`,
    );
    const abs = await db.query(
      `SELECT count(*)::int AS n FROM media WHERE path ~ '^https?://'`,
    );
    const other = await db.query(
      `SELECT count(*)::int AS n FROM media
       WHERE path NOT LIKE '/static/%' AND path !~ '^https?://'`,
    );
    console.log(`media.path relativo (/static/...): ${rel.rows[0].n}`);
    console.log(`media.path absoluto (http...):     ${abs.rows[0].n}`);
    console.log(`media.path otro:                   ${other.rows[0].n}`);

    const absStatic = await db.query(
      `SELECT count(*)::int AS n FROM media WHERE path ~ '^https?://[^/]+/static/'`,
    );
    const relUploads = await db.query(
      `SELECT count(*)::int AS n FROM media WHERE path LIKE '/static/media/uploads/%'`,
    );
    console.log(`\nabsolutas con /static/ (mal guardadas): ${absStatic.rows[0].n}`);
    console.log(`relativas /static/media/uploads/:       ${relUploads.rows[0].n}`);

    const sample = await db.query(
      `SELECT path FROM media ORDER BY id DESC LIMIT 5`,
    );
    console.log('\nMuestra reciente:');
    for (const r of sample.rows) console.log(`  ${r.path}`);

    const absSample = await db.query(
      `SELECT path FROM media WHERE path ~ '^https?://' ORDER BY id DESC LIMIT 5`,
    );
    if (absSample.rowCount) {
      console.log('\nMuestra absoluta:');
      for (const r of absSample.rows) console.log(`  ${r.path}`);
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
