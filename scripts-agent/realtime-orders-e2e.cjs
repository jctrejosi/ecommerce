/**
 * Prueba end-to-end de la difusión de cambios de estado de pedidos.
 *
 *   1. Crea un pedido desechable (no toca datos reales).
 *   2. Abre dos clientes socket al namespace `/orders`:
 *        - panel administrativo (sala `staff`),
 *        - cliente dueño del pedido (sala `order:<referenceCode>`).
 *   3. Cambia el estado del pedido por la API admin (`POST /admin/orders/:id/status`).
 *   4. Verifica que AMBOS reciban el evento.
 *   5. Borra el pedido de prueba.
 *
 * Uso (desde la raíz del repo):
 *   node scripts-agent/realtime-orders-e2e.cjs
 */
const path = require('node:path');

/** Las dependencias viven en distintos paquetes del monorepo (pnpm). */
const ROOT = path.join(__dirname, '..');
const from = (mod, ...dirs) =>
  require(require.resolve(mod, { paths: dirs.map((d) => path.join(ROOT, d)) }));

const { Client } = from('pg', 'backend/node_modules');
const { io } = from('socket.io-client', 'Interface web admin/node_modules');
const jwt = from('jsonwebtoken', 'backend/node_modules');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';
const JWT_SECRET =
  process.env.JWT_SECRET ||
  'ee25eb6e91a2ef6bc3d2f19146f12e0a95659    32d31afdf125fe266a0423e9881';

const CODE = `MER-T${Math.floor(100000 + Math.random() * 899999)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const branch = (await db.query('SELECT id FROM branches ORDER BY id LIMIT 1')).rows[0];
  if (!branch) throw new Error('No hay sucursales en la BD.');

  const ins = await db.query(
    `INSERT INTO orders (reference_code, branch_id, status, currency_code,
       subtotal, discount_total, tax_total, shipping_cost, shipping_tax,
       grand_total, customer_name, customer_phone, created_at, updated_at)
     VALUES ($1, $2, 'preparing', 'COP', 1000, 0, 0, 0, 0, 1000,
             'Prueba Realtime', '3000000000', now(), now())
     RETURNING id`,
    [CODE, branch.id],
  );
  const orderId = ins.rows[0].id;
  console.log(`[setup] pedido desechable ${CODE} (id ${orderId})`);

  const staffEvents = [];
  const orderEvents = [];
  const staff = io(`${BASE}/orders`, { transports: ['websocket', 'polling'] });
  const order = io(`${BASE}/orders`, { transports: ['websocket', 'polling'] });

  staff.on('connect', () => staff.emit('subscribe:staff'));
  order.on('connect', () => order.emit('subscribe:order', CODE));
  staff.on('order:updated', (p) => {
    if (p && p.referenceCode === CODE) staffEvents.push(p);
  });
  order.on('order:status', (p) => {
    if (p && p.orderId === CODE) orderEvents.push(p);
  });

  await wait(1500);

  const token = jwt.sign(
    { sub: 1, email: 'admin@mercaldas.com.co', username: 'admin', isSuperuser: true },
    JWT_SECRET,
    { expiresIn: '5m' },
  );
  const res = await fetch(`${BASE}/admin/orders/${orderId}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status: 'en camino' }),
  });
  console.log(`[api] POST /admin/orders/${orderId}/status -> HTTP ${res.status}`);

  await wait(1800);

  console.log(`[socket] sala staff  → ${staffEvents.length} evento(s): ${JSON.stringify(staffEvents[0] ?? null)}`);
  console.log(`[socket] sala pedido → ${orderEvents.length} evento(s): ${JSON.stringify(orderEvents[0] ?? null)}`);

  staff.disconnect();
  order.disconnect();

  await db.query('DELETE FROM orders WHERE id = $1', [orderId]);
  console.log('[cleanup] pedido desechable eliminado');
  await db.end();

  const ok = res.status < 400 && staffEvents.length > 0 && orderEvents.length > 0;
  console.log(ok ? 'RESULTADO: OK' : 'RESULTADO: FALLO');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
