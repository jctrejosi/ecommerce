/**
 * Diagnóstico: para el pedido aceptado (y otros activos), prueba el endpoint de
 * ruta (store/customer) e imprime estado y distancia. Además lista las
 * ubicaciones de las sucursales. Solo resumen corto.
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { Client } = require(require.resolve('pg', {
  paths: [path.join(ROOT, 'backend/node_modules')],
}));
const BASE = process.env.API_BASE || 'http://localhost:3000';
const DB =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin.tid1', password: 'admin123' }),
  });
  return res.json();
}

(async () => {
  const db = new Client(DB);
  await db.connect();

  const branches = await db.query(
    `SELECT id, code, name, location FROM branches WHERE deleted_at IS NULL ORDER BY id`,
  );
  console.log('\nSucursales y su location:');
  for (const b of branches.rows) {
    console.log(`  #${b.id} ${String(b.code).padEnd(8)} ${b.name.padEnd(40)} ${b.location ?? 'NULL'}`);
  }

  const active = await db.query(
    `SELECT a.status::text AS status, d.id AS driver_id, d.current_location, s.order_id,
            o.reference_code
       FROM delivery_assignments a
       JOIN delivery_drivers d ON d.id = a.driver_id
       JOIN shipments s ON s.id = a.shipment_id
       JOIN orders o ON o.id = s.order_id
      WHERE a.status::text IN ('ACCEPTED','IN_DELIVERY')
      ORDER BY a.id DESC LIMIT 6`,
  );

  const auth = await login();
  const token = auth.accessToken;
  console.log(`\nRutas (token de ${auth.user?.username}):`);

  for (const r of active.rows) {
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(r.current_location ?? '');
    const from = m ? `${m[1]},${m[2]}` : null;
    for (const target of ['store', 'customer']) {
      const qs = `target=${target}${from ? `&from=${encodeURIComponent(from)}` : ''}`;
      const res = await fetch(`${BASE}/delivery/admin/orders/${r.order_id}/route?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let body = '';
      try {
        body = JSON.stringify(await res.json()).slice(0, 160);
      } catch {
        body = '';
      }
      console.log(
        `  ${r.status.padEnd(12)} order#${r.order_id} ${r.reference_code} ${target.padEnd(8)} ` +
          `from=${from ?? 'NULL'} → HTTP ${res.status} ${res.status === 200 ? '' : body}`,
      );
    }
  }

  await db.end();
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
