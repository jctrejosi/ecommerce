/**
 * Aplica las migraciones de integración ERP (idempotente):
 *   19_erp_integration.sql, 20_erp_invoice_mirror.sql,
 *   21_erp_catalog_outbox.sql, 22_erp_outbox_masters.sql,
 *   23_erp_order_status_map.sql, 24_erp_code_map_fortuner.sql,
 *   25_erp_product_outbox.sql, 26_erp_branch_price_outbox.sql
 * Uso: node scripts-agent/erp/init-db.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';
import { createPg } from './openads.mjs';

const files = [
  '19_erp_integration.sql',
  '20_erp_invoice_mirror.sql',
  '21_erp_catalog_outbox.sql',
  '22_erp_outbox_masters.sql',
  '23_erp_order_status_map.sql',
  '24_erp_code_map_fortuner.sql',
  '25_erp_product_outbox.sql',
  '26_erp_branch_price_outbox.sql',
];
const sqls = files.map((f) =>
  fs.readFileSync(path.join(ROOT, 'db/sql', f), 'utf8'),
);

const pg = createPg();
await pg.connect();
try {
  for (const sql of sqls) await pg.query(sql);
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
