/**
 * Elimina pedidos de prueba que quedaron "en camino" (orders.status='shipped')
 * pero SIN ninguna asignación de delivery (no los tiene ningún repartidor).
 *
 * Guardas:
 *  - Solo borra si el pedido está en status 'shipped' Y no tiene filas en
 *    delivery_assignments (se recalcula dentro de la transacción).
 *  - Borra primero las dependencias con ON DELETE RESTRICT
 *    (refunds → invoices → payments) y luego el pedido (el resto es CASCADE).
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/remove-orphan-shipped-orders.cjs [--apply]
 * Sin --apply solo reporta (dry-run).
 */
const { Client } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const APPLY = process.argv.includes('--apply');

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const candidates = await db.query(`
      SELECT o.id, o.reference_code, o.customer_name,
             s.id AS shipment_id,
             (SELECT count(*) FROM delivery_assignments a WHERE a.shipment_id = s.id) AS assignments
      FROM orders o
      LEFT JOIN shipments s ON s.order_id = o.id
      WHERE o.status = 'shipped'
      ORDER BY o.id
    `);

    const orphans = candidates.rows.filter((r) => Number(r.assignments) === 0);
    console.log(
      `Pedidos 'shipped': ${candidates.rows.length} | sin delivery: ${orphans.length}`,
    );
    for (const r of orphans) {
      console.log(
        `  → #${r.id} ${r.reference_code} cliente="${r.customer_name}" shipment=${r.shipment_id}`,
      );
    }

    if (!orphans.length) {
      console.log('Nada por borrar.');
      return;
    }
    if (!APPLY) {
      console.log('\nDry-run. Ejecuta con --apply para borrar.');
      return;
    }

    const ids = orphans.map((r) => Number(r.id));
    await db.query('BEGIN');
    try {
      // Re-verificar dentro de la transacción (evita borrar algo ya asignado).
      const check = await db.query(
        `SELECT o.id
         FROM orders o
         LEFT JOIN shipments s ON s.order_id = o.id
         WHERE o.id = ANY($1::bigint[])
           AND o.status = 'shipped'
           AND (SELECT count(*) FROM delivery_assignments a WHERE a.shipment_id = s.id) = 0`,
        [ids],
      );
      const safeIds = check.rows.map((r) => Number(r.id));
      if (!safeIds.length) {
        await db.query('ROLLBACK');
        console.log('Ninguno pasó la verificación; no se borró nada.');
        return;
      }

      const del = async (table, column) => {
        const res = await db.query(
          `DELETE FROM ${table} WHERE ${column} = ANY($1::bigint[])`,
          [safeIds],
        );
        return res.rowCount;
      };

      const refunds = await del('refunds', 'order_id');
      const invoices = await del('invoices', 'order_id');
      const payments = await del('payments', 'order_id');
      const orders = await del('orders', 'id');

      await db.query('COMMIT');
      console.log(
        `\nBorrados → refunds: ${refunds}, invoices: ${invoices}, payments: ${payments}, orders: ${orders}`,
      );
      console.log(`Pedidos eliminados: ${safeIds.join(', ')}`);
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
