/**
 * Reorganiza los usuarios del sistema:
 *  - admin global:            admin / admin123  (superusuario, picker)
 *  - un demo por app:         demo-<app> / demo123
 *  - cliente de tienda:       demo-tienda@mercaldas.co / demo123  (tabla customers)
 *  - desactiva los usuarios actuales (admin-ecommerce, demo, demo2, demo3, test-picker-qa)
 *
 * Uso (desde la raíz del repo):
 *   NODE_PATH=backend/node_modules node scripts-agent/seed-demo-users.cjs
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';

const ADMIN_PASSWORD = 'admin123';
const DEMO_PASSWORD = 'demo123';

/** Usuarios de staff/apps que van a la tabla `users`. */
const USERS = [
  {
    username: 'admin',
    email: 'admin@mercaldas.com.co',
    firstName: 'Admin',
    lastName: 'Global',
    password: ADMIN_PASSWORD,
    isSuperuser: true,
    isPicker: true,
  },
  {
    username: 'demo-admin',
    email: 'demo-admin@mercaldas.co',
    firstName: 'Demo',
    lastName: 'Admin',
    password: DEMO_PASSWORD,
    isSuperuser: true,
    isPicker: false,
  },
  {
    username: 'demo-analytics',
    email: 'demo-analytics@mercaldas.co',
    firstName: 'Demo',
    lastName: 'Analytics',
    password: DEMO_PASSWORD,
    isSuperuser: true,
    isPicker: false,
  },
  {
    username: 'demo-picking',
    email: 'demo-picking@mercaldas.co',
    firstName: 'Demo',
    lastName: 'Picking',
    password: DEMO_PASSWORD,
    isSuperuser: true,
    isPicker: false,
  },
  {
    username: 'demo-picking-admin',
    email: 'demo-picking-admin@mercaldas.co',
    firstName: 'Demo',
    lastName: 'Picking Admin',
    password: DEMO_PASSWORD,
    isSuperuser: true,
    isPicker: false,
  },
  {
    username: 'demo-picking-mobile',
    email: 'demo-picking-mobile@mercaldas.co',
    firstName: 'Demo',
    lastName: 'Picking Móvil',
    password: DEMO_PASSWORD,
    isSuperuser: false,
    isPicker: true,
  },
  {
    username: 'demo-delivery',
    email: 'demo-delivery@mercaldas.co',
    firstName: 'Demo',
    lastName: 'Delivery',
    password: DEMO_PASSWORD,
    isSuperuser: false,
    isPicker: false,
  },
  {
    username: 'demo-delivery-admin',
    email: 'demo-delivery-admin@mercaldas.co',
    firstName: 'Demo',
    lastName: 'Delivery Admin',
    password: DEMO_PASSWORD,
    isSuperuser: true,
    isPicker: false,
  },
];

/** Usuarios actuales que se desactivan. */
const DEACTIVATE = ['admin-ecommerce', 'demo', 'demo2', 'demo3', 'test-picker-qa'];

/** Cliente demo para la tienda (tabla customers). */
const CUSTOMER = {
  email: 'demo-tienda@mercaldas.co',
  firstName: 'Demo',
  lastName: 'Tienda',
  phone: '3000000000',
  password: DEMO_PASSWORD,
};

async function upsertUser(db, u) {
  const passwordHash = await bcrypt.hash(u.password, 10);
  await db.query(
    `INSERT INTO users
       (email, username, password_hash, first_name, last_name, is_superuser, is_active, is_picker)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)
     ON CONFLICT (email) DO UPDATE SET
       username = EXCLUDED.username,
       password_hash = EXCLUDED.password_hash,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       is_superuser = EXCLUDED.is_superuser,
       is_active = true,
       is_picker = EXCLUDED.is_picker,
       deleted_at = NULL,
       locked_until = NULL,
       filed_attempts = 0,
       updated_at = now()`,
    [
      u.email,
      u.username,
      passwordHash,
      u.firstName,
      u.lastName,
      u.isSuperuser,
      u.isPicker,
    ],
  );
}

async function upsertCustomer(db) {
  const passwordHash = await bcrypt.hash(CUSTOMER.password, 10);
  const found = await db.query('SELECT id FROM customers WHERE email = $1 LIMIT 1', [
    CUSTOMER.email,
  ]);
  if (found.rowCount > 0) {
    await db.query(
      `UPDATE customers SET
         password_hash = $2, first_name = $3, last_name = $4, phone = $5,
         is_active = true, provider = 'local', is_verified = true,
         email_verified = true, deleted_at = NULL, updated_at = now()
       WHERE email = $1`,
      [
        CUSTOMER.email,
        passwordHash,
        CUSTOMER.firstName,
        CUSTOMER.lastName,
        CUSTOMER.phone,
      ],
    );
    return 'actualizado';
  }
  await db.query(
    `INSERT INTO customers
       (email, password_hash, first_name, last_name, phone, is_active, provider, is_verified, email_verified)
     VALUES ($1, $2, $3, $4, $5, true, 'local', true, true)`,
    [
      CUSTOMER.email,
      passwordHash,
      CUSTOMER.firstName,
      CUSTOMER.lastName,
      CUSTOMER.phone,
    ],
  );
  return 'creado';
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    for (const u of USERS) await upsertUser(db, u);

    const deact = await db.query(
      `UPDATE users SET is_active = false, is_picker = false, updated_at = now()
       WHERE username = ANY($1::text[])`,
      [DEACTIVATE],
    );

    const customerResult = await upsertCustomer(db);

    const summary = await db.query(
      `SELECT username, is_superuser, is_picker, is_active
       FROM users WHERE deleted_at IS NULL ORDER BY username`,
    );

    console.log('Usuarios activos:');
    for (const r of summary.rows) {
      console.log(
        `  - ${r.username.padEnd(22)} superuser=${r.is_superuser} picker=${r.is_picker} active=${r.is_active}`,
      );
    }
    console.log(`Usuarios desactivados: ${deact.rowCount} (${DEACTIVATE.join(', ')})`);
    console.log(`Cliente tienda ${customerResult}: ${CUSTOMER.email} / ${DEMO_PASSWORD}`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
