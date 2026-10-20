/*
 * Organiza los usuarios picker:
 *  - `admin` (global) deja de ser picker (no lleva sucursal).
 *  - `juan` -> TID Sucursal 11.
 *  - `demo_picker1` queda como picker en su sucursal (estaba is_picker=false).
 *  - Verifica que TODOS los pickers tengan sucursal y que cada sucursal activa
 *    tenga al menos un picker de ejemplo.
 */
const { Client } = require('pg');
const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };

// username -> { branchCode }  (o null para quitar la sucursal)
const PLAN = {
  admin: { isPicker: false }, // admin global: no es picker
  juan: { isPicker: true, branchCode: '1' },
  demo_picker1: { isPicker: true }, // conserva su sucursal actual
  demo_picker2: { isPicker: true },
  demo_picker3: { isPicker: true },
  demo_picker4: { isPicker: true },
};

(async () => {
  const db = new Client(DB);
  await db.connect();

  for (const [username, plan] of Object.entries(PLAN)) {
    const u = await db.query(`SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1`, [username]);
    if (!u.rows.length) {
      console.log(`SKIP ${username}: no existe`);
      continue;
    }
    const userId = Number(u.rows[0].id);

    if (plan.isPicker !== undefined) {
      await db.query(`UPDATE users SET is_picker = $1, updated_at = now() WHERE id = $2`, [plan.isPicker, userId]);
    }

    if (plan.branchCode !== undefined) {
      const b = await db.query(`SELECT id, name FROM branches WHERE code = $1 LIMIT 1`, [plan.branchCode]);
      if (!b.rows.length) {
        console.log(`  ! ${username}: no existe la sucursal code=${plan.branchCode}`);
      } else {
        await db.query(`DELETE FROM user_branches WHERE user_id = $1`, [userId]);
        await db.query(`INSERT INTO user_branches (user_id, branch_id) VALUES ($1,$2)`, [userId, Number(b.rows[0].id)]);
        console.log(`  ${username} -> ${b.rows[0].name}`);
      }
    } else {
      console.log(`  ${username} (${plan.isPicker ? 'picker' : 'no picker'})`);
    }
  }

  // ── Verificación ──
  console.log('\n=== Verificación ===');
  const pickers = await db.query(
    `SELECT u.id, u.username, b.name AS sucursal
       FROM users u
       LEFT JOIN user_branches ub ON ub.user_id = u.id
       LEFT JOIN branches b ON b.id = ub.branch_id
      WHERE u.is_picker = true AND u.deleted_at IS NULL
      ORDER BY u.id`,
  );
  console.log(`Pickers (${pickers.rows.length}):`);
  for (const r of pickers.rows) {
    console.log(`  #${r.id} ${String(r.username).padEnd(14)} -> ${r.sucursal ?? '⚠ SIN SUCURSAL'}`);
  }
  const sinSucursal = pickers.rows.filter((r) => !r.sucursal);
  console.log(`Pickers sin sucursal: ${sinSucursal.length ? sinSucursal.map((p) => p.username).join(', ') : 'ninguno ✔'}`);

  const branches = await db.query(
    `SELECT b.id, b.name, COUNT(u.id)::int AS pickers
       FROM branches b
       LEFT JOIN user_branches ub ON ub.branch_id = b.id
       LEFT JOIN users u ON u.id = ub.user_id AND u.is_picker = true AND u.deleted_at IS NULL
      WHERE b.is_active = true
      GROUP BY b.id ORDER BY b.id`,
  );
  console.log('\nSucursales activas y pickers:');
  for (const r of branches.rows) {
    console.log(`  ${String(r.name).padEnd(20)} -> ${r.pickers} picker(s) ${r.pickers === 0 ? '⚠' : '✔'}`);
  }
  const sinPicker = branches.rows.filter((r) => r.pickers === 0);
  console.log(`Sucursales activas sin picker: ${sinPicker.length ? sinPicker.map((b) => b.name).join(', ') : 'ninguna ✔'}`);

  await db.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
