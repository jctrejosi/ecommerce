/*
 * Crea (idempotente) los administradores de sucursal: superusuario con una sola
 * sucursal asignada. El "admin" global sigue sin sucursal (se conserva).
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };
const PASSWORD = 'admin123';

// code de la sucursal -> usuario
const ADMINS = [
  { username: 'admin.tid1', email: 'admin.tid1@dsi.com.co', branchCode: '1' },
  { username: 'admin.tid2', email: 'admin.tid2@dsi.com.co', branchCode: '2' },
  { username: 'admin.tid11', email: 'admin.tid11@dsi.com.co', branchCode: '11' },
];

(async () => {
  const db = new Client(DB);
  await db.connect();
  const hash = await bcrypt.hash(PASSWORD, 10);

  for (const a of ADMINS) {
    const b = await db.query(`SELECT id, name FROM branches WHERE code = $1 LIMIT 1`, [a.branchCode]);
    if (!b.rows.length) {
      console.log(`SKIP ${a.username}: no existe la sucursal code=${a.branchCode}`);
      continue;
    }
    const branchId = Number(b.rows[0].id);

    const existing = await db.query(`SELECT id FROM users WHERE username = $1 LIMIT 1`, [a.username]);
    let userId;
    if (existing.rows.length) {
      userId = Number(existing.rows[0].id);
      await db.query(
        `UPDATE users SET email=$2, password_hash=$3, is_superuser=true, is_active=true,
                           is_picker=false, deleted_at=null, updated_at=now() WHERE id=$1`,
        [userId, a.email, hash],
      );
      console.log(`Actualizado ${a.username} (#${userId})`);
    } else {
      const ins = await db.query(
        `INSERT INTO users (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
         VALUES ($1,$2,$3,'Admin',$4,true,true,false) RETURNING id`,
        [a.email, a.username, hash, a.branchCode === '1' ? 'Sucursal 1' : `Sucursal ${a.branchCode}`],
      );
      userId = Number(ins.rows[0].id);
      console.log(`Creado ${a.username} (#${userId})`);
    }

    // Una sola sucursal: reemplaza la asignación previa.
    await db.query(`DELETE FROM user_branches WHERE user_id = $1`, [userId]);
    await db.query(`INSERT INTO user_branches (user_id, branch_id) VALUES ($1,$2)`, [userId, branchId]);
    console.log(`  -> sucursal ${branchId} (${b.rows[0].name})`);
  }

  console.log('\nAdministradores y su sucursal:');
  const all = await db.query(
    `SELECT u.id, u.username, u.is_superuser, b.name AS sucursal
       FROM users u
       LEFT JOIN user_branches ub ON ub.user_id = u.id
       LEFT JOIN branches b ON b.id = ub.branch_id
      WHERE u.deleted_at IS NULL AND (u.is_superuser = true OR u.username LIKE 'admin%')
      ORDER BY u.id`,
  );
  for (const r of all.rows) {
    console.log(`  #${r.id} ${String(r.username).padEnd(14)} super=${r.is_superuser} -> ${r.sucursal ?? 'GLOBAL'}`);
  }
  await db.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
