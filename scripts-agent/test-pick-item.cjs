/*
 * Prueba real del endpoint POST /picking/orders/:id/items/:itemId/pick
 * (confirmación manual sin escanear). Toma un item pendiente de un pedido en
 * "preparing", ejecuta el endpoint, verifica que quedó completo y RESTAURA el
 * valor original para no dejar datos sucios.
 */
const { Client } = require('pg');

const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };
const API = 'http://localhost:3000';

(async () => {
  const db = new Client(DB);
  await db.connect();

  const { rows } = await db.query(
    `SELECT oi.id AS item_id, oi.order_id, oi.picked_qty, oi.quantity
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'preparing' AND oi.picked_qty < oi.quantity
      ORDER BY oi.order_id DESC, oi.id ASC
      LIMIT 1`,
  );

  if (rows.length === 0) {
    console.log('SKIP: no hay items pendientes en pedidos "preparing".');
    await db.end();
    return;
  }

  const { item_id, order_id, picked_qty, quantity } = rows[0];
  console.log(
    `ANTES: order=${order_id} item=${item_id} picked=${picked_qty}/${quantity}`,
  );

  const res = await fetch(`${API}/picking/orders/${order_id}/items/${item_id}/pick`, {
    method: 'POST',
  });
  const body = await res.json().catch(() => null);
  console.log(`HTTP ${res.status}`, JSON.stringify(body));

  const check = await db.query(
    `SELECT picked_qty FROM order_items WHERE id = $1`,
    [item_id],
  );
  console.log(`DESPUES(bd): picked=${check.rows[0].picked_qty}/${quantity}`);

  // Restaurar el valor original para dejar la BD como estaba.
  await db.query(`UPDATE order_items SET picked_qty = $1 WHERE id = $2`, [
    picked_qty,
    item_id,
  ]);
  const restore = await db.query(`SELECT picked_qty FROM order_items WHERE id = $1`, [item_id]);
  console.log(`RESTAURADO: picked=${restore.rows[0].picked_qty}/${quantity}`);

  await db.end();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
