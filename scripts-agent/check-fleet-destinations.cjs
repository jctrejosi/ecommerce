/**
 * Revisa lo que el panel recibe de `/delivery/admin/drivers`: por repartidor,
 * si trae posición conocida y si su entrega activa trae coordenadas de destino
 * (de eso depende que el mapa dibuje la casita del cliente).
 *
 * Uso: node scripts-agent/check-fleet-destinations.cjs
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

async function main() {
  const token = jwt.sign(
    { sub: 1, email: 'admin@mercaldas.com.co', username: 'admin', isSuperuser: true },
    JWT_SECRET,
    { expiresIn: '10m' },
  );

  const res = await fetch(`${BASE}/delivery/admin/drivers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`[api] GET /delivery/admin/drivers -> HTTP ${res.status}`);
  const body = await res.json();
  const drivers = Array.isArray(body) ? body : (body.data ?? []);

  for (const d of drivers) {
    const a = d.activeAssignment;
    const loc = d.location ? `${d.location.lat},${d.location.lng}` : '—';
    const dest = a?.destination ? `${a.destination.lat},${a.destination.lng}` : '—';
    console.log(
      `\n#${d.id} ${d.fullName}  activo=${d.isActive} disponible=${d.isAvailable}` +
        `\n   lastLocationAt: ${d.lastLocationAt ?? '—'}` +
        `\n   ubicación     : ${loc}` +
        `\n   entrega       : ${a ? `${a.referenceCode ?? '?'} (${a.status})` : '—'}` +
        `\n   destino       : ${dest}` +
        (a?.branchLocation ? `\n   sucursal      : ${a.branchLocation.lat},${a.branchLocation.lng}` : ''),
    );
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
