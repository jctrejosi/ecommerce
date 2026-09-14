/**
 * SOLO LECTURA. Detalle de usuarios/roles/permisos en LOCAL vs PRODUCCIÓN.
 * No modifica nada.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/diff-prod-rbac-detail.cjs
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BACKEND_DIR = path.resolve(__dirname, '..', 'backend');

function parseEnv(filePath) {
  const r = {};
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    r[k] = v;
  }
  return r;
}

async function dump(label, url, ssl) {
  const c = new Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await c.connect();

  const userCols = await c.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='users'`,
  );
  const hasPicker = userCols.rows.some((r) => r.column_name === 'is_picker');
  const users = await c.query(
    `SELECT id, username, email, is_superuser, ${hasPicker ? 'is_picker, ' : ''}is_active, deleted_at IS NOT NULL AS deleted
     FROM users ORDER BY id`,
  );
  const roles = await c.query(
    `SELECT r.id, r.name, r.is_system,
            array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL) AS codes
     FROM roles r
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     GROUP BY r.id, r.name, r.is_system
     ORDER BY r.name`,
  );
  const userRoles = await c.query(
    `SELECT ur.user_id, u.username, ur.role_id, r.name
     FROM user_roles ur JOIN users u ON u.id = ur.user_id JOIN roles r ON r.id = ur.role_id
     ORDER BY u.username, r.name`,
  );

  console.log(`\n===== ${label} =====`);
  console.log('USERS:');
  for (const u of users.rows) console.log(`  #${u.id} ${u.username.padEnd(14)} ${u.email.padEnd(28)} super=${u.is_superuser} picker=${u.is_picker ?? '?'} active=${u.is_active} del=${u.deleted}`);
  console.log('ROLES (+permisos):');
  for (const r of roles.rows) console.log(`  ${r.name.padEnd(20)} sys=${r.is_system} n=${(r.codes || []).length}`);
  console.log('  códigos por rol:');
  for (const r of roles.rows) console.log(`    ${r.name}: ${(r.codes || []).join(', ')}`);
  console.log('USER_ROLES:');
  if (!userRoles.rows.length) console.log('  (ninguna)');
  for (const ur of userRoles.rows) console.log(`  ${ur.username} -> ${ur.name}`);

  await c.end();
  return { users: users.rows, roles: roles.rows, userRoles: userRoles.rows };
}

async function main() {
  const env = parseEnv(path.join(BACKEND_DIR, '.env.development.local'));
  const LOCAL_URL = env.LOCAL_DATABASE_URL || env.DATABASE_URL;
  const PROD_URL = env.PROD_DATABASE_URL;
  if (!LOCAL_URL || !PROD_URL) throw new Error('Faltan URLs en .env.development.local');

  await dump('LOCAL', LOCAL_URL, false);
  await dump('PRODUCCIÓN', PROD_URL, { rejectUnauthorized: false });
  console.log('\n(inspección terminada — sin cambios)');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
