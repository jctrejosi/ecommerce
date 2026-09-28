/**
 * Verifica que el evento `order:updated` (namespace `/orders`, sala `staff`)
 * lleve el nombre del picker cuando la acción la provoca un alistamiento: al
 * reclamar un pedido, el aviso debe llegar con status `preparando` y
 * `pickerName`.
 *
 * Es la fuente de la campanita del panel de picking; se comprueba a nivel de
 * socket para no depender de la UI.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-order-event-payload.cjs
 */
const { createRequire } = require('node:module');
const { setTimeout: sleep } = require('node:timers/promises');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(
  resolve(__dirname, '../backend/package.json'),
);
const requireFromPanel = createRequire(
  resolve(__dirname, '../Interface web picking admin/package.json'),
);
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');
const { io } = requireFromPanel('socket.io-client');

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3000';
const PICKER = { username: 'qa-payload-picker', password: 'qa-payload-1234' };
const FULL_NAME = 'Qa PayloadPicker';

let checks = 0;
let failures = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();

  await db.query('DELETE FROM users WHERE username = $1', [PICKER.username]);
  const hash = await bcrypt.hash(PICKER.password, 10);
  await db.query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, 'Qa', 'PayloadPicker', false, true, true)`,
    [`${PICKER.username}@qa.local`, PICKER.username, hash],
  );
  const pickerId = Number(
    (await db.query('SELECT id FROM users WHERE username = $1', [PICKER.username]))
      .rows[0].id,
  );

  const { rows } = await db.query(
    `SELECT id, reference_code, customer_id, picker_id, status, picked_at
     FROM orders WHERE picker_id IS NULL AND status = 'paid' ORDER BY id LIMIT 1`,
  );
  if (!rows.length) throw new Error('No hay pedidos en cola (status paid) para probar');
  const order = rows[0];
  const { rows: hist } = await db.query(
    'SELECT coalesce(max(id), 0)::bigint AS m FROM order_status_history',
  );
  const histMax = hist[0].m;
  const { rows: notif } = await db.query(
    'SELECT coalesce(max(id), 0)::bigint AS m FROM notifications',
  );
  const notifMax = notif[0].m;

  const socket = io(`${BASE}/orders`, { transports: ['websocket'] });
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout conectando al socket')), 8000);
      socket.on('connect', () => { clearTimeout(t); res(); });
      socket.on('connect_error', (e) => { clearTimeout(t); rej(e); });
    });
    socket.emit('subscribe:staff');
    await sleep(500);

    const events = [];
    socket.on('order:updated', (p) => events.push(p));

    const res = await fetch(`${BASE}/picking/orders/${order.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickerId }),
    });
    check(`claim del pedido ${order.reference_code}`, res.status === 201 || res.status === 200, `HTTP ${res.status}`);

    let evt = null;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      evt = events.find((e) => e.referenceCode === order.reference_code);
      if (evt) break;
    }
    check('llega el evento order:updated del pedido', !!evt, JSON.stringify(evt ?? null));
    check('el estado es "preparando"', evt?.status === 'preparando', String(evt?.status));
    check('el evento trae el nombre del picker', evt?.pickerName === FULL_NAME, String(evt?.pickerName));
    check('el evento trae el id del picker', evt?.pickerId === pickerId, String(evt?.pickerId));
  } finally {
    socket.close();
    await db.query(
      'UPDATE orders SET picker_id = $2, status = $3, picked_at = $4 WHERE id = $1',
      [order.id, order.picker_id, order.status, order.picked_at],
    );
    await db.query('DELETE FROM order_status_history WHERE id > $1', [histMax.toString()]);
    await db.query(
      'DELETE FROM notifications WHERE id > $1 AND target_customer_id = $2 AND message LIKE $3',
      [notifMax.toString(), order.customer_id, `%${order.reference_code}%`],
    );
    await db.query('DELETE FROM users WHERE username = $1', [PICKER.username]);
    await db.end();
    console.log('\n  limpieza: pedido restaurado y picker temporal eliminado');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
