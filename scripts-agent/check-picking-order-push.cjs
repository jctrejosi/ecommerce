/**
 * Verifica el push de "pedido nuevo" al picker, de punta a punta:
 *   1. se crea un pedido real por el checkout de invitado,
 *   2. el backend avisa a los pickers (FCM) al entrar el pedido,
 *   3. el dispositivo del picker registra la notificación (se revisa por adb).
 *
 * La base no tiene inventario cargado, así que crea una fila de inventario
 * temporal (o presta stock de una existente) y la restaura al terminar. Todo lo
 * que crea (pedido, sesión de invitado, cliente, notificación) se borra.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-order-push.cjs
 */
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(
  resolve(__dirname, '../backend/package.json'),
);
const { Client } = requireFromBackend('pg');

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const ADB = '/home/jk/Android/Sdk/platform-tools/adb';
const QA_EMAIL = 'qa-order-push@qa.local';

let ok = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    ok++;
    console.log(`  ok   ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    console.log(`  FALLA ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function notificationsDump() {
  try {
    return execFileSync(ADB, ['shell', 'dumpsys', 'notification', '--noredact'], {
      encoding: 'utf8',
      maxBuffer: 40 * 1024 * 1024,
    });
  } catch (err) {
    return `(adb falló: ${err.message})`;
  }
}

/** Borra todo lo que dejó el pedido de prueba (solo lo suyo). */
async function cleanup(db, orderId, inv) {
  let guestSessionId = null;
  let customerId = null;
  if (orderId) {
    const { rows } = await db.query(
      'SELECT guest_session_id, customer_id FROM orders WHERE id = $1',
      [orderId],
    );
    guestSessionId = rows[0]?.guest_session_id ?? null;
    customerId = rows[0]?.customer_id ?? null;
    // Orden que respeta las FK: `payments` referencia `payment_intents`, y
    // `refunds`/`invoices` referencian `payments`.
    for (const table of [
      'refunds',
      'invoices',
      'shipments',
      'order_chat_messages',
      'order_items',
      'order_status_history',
      'coupon_redemptions',
      'payments',
      'payment_intents',
    ]) {
      await db.query(`DELETE FROM ${table} WHERE order_id = $1`, [orderId]);
    }
    await db.query('DELETE FROM orders WHERE id = $1', [orderId]);
  }
  if (customerId) {
    await db.query('DELETE FROM notifications WHERE target_customer_id = $1', [
      customerId,
    ]);
    // Solo el cliente invitado que creó este pedido.
    await db.query("DELETE FROM customers WHERE id = $1 AND provider = 'guest'", [
      customerId,
    ]);
  }
  if (guestSessionId) {
    await db.query('DELETE FROM guest_sessions WHERE id = $1', [guestSessionId]);
  }
  // El inventario temporal se creó para la prueba: se borra. Si ya existía, se
  // devuelve a sus valores originales.
  if (inv) {
    if (inv.created) await db.query('DELETE FROM inventory WHERE id = $1', [inv.id]);
    else
      await db.query(
        'UPDATE inventory SET stock = $2, reserved_stock = $3 WHERE id = $1',
        [inv.id, inv.stock, inv.reserved],
      );
  }
}

async function main() {
  const env = readFileSync(
    resolve(__dirname, '../backend/.env.development.local'),
    'utf8',
  );
  const dbUrl = env
    .match(/^DATABASE_URL=(.*)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  const db = new Client({ connectionString: dbUrl });
  await db.connect();

  const { rows: pickers } = await db.query(
    "SELECT id, username FROM users WHERE is_picker AND is_active AND push_token IS NOT NULL AND deleted_at IS NULL ORDER BY id LIMIT 5",
  );
  console.log(
    `pickers con token: ${pickers.map((p) => `${p.username}#${p.id}`).join(', ') || 'ninguno'}`,
  );

  // Inventario: se presta uno existente o se crea temporalmente.
  let inv;
  const { rows: invRows } = await db.query(
    `SELECT i.id, i.stock, i.reserved_stock, v.product_id
     FROM inventory i JOIN product_variants v ON v.id = i.product_variant_id
     LIMIT 1`,
  );
  if (invRows.length) {
    inv = {
      ...invRows[0],
      id: Number(invRows[0].id),
      stock: Number(invRows[0].stock),
      reserved: Number(invRows[0].reserved_stock),
      created: false,
    };
    await db.query('UPDATE inventory SET stock = 100 WHERE id = $1', [inv.id]);
  } else {
    const { rows } = await db.query(
      `INSERT INTO inventory (product_variant_id, branch_id, stock)
       VALUES ($1, $2, 100)
       RETURNING id, $1::bigint AS product_id`,
      [10385, 1],
    );
    inv = { id: Number(rows[0].id), product_id: Number(rows[0].product_id), created: true };
  }
  console.log(
    `inventario para la prueba: ${inv.id} (producto ${inv.product_id})${inv.created ? ' [temporal]' : ' [prestado]'}`,
  );

  let orderId = null;
  try {
    const before = notificationsDump();

    console.log('\n== Pedido nuevo -> push al picker ==');
    const res = await fetch(`${BASE}/orders/guest-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: Number(inv.product_id), quantity: 1 }],
        address: {
          name: 'QA Push',
          phone: '3001234567',
          address: 'Calle QA 1',
          city: 'Bogotá',
          email: QA_EMAIL,
        },
        shippingType: 'standard',
        paymentMethod: 'efectivo',
      }),
    });
    const body = await res.json().catch(() => ({}));
    orderId = body?.orderId ?? null;
    check(
      'el pedido se crea',
      res.status === 201,
      `HTTP ${res.status} ${body?.referenceCode ?? ''}`,
    );
    if (!orderId) console.log('   respuesta:', JSON.stringify(body).slice(0, 300));

    await new Promise((r) => setTimeout(r, 9000));
    const after = notificationsDump();
    check(
      'el dispositivo del picker registra la notificación',
      /com\.dsi\.pickingapp/.test(after) && after.includes('Nuevo pedido'),
    );

    const lines = after
      .split('\n')
      .filter((l) => /Nuevo pedido|picking-alerts/.test(l))
      .map((l) => l.trim());
    console.log('  evidencia del dispositivo:');
    for (const l of lines.slice(0, 6)) console.log(`    ${l.slice(0, 220)}`);
  } finally {
    await cleanup(db, orderId, inv);
    console.log('\n== Limpieza ==');
    const { rows: gone } = await db.query(
      'SELECT count(*)::int AS n FROM orders WHERE id = $1',
      [orderId ?? -1],
    );
    check('el pedido de prueba ya no existe', gone[0].n === 0);
    if (inv.created) {
      const { rows } = await db.query(
        'SELECT count(*)::int AS n FROM inventory WHERE id = $1',
        [inv.id],
      );
      check('el inventario temporal se borró', rows[0].n === 0);
    } else {
      const { rows } = await db.query(
        'SELECT stock, reserved_stock FROM inventory WHERE id = $1',
        [inv.id],
      );
      check(
        'el stock quedó como estaba',
        Number(rows[0].stock) === inv.stock &&
          Number(rows[0].reserved_stock) === inv.reserved,
        `stock=${rows[0].stock} reserved=${rows[0].reserved_stock}`,
      );
    }
    await db.end();
  }

  console.log(`\n== Resultado: ${ok}/${ok + fail} verificaciones ok ==`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
