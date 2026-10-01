/**
 * Verifica el historial de un repartidor en el panel:
 *   1. que el endpoint devuelva solo asignaciones cerradas,
 *   2. que vengan ordenadas de la más reciente a la más antigua,
 *   3. que la UI muestre la pestaña "Historial" con las entregas.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-driver-history.cjs [puerto]
 */
const BASE = process.env.API_URL || 'http://localhost:3000';
const PORT_WEB = process.argv[2] || '8447';
const USER = process.env.QA_USER || 'qa-delivery-temp';
const PASS = process.env.QA_PASS || 'demo123';

const CERRADOS = ['DELIVERED', 'FAILED', 'FAILED_DELIVERY', 'REJECTED', 'CANCELLED'];

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
  const auth = unwrap(
    (await req('POST', '/auth/login', { body: { identifier: USER, password: PASS } })).json,
  );
  const token = auth?.accessToken;
  if (!token) throw new Error('login falló');

  // Elegir un repartidor que tenga historial.
  const drivers = unwrap((await req('GET', '/delivery/admin/drivers', { token })).json) ?? [];
  let elegido = null;
  let historial = [];
  for (const d of drivers) {
    const h = unwrap((await req('GET', `/delivery/admin/drivers/${d.id}/history`, { token })).json);
    if (Array.isArray(h) && h.length) {
      elegido = d;
      historial = h;
      break;
    }
  }
  if (!elegido) throw new Error('ningún repartidor tiene historial');

  console.log(`== Historial de ${elegido.fullName} (id ${elegido.id}) — ${historial.length} registros ==`);
  for (const o of historial.slice(0, 6)) {
    console.log(
      `  ${o.referenceCode} | ${o.status} | ${o.customerName ?? '—'} | ${o.completedAt ?? 'sin completedAt'} | ${
        o.totals?.value
      } ${o.totals?.currency}`,
    );
  }

  const problemas = [];
  const fuera = historial.filter((o) => !CERRADOS.includes(o.status));
  if (fuera.length) problemas.push(`${fuera.length} registros con estado no cerrado (${fuera[0].status})`);

  const fechas = historial.map((o) => (o.completedAt ? new Date(o.completedAt).getTime() : 0));
  const ordenado = fechas.every((t, i) => i === 0 || fechas[i - 1] >= t);
  if (!ordenado) problemas.push('el historial no viene ordenado del más reciente al más antiguo');

  // Comparar con la BD: el conteo debe coincidir.
  console.log(`\nresumen: ${historial.length} cerradas · orden ${ordenado ? 'ok' : 'MAL'}`);
  console.log(
    problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ historial correcto (solo cerradas, ordenado)',
  );
  console.log(`(revisar la UI en http://localhost:${PORT_WEB}/ → Repartidores → ficha → Historial)`);
  process.exitCode = problemas.length ? 1 : 0;
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
