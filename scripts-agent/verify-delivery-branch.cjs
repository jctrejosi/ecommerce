/**
 * Verifica por API la tarea de sucursales en delivery:
 *  1. El admin de sucursal (admin.tid1 → sucursal 9) solo ve su sucursal en
 *     /branches, /drivers y /orders.
 *  2. El admin global (QA, sin sucursal) ve todas las sucursales y la flota.
 *  3. El filtro ?branchId aplica en /drivers y /orders.
 *  4. Un admin de sucursal no puede tocar un repartidor de otra sucursal (403).
 * Solo imprime PASS/FAIL y resúmenes cortos.
 */
const BASE = process.env.API_BASE || 'http://localhost:3000';
const BRANCH_TID1 = 9;

let failures = 0;
function check(name, ok, detail = '') {
  const tag = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login(identifier, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) throw new Error(`login ${identifier} → ${res.status}`);
  return res.json();
}

async function get(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 120);
  }
  return { status: res.status, body };
}

(async () => {
  console.log('\n=== Admin de sucursal (admin.tid1 → sucursal 9) ===');
  const scoped = await login('admin.tid1', 'admin123');
  check('login admin.tid1', Boolean(scoped.accessToken));
  check(
    '/auth/me trae branchId=9',
    Number(scoped.user?.branchId) === BRANCH_TID1,
    `branchId=${scoped.user?.branchId} name=${scoped.user?.branchName}`,
  );
  const t1 = scoped.accessToken;

  const branches1 = await get('/delivery/admin/branches', t1);
  check(
    'GET /branches devuelve solo su sucursal',
    Array.isArray(branches1.body) &&
      branches1.body.length === 1 &&
      Number(branches1.body[0].id) === BRANCH_TID1,
    JSON.stringify(branches1.body),
  );

  const drivers1 = await get('/delivery/admin/drivers', t1);
  const allInScope = Array.isArray(drivers1.body)
    ? drivers1.body.every((d) => Number(d.branchId) === BRANCH_TID1)
    : false;
  check(
    'GET /drivers solo repartidores de su sucursal',
    allInScope && drivers1.body.length >= 1,
    `${drivers1.body?.length ?? '?'} repartidores`,
  );

  // Aunque pida otra sucursal por URL, el scope gana.
  const driversForced = await get('/delivery/admin/drivers?branchId=10', t1);
  check(
    'GET /drivers ignora ?branchId ajeno (scope gana)',
    Array.isArray(driversForced.body) &&
      driversForced.body.every((d) => Number(d.branchId) === BRANCH_TID1),
    `${driversForced.body?.length ?? '?'} repartidores`,
  );

  const orders1 = await get('/delivery/admin/orders?limit=10', t1);
  const ordersScoped =
    orders1.body?.items?.every((o) => o.branchName === 'TID Sucursal 1') ?? false;
  check(
    'GET /orders solo pedidos de su sucursal',
    ordersScoped,
    `total=${orders1.body?.total}`,
  );

  // Repartidor sin cuenta/sucursal (p.ej. #33) fuera de scope → 403 al editar.
  const someGlobalDriverId = 33;
  const forbidden = await fetch(`${BASE}/delivery/admin/drivers/${someGlobalDriverId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t1}` },
    body: JSON.stringify({ fullName: 'No debería' }),
  });
  check(
    'editar repartidor de otra sucursal → 403',
    forbidden.status === 403,
    `status=${forbidden.status}`,
  );

  console.log('\n=== Admin global (sin sucursal) ===');
  const global = await login('qa-delivery-temp', 'demo123');
  check('login admin global', Boolean(global.accessToken));
  check(
    '/auth/me sin branchId',
    global.user?.branchId == null,
    `branchId=${global.user?.branchId}`,
  );
  const tg = global.accessToken;

  const branchesG = await get('/delivery/admin/branches', tg);
  check(
    'GET /branches devuelve todas las activas',
    Array.isArray(branchesG.body) && branchesG.body.length === 3,
    `${branchesG.body?.length} sucursales`,
  );

  const driversG = await get('/delivery/admin/drivers', tg);
  check(
    'GET /drivers devuelve la flota completa',
    Array.isArray(driversG.body) && driversG.body.length === 7,
    `${driversG.body?.length} repartidores`,
  );

  const driversG9 = await get('/delivery/admin/drivers?branchId=9', tg);
  check(
    'GET /drivers?branchId=9 filtra por sucursal',
    Array.isArray(driversG9.body) &&
      driversG9.body.length >= 1 &&
      driversG9.body.every((d) => Number(d.branchId) === BRANCH_TID1),
    `${driversG9.body?.length} repartidores`,
  );

  const ordersG = await get('/delivery/admin/orders?limit=10', tg);
  check(
    'GET /orders (global) trae de varias sucursales',
    ordersG.body?.items?.length > 0,
    `total=${ordersG.body?.total}`,
  );

  console.log(
    `\n${failures === 0 ? '✅ Todas las verificaciones pasaron' : `❌ ${failures} fallaron`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
