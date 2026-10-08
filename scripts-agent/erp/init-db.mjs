/**
 * Aplica db/sql/19_erp_integration.sql (idempotente).
 * Uso: node scripts-agent/erp/init-db.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';
import { createPg } from './openads.mjs';

const sql = fs.readFileSync(
  path.join(ROOT, 'db/sql/19_erp_integration.sql'),
  'utf8',
);

const pg = createPg();
await pg.connect();
try {
  await pg.query(sql);
  const { rows } = await pg.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name LIKE 'erp\\_%'
      ORDER BY 1`,
  );
  console.log('tablas erp_*:', rows.map((r) => r.table_name).join(', '));
  const cols = await pg.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='orders' AND column_name LIKE 'erp%' ORDER BY 1`,
  );
  console.log('columnas nuevas en orders:', cols.rows.map((r) => r.column_name).join(', '));
} finally {
  await pg.end();
}
