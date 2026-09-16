/**
 * Prueba end-to-end del chat repartidor ↔ admin.
 *
 *   1. Abre dos sockets al namespace `/delivery`:
 *        - admin (JWT superuser) → sala `fleet`,
 *        - repartidor Juan (login real) → sala `driver:<id>`.
 *   2. El admin envía un mensaje por HTTP y se verifica que le llegue al
 *      repartidor (y al propio panel, para sincronizar pestañas).
 *   3. El repartidor responde y se verifica que le llegue al panel.
 *   4. Borra los mensajes de prueba (no deja basura en el historial).
 *
 * Uso (desde la raíz del repo):
 *   node scripts-agent/driver-chat-e2e.cjs
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const from = (mod, ...dirs) =>
  require(require.resolve(mod, { paths: dirs.map((d) => path.join(ROOT, d)) }));

const { Client } = from('pg', 'backend/node_modules');
const { io } = from('socket.io-client', 'Interface web admin/node_modules');
const jwt = from('jsonwebtoken', 'backend/node_modules');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecommerce';
const JWT_SECRET =
  process.env.JWT_SECRET ||
  'ee25eb6e91a2ef6bc3d2f19146f12e0a95659    32d31afdf125fe266a0423e9881';

const MARK = `E2E-${Math.floor(1000 + Math.random() * 8999)}`;
const DRIVER_ID = 6; // Juan
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  // ── Tokens ──
  const adminToken = jwt.sign(
    { sub: 1, email: 'admin@mercaldas.com.co', username: 'admin', isSuperuser: true },
    JWT_SECRET,
    { expiresIn: '10m' },
  );
  const loginRes = await fetch(`${BASE}/delivery/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'juan', password: 'juan4231' }),
  });
  const driverToken = (await loginRes.json()).accessToken;
  if (!driverToken) throw new Error(`Login del repartidor falló (HTTP ${loginRes.status})`);

  // ── Sockets ──
  const adminEvents = [];
  const driverEvents = [];
  const adminSock = io(`${BASE}/delivery`, {
    transports: ['websocket'],
    auth: { token: adminToken },
  });
  const driverSock = io(`${BASE}/delivery`, {
    transports: ['websocket'],
    auth: { token: driverToken },
  });
  adminSock.on('delivery:admin-chat', (p) => adminEvents.push(p));
  driverSock.on('delivery:admin-chat', (p) => driverEvents.push(p));
  await wait(1500);

  // ── 1) Admin → repartidor ──
  const adminPost = await fetch(`${BASE}/delivery/admin/drivers/${DRIVER_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ body: `${MARK} admin -> repartidor` }),
  });
  console.log(`[1] POST admin -> repartidor: HTTP ${adminPost.status}`);
  await wait(1200);

  // ── 2) Repartidor → admin ──
  const driverPost = await fetch(`${BASE}/delivery/admin-chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${driverToken}` },
    body: JSON.stringify({ body: `${MARK} repartidor -> admin` }),
  });
  console.log(`[2] POST repartidor -> admin: HTTP ${driverPost.status}`);
  await wait(1200);

  // ── 3) Lectura en ambos sentidos ──
  const adminMsgs = await (
    await fetch(`${BASE}/delivery/admin/drivers/${DRIVER_ID}/messages`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
  ).json();
  const driverMsgs = await (
    await fetch(`${BASE}/delivery/admin-chat/messages`, {
      headers: { Authorization: `Bearer ${driverToken}` },
    })
  ).json();

  adminSock.disconnect();
  driverSock.disconnect();

  const persisted = await db.query(
    `SELECT count(*)::int AS n FROM driver_chat_messages WHERE body LIKE $1`,
    [`${MARK}%`],
  );
  await db.query(`DELETE FROM driver_chat_messages WHERE body LIKE $1`, [`${MARK}%`]);

  const adminGotDriverMsg = adminEvents.some((e) => String(e.message?.body).includes('repartidor -> admin'));
  const driverGotAdminMsg = driverEvents.some((e) => String(e.message?.body).includes('admin -> repartidor'));

  // Datos que usa la notificación del navegador en el panel: driverId + lado.
  const eventoPanel = adminEvents.find((e) =>
    String(e.message?.body).includes('repartidor -> admin'),
  );
  console.log(
    `[3b] evento del panel: driverId=${eventoPanel?.driverId} senderType=${eventoPanel?.message?.senderType}`,
  );

  console.log(`[3] socket admin  → ${adminEvents.length} evento(s); recibió el del repartidor: ${adminGotDriverMsg}`);
  console.log(`[4] socket driver → ${driverEvents.length} evento(s); recibió el del admin: ${driverGotAdminMsg}`);
  console.log(`[5] filas persistidas en BD: ${persisted.rows[0].n}`);
  console.log(`[6] hilo del admin: ${Array.isArray(adminMsgs) ? adminMsgs.length : 'ERR'} mensajes; hilo del repartidor: ${Array.isArray(driverMsgs) ? driverMsgs.length : 'ERR'} mensajes`);
  await db.end();

  const ok =
    adminPost.status < 400 &&
    driverPost.status < 400 &&
    persisted.rows[0].n === 2 &&
    adminGotDriverMsg &&
    driverGotAdminMsg;
  console.log(ok ? 'RESULTADO: OK (y mensajes de prueba borrados)' : 'RESULTADO: FALLO');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
