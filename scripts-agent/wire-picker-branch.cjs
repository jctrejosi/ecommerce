/*
 * Cablea la sucursal única del picker:
 *  - elimina duplicados (deja una sucursal por usuario),
 *  - crea el índice único user_branches(user_id) para imponer "una sola sucursal",
 *  - asigna juan (#19) a la TID Sucursal 1 si sigue sin sucursal (para pruebas).
 */
const { Client } = require('pg');

const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };

(async () => {
  const db = new Client(DB);
  await db.connect();

  const dups = await db.query(
    `SELECT user_id, COUNT(*)::int AS n FROM user_branches GROUP BY user_id HAVING COUNT(*) > 1`,
  );
  console.log(`Usuarios con más de una sucursal: ${dups.rows.length}`);

  const del = await db.query(
    `DELETE FROM user_branches a
       USING user_branches b
      WHERE a.user_id = b.user_id AND a.branch_id > b.branch_id`,
  );
  console.log(`Filas eliminadas por deduplicación: ${del.rowCount}`);

  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS user_branches_user_id_key ON user_branches(user_id)`,
  );
  console.log('Índice único user_branches_user_id_key: OK');

  const idx = await db.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'user_branches' ORDER BY indexname`,
  );
  console.log('Índices:', idx.rows.map((r) => r.indexname).join(', '));

  const all = await db.query(
    `SELECT u.id, u.username, b.name AS sucursal
       FROM users u
       LEFT JOIN user_branches ub ON ub.user_id = u.id
       LEFT JOIN branches b ON b.id = ub.branch_id
      WHERE u.deleted_at IS NULL
      ORDER BY u.id`,
  );
  console.log('\nAsignación actual:');
  for (const r of all.rows) console.log(`  #${r.id} ${String(r.username).padEnd(20)} -> ${r.sucursal ?? '—'}`);

  await db.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
