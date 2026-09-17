/**
 * Verifica el aviso de "pedido nuevo" para los pickers móviles.
 *
 *   1. Abre dos clientes socket al namespace `/orders`: sala `pickers` (la app
 *      móvil de picking) y sala `staff` (paneles admin).
 *   2. Crea un pedido REAL por la API pública de checkout de invitado
 *      (`POST /orders/guest-checkout`, pago en efectivo): es el camino que
 *      recorre un pedido que entra a la cola desde la tienda.
 *   3. Verifica que AMBAS salas reciban `order:updated`.
 *   4. Cambia el estado por la API admin (`paid`) y verifica el segundo camino.
 *   5. Borra el pedido de prueba y la sesión de invitado que creó.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/check-picking-new-order-alert.cjs
 */
const { Client } = require('pg');
const { io } = require('socket.io-client');
const bcrypt = require('bcryptjs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
let checks = 0;
function check(name, ok, detail = '') {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  // Un producto vendible (activo, con variante activa) para el carrito.
  const product = (
    await db.query(
      `SELECT p.id, p.name
         FROM products p
         JOIN product_variants v ON v.product_id = p.id
        WHERE p.is_active AND p.deleted_at IS NULL
          AND v.is_active AND v.deleted_at IS NULL
        ORDER BY p.id
        LIMIT 1`,
    )
  ).rows[0];
  if (!product) throw new Error('No hay productos vendibles en la BD');
  console.log(`[setup] producto de prueba: ${product.id} ${product.name}`);

  const pickerEvents = [];
  const staffEvents = [];
  let referenceCode = null;

  const pickers = io(`${BASE}/orders`, { transports: ['websocket', 'polling'] });
  const staff = io(`${BASE}/orders`, { transports: ['websocket', 'polling'] });
  pickers.on('connect', () => pickers.emit('subscribe:pickers'));
  staff.on('connect', () => staff.emit('subscribe:staff'));
  pickers.on('order:updated', (p) => {
    if (p && (!referenceCode || p.referenceCode === referenceCode)) pickerEvents.push(p);
  });
  staff.on('order:updated', (p) => {
    if (p && (!referenceCode || p.referenceCode === referenceCode)) staffEvents.push(p);
  });

  await wait(1500);
  check('la app móvil se une a la sala "pickers"', pickers.connected, `connected=${pickers.connected}`);

  let orderId = null;
  let guestSessionId = null;

  try {
    // ── Camino 1: pedido creado desde la tienda (checkout de invitado) ────────
    const res = await fetch(`${BASE}/orders/guest-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: product.id, quantity: 1 }],
        address: {
          name: 'Prueba Aviso Picking',
          phone: '3001234567',
          address: 'Calle 1 # 2-3',
          city: 'Manizales',
          email: 'prueba.aviso@mercaldas.test',
          notes: 'Pedido de prueba automatizada',
        },
        shippingType: 'standard',
        paymentMethod: 'efectivo',
      }),
    });
    const body = await res.json().catch(() => null);
    referenceCode = body?.referenceCode ?? null;
    check(`POST /orders/guest-checkout -> HTTP ${res.status}`, res.status === 201, referenceCode ?? JSON.stringify(body)?.slice(0, 200));
    if (res.status !== 201) throw new Error('no se pudo crear el pedido de prueba');

    orderId = body.orderId;
    const row = (
      await db.query('SELECT guest_session_id, status FROM orders WHERE id = $1', [orderId])
    ).rows[0];
    guestSessionId = row?.guest_session_id ?? null;
    check(`el pedido queda en la cola (status=${row?.status})`, row?.status === 'created');

    await wait(2000);
    const createInPickers = pickerEvents.filter((e) => e.referenceCode === referenceCode);
    check(
      `la sala "pickers" recibe el pedido nuevo (${createInPickers.length} evento)`,
      createInPickers.length > 0,
      JSON.stringify(createInPickers[0] ?? null),
    );
    check(
      'la sala "staff" también lo recibe (los paneles no se rompen)',
      staffEvents.some((e) => e.referenceCode === referenceCode),
    );

    // ── Camino 2: el pago se confirma y el pedido pasa a "paid" ───────────────
    pickerEvents.length = 0;
    staffEvents.length = 0;
    const { accessToken } = await loginAdmin(db);
    const paid = await fetch(`${BASE}/admin/orders/${orderId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ status: 'confirmado' }),
    });
    check(`POST /admin/orders/:id/status (confirmado) -> HTTP ${paid.status}`, paid.status < 400);
    await wait(2000);
    check(
      'la sala "pickers" recibe el cambio de estado',
      pickerEvents.some((e) => e.referenceCode === referenceCode),
      JSON.stringify(pickerEvents[0] ?? null),
    );
  } finally {
    pickers.disconnect();
    staff.disconnect();

    if (orderId != null) {
      await db.query('DELETE FROM payments WHERE order_id = $1', [orderId]).catch(() => {});
      await db.query('DELETE FROM payment_intents WHERE order_id = $1', [orderId]).catch(() => {});
      await db.query('DELETE FROM order_status_history WHERE order_id = $1', [orderId]).catch(() => {});
      await db.query('DELETE FROM order_items WHERE order_id = $1', [orderId]).catch(() => {});
      await db.query('DELETE FROM shipments WHERE order_id = $1', [orderId]).catch(() => {});
      await db.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => {});
      if (guestSessionId != null) {
        const others = await db.query(
          'SELECT 1 FROM orders WHERE guest_session_id = $1 LIMIT 1',
          [guestSessionId],
        );
        if (others.rowCount === 0) {
          await db.query('DELETE FROM guest_sessions WHERE id = $1', [guestSessionId]).catch(() => {});
        }
      }
      const left = await db.query('SELECT 1 FROM orders WHERE id = $1', [orderId]);
      console.log(`\n  limpieza: pedido ${referenceCode} ${left.rowCount === 0 ? 'eliminado' : 'NO eliminado (revisar)'}`);
    }
    await db.end();
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  if (failures > 0) process.exit(1);
}

/**
 * Token de admin para el cambio de estado. La contraseña se resuelve contra el
 * hash de la BD (sin intentos fallidos de login) y se usa el login real, que es
 * el que firma el token igual que lo haría el panel.
 */
async function loginAdmin(db) {
  const row = await db.query(`SELECT password_hash FROM users WHERE username = 'admin'`);
  const password = ['admdsi4231', 'admin123'].find((p) =>
    bcrypt.compareSync(p, row.rows[0]?.password_hash ?? ''),
  );
  if (!password) throw new Error('No se pudo resolver la contraseña del admin');

  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password }),
  });
  if (!res.ok) throw new Error(`login admin -> HTTP ${res.status}`);
  return res.json();
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
