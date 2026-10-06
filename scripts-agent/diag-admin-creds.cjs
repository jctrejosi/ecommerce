/*
 * Diagnóstico de credenciales del admin: verifica usuario, estado y si la
 * contraseña "admin123" corresponde al hash guardado.
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const DB = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'ecommerce' };

(async () => {
  const db = new Client(DB);
  await db.connect();
  const { rows } = await db.query(
    `SELECT id, email, username, is_superuser, is_active, is_picker,
            filed_attempts, locked_until, deleted_at, password_hash
       FROM users WHERE username = 'admin'`,
  );
  console.log(JSON.stringify(rows.map((r) => ({ ...r, password_hash: r.password_hash?.slice(0, 12) + '…' })), null, 2));
  if (rows[0]) {
    for (const pw of ['admin123', 'Admin123', 'admin', 'demo123']) {
      const ok = await bcrypt.compare(pw, rows[0].password_hash);
      console.log(`  probe "${pw}": ${ok}`);
    }
  }
  await db.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
