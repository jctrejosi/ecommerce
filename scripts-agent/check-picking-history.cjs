/**
 * Verifica el historial de pedidos del picker (app móvil):
 *   - GET /picking/history exige token (401 sin él).
 *   - Devuelve páginas de 10 (lazy load) con `total` y `hasMore` correctos.
 *   - Ordena del más reciente al más antiguo y no repite pedidos entre páginas.
 *   - Solo devuelve pedidos del picker autenticado y ya cerrados en caja.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-history.cjs
 */
const { createRequire } = require('node:module');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');
const bcrypt = requireFromBackend('bcryptjs');

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const TEMP_PASSWORD = 'qa-hist-1234';

let checks = 0;
let failures = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function page(token, offset) {
  const res = await fetch(`${API}/picking/history?offset=${offset}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  let body = null;
  try { body = await res.json(); } catch { /* noop */ }
  return { status: res.status, body };
}

async function main() {
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();

  // Picker con más pedidos cerrados (para tener varias páginas).
  const { rows: pick } = await db.query(
    `SELECT o.picker_id AS id, u.username, u.password_hash, count(*)::int AS total
       FROM orders o JOIN users u ON u.id = o.picker_id
      WHERE o.completed_at IS NOT NULL
      GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 1`,
  );
  const { id, username, password_hash, total } = pick[0];
  console.log(`  picker de prueba: ${username} (id ${id}, ${total} pedidos cerrados)`);

  let token = null;
  try {
    // 401 sin token.
    const noAuth = await page(null, 0);
    check('exige autenticación (401 sin token)', noAuth.status === 401, `status ${noAuth.status}`);

    // Contraseña temporal para entrar.
    const hash = await bcrypt.hash(TEMP_PASSWORD, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
    const login = await (
      await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: username, password: TEMP_PASSWORD }),
      })
    ).json();
    token = login?.accessToken;
    check('inicia sesión el picker', !!token);

    // Página 1.
    const p0 = await page(token, 0);
    check('página 1 trae 10 pedidos', p0.body?.orders?.length === 10, `${p0.body?.orders?.length}`);
    check('el total coincide con la BD', p0.body?.total === total, `${p0.body?.total} vs ${total}`);
    check('hasMore=true en la primera página', p0.body?.hasMore === true);

    // Página 2.
    const p1 = await page(token, 10);
    check('página 2 trae 10 pedidos', p1.body?.orders?.length === 10, `${p1.body?.orders?.length}`);
    const ids0 = new Set((p0.body?.orders ?? []).map((o) => o.id));
    const overlap = (p1.body?.orders ?? []).some((o) => ids0.has(o.id));
    check('no repite pedidos entre páginas', !overlap);

    // Última página parcial.
    const p2 = await page(token, 20);
    check(
      'última página trae el resto',
      p2.body?.orders?.length === total - 20,
      `${p2.body?.orders?.length} (esperado ${total - 20})`,
    );
    check('hasMore=false en la última página', p2.body?.hasMore === false);

    // Orden descendente por fecha de cierre.
    const dates = (p0.body?.orders ?? []).map((o) => o.completedAt ?? '');
    const sorted = [...dates].sort().reverse();
    check('ordena del más reciente al más antiguo', JSON.stringify(dates) === JSON.stringify(sorted));

    // Cross-check contra la BD: cada pedido es de ese picker y está cerrado.
    const sampleIds = (p0.body?.orders ?? []).map((o) => o.id);
    const { rows: dbRows } = await db.query(
      `SELECT id, picker_id, completed_at FROM orders WHERE id = ANY($1::bigint[])`,
      [sampleIds],
    );
    check(
      'todos son del picker autenticado y cerrados en caja',
      dbRows.length === sampleIds.length &&
        dbRows.every((r) => Number(r.picker_id) === Number(id) && r.completed_at != null),
      `${dbRows.length}/${sampleIds.length}`,
    );

    // Shape mínimo para la app.
    const o = p0.body?.orders?.[0];
    check(
      'cada pedido trae los campos que usa la app',
      !!o &&
        typeof o.referenceCode === 'string' &&
        typeof o.customerName === 'string' &&
        typeof o.itemsCount === 'number' &&
        typeof o.totalPieces === 'number' &&
        'completedAt' in o,
    );
  } finally {
    // Restaura la contraseña original del picker.
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, id]);
    await db.end();
    console.log('\n  limpieza: contraseña del picker restaurada');
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
