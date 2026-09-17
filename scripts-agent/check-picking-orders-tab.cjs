/**
 * Verificación end-to-end del tab "Pedidos" del picking admin.
 *
 *   - Login real como admin (cookie httpOnly) contra el backend en :3000.
 *   - GET /picking-admin/orders con sus filtros (sucursal, estado, búsqueda).
 *   - Contraste de cada cifra contra consultas directas a la BD local.
 *   - Casos borde: sin cookie (401), sin superusuario (403), estado inválido,
 *     sucursal inexistente, límites de paginación.
 *
 * Para no ensuciar la tabla de usuarios, el caso 403 usa un usuario temporal
 * (is_superuser = false) que se borra al final, incluso si algo falla.
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/check-picking-orders-tab.cjs
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const API = process.env.API_BASE || 'http://127.0.0.1:3000';
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce';

const ADMIN_USER = 'admin';
const ADMIN_PASSWORD_CANDIDATES = ['admdsi4231', 'admin123'];
const QA_USER = { username: 'qa-orders-check', email: 'qa-orders-check@local.test' };
const QA_PASSWORD = 'qa-check-123';

let failures = 0;
let checks = 0;

function check(name, ok, detail = '') {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login(identifier, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  const token = cookies.find((c) => c.startsWith('access_token='));
  if (!token) throw new Error(`login ${identifier} no dejó cookie access_token`);
  return token.split(';')[0];
}

/**
 * Resuelve la contraseña del admin comparando el hash en BD: un solo intento
 * de login, para no arriesgar un bloqueo por intentos fallidos.
 */
async function resolveAdminPassword(db) {
  const r = await db.query('SELECT password_hash FROM users WHERE username = $1', [ADMIN_USER]);
  if (r.rowCount === 0) throw new Error(`No existe el usuario ${ADMIN_USER}`);
  const hit = ADMIN_PASSWORD_CANDIDATES.find((p) => bcrypt.compareSync(p, r.rows[0].password_hash));
  if (!hit) throw new Error(`Ninguna contraseña candidata sirve para ${ADMIN_USER}`);
  return hit;
}

async function get(path, cookie) {
  const res = await fetch(`${API}${path}`, {
    headers: cookie ? { cookie } : {},
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: res.status, body };
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  let qaId = null;

  try {
    const admin = await login(ADMIN_USER, await resolveAdminPassword(db));

    // ── Autorización ───────────────────────────────────────────────────────────
    console.log('\n== Autorización ==');
    const anon = await get('/picking-admin/orders?branchId=1');
    check('sin cookie -> 401', anon.status === 401, `status ${anon.status}`);

    // Usuario temporal sin privilegios: debe recibir 403.
    const qaHash = await bcrypt.hash(QA_PASSWORD, 10);
    const qa = await db.query(
      `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
       VALUES ($1, $2, $3, 'QA', 'Orders Check', false, true, true)
       RETURNING id`,
      [QA_USER.email, QA_USER.username, qaHash],
    );
    qaId = qa.rows[0].id;
    const notSuper = await get('/picking-admin/orders?branchId=1', await login(QA_USER.username, QA_PASSWORD));
    check('usuario sin superusuario -> 403', notSuper.status === 403, `status ${notSuper.status}`);

    // ── Sucursales: la lista coincide con la BD ────────────────────────────────
    console.log('\n== Por sucursal (contraste con la BD) ==');
    const branches = await db.query(
      `SELECT b.id, b.name,
              (SELECT count(*)::int FROM orders o WHERE o.branch_id = b.id) AS n
       FROM branches b ORDER BY b.id`,
    );
    for (const b of branches.rows) {
      const res = await get(`/picking-admin/orders?branchId=${b.id}`, admin);
      if (res.status !== 200) {
        check(`${b.name} responde 200`, false, `status ${res.status}`);
        continue;
      }
      const sumCounts = Object.values(res.body.counts).reduce((a, n) => a + n, 0);
      const sumTotal = res.body.orders.length;
      const byStatus = await db.query(
        `SELECT status::text AS status, count(*)::int AS n
         FROM orders WHERE branch_id = $1 GROUP BY 1`,
        [b.id],
      );
      const dbCounts = Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n]));
      const countsOk = Object.entries(dbCounts).every(([s, n]) => res.body.counts[s] === n);
      check(
        `${b.name}: total=${res.body.total} (BD ${b.n}), filas=${sumTotal}, suma de conteos=${sumCounts}`,
        res.body.total === b.n && sumCounts === b.n && countsOk && sumTotal === b.n,
        `conteos ${JSON.stringify(res.body.counts)}`,
      );
      if (b.n === 0) {
        check(`${b.name}: sin pedidos -> lista vacía`, res.body.orders.length === 0);
      }
    }

    // ── Agregados por pedido ───────────────────────────────────────────────────
    console.log('\n== Agregados por pedido ==');
    const sample = await db.query(
      `SELECT o.id, o.reference_code, o.status::text AS status, o.branch_id, o.picker_id,
              o.grand_total::float AS grand_total,
              (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS items,
              (SELECT COALESCE(SUM(oi.quantity),0)::int FROM order_items oi WHERE oi.order_id = o.id) AS pieces,
              (SELECT COALESCE(SUM(oi.picked_qty),0)::int FROM order_items oi WHERE oi.order_id = o.id) AS scanned,
              (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id AND oi.picked_qty < oi.quantity) AS remaining_items,
              (SELECT MAX(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'delivered') AS delivered
       FROM orders o ORDER BY o.created_at DESC LIMIT 5`,
    );
    for (const row of sample.rows) {
      const res = await get(
        `/picking-admin/orders?branchId=${row.branch_id}&search=${row.reference_code}`,
        admin,
      );
      const o = res.body?.orders?.find((x) => x.id === Number(row.id));
      if (!o) {
        check(`pedido ${row.reference_code} presente`, false, `status ${res.status}`);
        continue;
      }
      const ok =
        o.itemsCount === row.items &&
        o.totalPieces === row.pieces &&
        o.scannedPieces === row.scanned &&
        o.remainingItems === row.remaining_items &&
        o.remainingPieces === Math.max(0, row.pieces - row.scanned) &&
        o.status === row.status &&
        Math.abs(o.grandTotal - row.grand_total) < 0.01 &&
        (o.pickerId === null ? row.picker_id === null : o.pickerId === Number(row.picker_id)) &&
        String(o.deliveredAt ?? '') === String(row.delivered ?? '');
      check(
        `pedido ${row.reference_code}: items ${o.itemsCount}/${row.items}, piezas ${o.scannedPieces}/${row.pieces}, faltan ${o.remainingItems}, estado ${o.status}`,
        ok,
        ok ? '' : `API ${JSON.stringify(o)} vs BD ${JSON.stringify(row)}`,
      );
    }

    // ── Filtros ────────────────────────────────────────────────────────────────
    console.log('\n== Filtros ==');
    const branchWithOrders = branches.rows.find((b) => b.n > 0) ?? branches.rows[0];
    const all = await get(`/picking-admin/orders?branchId=${branchWithOrders.id}`, admin);
    const firstStatus = Object.entries(all.body.counts).find(([, n]) => n > 0)?.[0];
    if (firstStatus) {
      const filtered = await get(
        `/picking-admin/orders?branchId=${branchWithOrders.id}&status=${firstStatus}`,
        admin,
      );
      const onlyOne = filtered.body.orders.every((o) => o.status === firstStatus);
      check(
        `status=${firstStatus}: ${filtered.body.orders.length} fila(s), total ${filtered.body.total}, todas de ese estado`,
        filtered.body.orders.length > 0 &&
          onlyOne &&
          filtered.body.total === all.body.counts[firstStatus],
      );
      // Los conteos NO dependen del filtro de estado (sirven de chips).
      check(
        `counts estable con status=${firstStatus}`,
        JSON.stringify(filtered.body.counts) === JSON.stringify(all.body.counts),
      );
    } else {
      console.log('  (no hay pedidos para probar filtros de estado)');
    }

    const bad = await get(`/picking-admin/orders?branchId=${branchWithOrders.id}&status=basura`, admin);
    check('estado inválido no rompe (200 y sin filtro)', bad.status === 200 && bad.body.orders.length === all.body.orders.length);

    const none = await get('/picking-admin/orders?branchId=999999', admin);
    check('sucursal inexistente -> 0 pedidos', none.status === 200 && none.body.orders.length === 0);

    const noBranch = await get('/picking-admin/orders', admin);
    const totalAll = branches.rows.reduce((a, b) => a + b.n, 0);
    check(
      `sin branchId -> todas las sucursales (${noBranch.body.total} de ${totalAll})`,
      noBranch.status === 200 && noBranch.body.total === totalAll && noBranch.body.branchId === null,
    );

    const limited = await get(`/picking-admin/orders?branchId=${branchWithOrders.id}&limit=1`, admin);
    check('limit=1 respeta el tope', limited.body.orders.length === Math.min(1, all.body.orders.length));
    const clamped = await get(`/picking-admin/orders?branchId=${branchWithOrders.id}&limit=99999`, admin);
    check('limit fuera de rango se acota a 300', clamped.body.limit === 300);

    // ── Resumen de tiempo de alistamiento ─────────────────────────────────────
    if (all.body.orders.length > 0) {
      const withTimes = all.body.orders.filter((o) => o.pickedAt && o.completedAt);
      console.log(
        `\n  Pedidos con inicio y cierre de alistamiento: ${withTimes.length}/${all.body.orders.length}`,
      );
      for (const o of withTimes.slice(0, 3)) {
        const ms = new Date(o.completedAt) - new Date(o.pickedAt);
        console.log(
          `    ${o.referenceCode}: ${Math.round(ms / 1000)}s (picker ${o.pickerName ?? 'n/a'})`,
        );
      }
      check(
        'todos los pedidos traen los campos que pinta la vista',
        all.body.orders.every(
          (o) =>
            'referenceCode' in o &&
            'customerName' in o &&
            'status' in o &&
            'pickerName' in o &&
            'itemsCount' in o &&
            'scannedPieces' in o &&
            'totalPieces' in o &&
            'createdAt' in o,
        ),
      );
    }
  } finally {
    // Limpieza del usuario temporal (y sus sesiones/tokens, por las FKs).
    if (qaId !== null) {
      await db.query('DELETE FROM user_refresh_tokens WHERE user_id = $1', [qaId]).catch(() => {});
      await db.query('DELETE FROM user_sessions WHERE user_id = $1', [qaId]).catch(() => {});
      await db.query('DELETE FROM users WHERE id = $1', [qaId]).catch(() => {});
      const left = await db.query('SELECT 1 FROM users WHERE id = $1', [qaId]);
      console.log(`\n  usuario temporal borrado: ${left.rowCount === 0 ? 'sí' : 'NO (revisar)'}`);
    }
    await db.end();
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
