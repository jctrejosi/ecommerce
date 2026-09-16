/**
 * Envía un mensaje del panel al repartidor (para probar el tono en el móvil).
 *
 * Uso:
 *   node scripts-agent/send-admin-message.cjs            # mensaje por defecto
 *   node scripts-agent/send-admin-message.cjs "mi texto"
 *   DRIVER_ID=6 node scripts-agent/send-admin-message.cjs "mi texto"
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const from = (mod, ...dirs) =>
  require(require.resolve(mod, { paths: dirs.map((d) => path.join(ROOT, d)) }));

const jwt = from('jsonwebtoken', 'backend/node_modules');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const JWT_SECRET =
  process.env.JWT_SECRET ||
  'ee25eb6e91a2ef6bc3d2f19146f12e0a95659    32d31afdf125fe266a0423e9881';
const DRIVER_ID = Number(process.env.DRIVER_ID || 6);

async function main() {
  const body =
    process.argv[2] || `prueba tono rockerito ${new Date().toLocaleTimeString()}`;

  const token = jwt.sign(
    { sub: 1, email: 'admin@mercaldas.com.co', username: 'admin', isSuperuser: true },
    JWT_SECRET,
    { expiresIn: '10m' },
  );

  const res = await fetch(`${BASE}/delivery/admin/drivers/${DRIVER_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ body }),
  });

  const text = await res.text();
  console.log(`[http] POST /delivery/admin/drivers/${DRIVER_ID}/messages -> ${res.status}`);
  console.log(`[http] body: ${text.slice(0, 200)}`);
  console.log(`[http] enviado: "${body}"`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
