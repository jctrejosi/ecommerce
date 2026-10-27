/**
 * Limpieza de datos DEMO en la base del ecommerce (Postgres).
 *
 * Deja únicamente el usuario de demo `juan` (user + delivery_driver) y elimina:
 *   - pedidos DEMO-% (96) y todo lo que cuelga de ellos,
 *   - clientes demo (@demo.local),
 *   - pickers demo (@demo.local) y sus relaciones,
 *   - repartidores demo (@demo.local) y sus asignaciones.
 *
 * Es transaccional: si algo falla, no se aplica nada.
 *
 * Uso:
 *   node db/scripts/clean-demo-data.mjs             # dry-run (reporta, no borra)
 *   node db/scripts/clean-demo-data.mjs --apply
 *
 * Entorno:
 *   DATABASE_URL (por defecto postgresql://postgres:postgres@localhost:5432/ecommerce)
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { Client } = require(resolve('backend/node_modules/pg'));

const APPLY = process.argv.includes('--apply');

const client = new Client({
  connectionString:
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
});
await client.connect();
await client.query("SET app.erp_sync = 'on'"); // no re-encolar nada al ERP

const steps = [
  // ── Pedidos demo y sus hijos con FK RESTRICT hacia orders ──
  ['refunds', `DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE reference_code LIKE 'DEMO-%')`],
  ['payments', `DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE reference_code LIKE 'DEMO-%')`],
  ['invoices', `DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE reference_code LIKE 'DEMO-%')`],
  // orders → CASCADE a order_items, order_status_history, payment_intents, chat,
  // shipments → delivery_assignments → delivery_events / delivery_proof_media.
  ['orders (DEMO-%)', `DELETE FROM orders WHERE reference_code LIKE 'DEMO-%'`],

  // ── Repartidores demo: quitar sus asignaciones restantes (pedidos MER) ──
  ['delivery_assignments (demo drivers)', `DELETE FROM delivery_assignments WHERE driver_id IN (SELECT id FROM delivery_drivers WHERE email LIKE '%@demo.local')`],
  ['delivery_driver_locations (demo)', `DELETE FROM delivery_driver_locations WHERE driver_id IN (SELECT id FROM delivery_drivers WHERE email LIKE '%@demo.local')`],
  ['driver_chat_messages (demo)', `DELETE FROM driver_chat_messages WHERE driver_id IN (SELECT id FROM delivery_drivers WHERE email LIKE '%@demo.local')`],
  ['delivery_drivers (@demo.local)', `DELETE FROM delivery_drivers WHERE email LIKE '%@demo.local'`],

  // ── Clientes demo (CASCADE a addresses/carts/favorites/notifications/…) ──
  ['customers (@demo.local)', `DELETE FROM customers WHERE email LIKE '%@demo.local'`],

  // ── Pickers demo (usuarios) ──
  ['user_branches (demo)', `DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.local')`],
  ['user_roles (demo)', `DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.local')`],
  ['user_refresh_tokens (demo)', `DELETE FROM user_refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.local')`],
  ['user_sessions (demo)', `DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.local')`],
  ['users (@demo.local)', `DELETE FROM users WHERE email LIKE '%@demo.local'`],
];

const summary = [];

try {
  await client.query('BEGIN');
  for (const [label, sql] of steps) {
    const r = await client.query(sql);
    summary.push([label, r.rowCount]);
  }
  if (!APPLY) {
    await client.query('ROLLBACK');
    console.log('🧪 DRY-RUN — nada borrado. Conteos que se borrarían:');
  } else {
    await client.query('COMMIT');
    console.log('✅ LIMPIEZA APLICADA. Conteos:');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Error (se hizo rollback):', e.message);
  await client.end();
  process.exit(1);
}

for (const [label, n] of summary) console.log(`   ${label.padEnd(34)} ${n}`);

// Verificación final
const checks = await client.query(`
  SELECT
    (SELECT count(*) FROM orders WHERE reference_code LIKE 'DEMO-%') AS demo_orders,
    (SELECT count(*) FROM customers WHERE email LIKE '%@demo.local') AS demo_customers,
    (SELECT count(*) FROM users WHERE email LIKE '%@demo.local') AS demo_users,
    (SELECT count(*) FROM delivery_drivers WHERE email LIKE '%@demo.local') AS demo_drivers,
    (SELECT count(*) FROM users WHERE username = 'juan') AS juan_users,
    (SELECT count(*) FROM delivery_drivers WHERE email = 'juan@mercaldas.com.co') AS juan_drivers
`);
console.log('\nEstado tras la limpieza:');
console.log(`   pedidos DEMO-%: ${checks.rows[0].demo_orders}`);
console.log(`   clientes @demo.local: ${checks.rows[0].demo_customers}`);
console.log(`   usuarios @demo.local: ${checks.rows[0].demo_users}`);
console.log(`   repartidores @demo.local: ${checks.rows[0].demo_drivers}`);
console.log(`   usuario juan: ${checks.rows[0].juan_users} · repartidor juan: ${checks.rows[0].juan_drivers}`);

await client.end();
