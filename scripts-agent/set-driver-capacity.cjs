/**
 * Asigna la capacidad de carga (en litros) a un repartidor vía API.
 *
 * Uso:
 *   NODE_PATH=backend/node_modules node scripts-agent/set-driver-capacity.cjs <driverId> <litros> [--clear]
 *   NODE_PATH=backend/node_modules node scripts-agent/set-driver-capacity.cjs --all-defaults
 *
 * `--all-defaults` pone capacidades razonables de ejemplo: moto 120 L,
 * automóvil 400 L, camioneta 1.200 L, bicicleta 40 L.
 */
const BASE = process.env.API_URL || 'http://localhost:3000';
const USER = process.env.QA_USER || 'qa-delivery-temp';
const PASS = process.env.QA_PASS || 'demo123';

const DEFAULTS = {
  motocicleta: 120,
  moto: 120,
  automóvil: 400,
  automovil: 400,
  carro: 400,
  camioneta: 1200,
  bicicleta: 40,
};

/** `vehicle_type` es texto libre en la BD ("MOTO", "Moto", "Carro"…). */
function defaultLiters(vehicleType) {
  const key = String(vehicleType ?? '')
    .trim()
    .toLowerCase();
  return DEFAULTS[key] ?? 100;
}

async function req(method, url, { token, body } = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* no-JSON */
  }
  return { status: res.status, json, text };
}

const unwrap = (j) => (j && typeof j === 'object' && 'data' in j ? j.data : j);

async function main() {
  const args = process.argv.slice(2);
  const login = await req('POST', '/auth/login', {
    body: { identifier: USER, password: PASS },
  });
  const token = unwrap(login.json)?.accessToken;
  if (!token) throw new Error(`login falló (${login.status})`);

  if (args.includes('--all-defaults')) {
    const drivers = unwrap((await req('GET', '/delivery/admin/drivers', { token })).json) ?? [];
    for (const d of drivers) {
      const liters = defaultLiters(d.vehicleType);
      const r = await req('PUT', `/delivery/admin/drivers/${d.id}`, {
        token,
        body: { cargoVolumeCm3: liters * 1000 },
      });
      console.log(
        `${d.id} ${d.fullName} (${d.vehicleType ?? 'sin tipo'}) → ${liters} L · status ${r.status}`,
      );
    }
    return;
  }

  const driverId = Number(args[0]);
  if (!driverId) throw new Error('Falta el id del repartidor.');
  const clear = args.includes('--clear');
  const liters = Number(args[1]);
  if (!clear && (!Number.isFinite(liters) || liters <= 0)) {
    throw new Error('Indica los litros (número > 0) o usa --clear.');
  }

  const body = { cargoVolumeCm3: clear ? null : Math.round(liters * 1000) };
  const res = await req('PUT', `/delivery/admin/drivers/${driverId}`, { token, body });
  const d = unwrap(res.json);
  console.log(
    `repartidor ${driverId} → ${clear ? 'sin capacidad' : `${liters} L`} · status ${res.status} · ` +
      `devuelve ${d?.cargoVolumeCm3 ?? 'n/a'} cm³ · ocupación ${
        d?.load ? `${(d.load.usedCm3 / 1000).toFixed(1)} L / ${d.load.capacityCm3 ? `${(d.load.capacityCm3 / 1000).toFixed(1)} L` : '—'}` : 'n/a'
      }`,
  );
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
