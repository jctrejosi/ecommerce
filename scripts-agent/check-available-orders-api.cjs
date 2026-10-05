/**
 * Verifica el reparto de pedidos en el API de delivery (sin la app):
 *   1. GET /delivery/orders/available devuelve los pedidos "nuevos" de TODOS
 *      los repartidores (no solo los míos),
 *   2. cada uno trae `assignedToMe`,
 *   3. GET /delivery/orders (mis activos) solo trae los míos,
 *   4. el detalle de un pedido nuevo de otro repartidor abre (200) y llega con
 *      `assignedToMe: false`.
 *
 * Uso: node scripts-agent/check-available-orders-api.cjs [baseUrl]
 * Requiere backend corriendo y el usuario de prueba `juan` (juan4231).
 */
const BASE = process.argv[2] || process.env.API_URL || 'http://localhost:3000';
const USUARIO = process.env.DELIVERY_USER || 'juan';
const CLAVE = process.env.DELIVERY_PASS || 'juan4231';

const NUEVOS = ['ASSIGNED', 'ACCEPTED', 'READY_FOR_PICKUP'];
const EN_CAMINO = ['PICKED_UP', 'IN_DELIVERY'];

async function main() {
  const problemas = [];

  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: USUARIO, password: CLAVE }),
  });
  if (!loginRes.ok) {
    throw new Error(`login ${loginRes.status}: ${await loginRes.text()}`);
  }
  const { accessToken } = await loginRes.json();
  const auth = { Authorization: `Bearer ${accessToken}` };
  console.log(`[1] login ${USUARIO} OK`);

  const getJson = async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: auth });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const { status: avStatus, body: available } = await getJson('/delivery/orders/available');
  const { status: myStatus, body: mine } = await getJson('/delivery/orders');
  console.log(`[2] available: HTTP ${avStatus}, ${Array.isArray(available) ? available.length : '?'} pedidos`);
  console.log(`[3] mis activos: HTTP ${myStatus}, ${Array.isArray(mine) ? mine.length : '?'} pedidos`);

  if (avStatus !== 200 || !Array.isArray(available)) {
    problemas.push(`/orders/available no devolvió lista (HTTP ${avStatus})`);
  }
  if (myStatus !== 200 || !Array.isArray(mine)) {
    problemas.push(`/orders no devolvió lista (HTTP ${myStatus})`);
  }

  const listaAv = Array.isArray(available) ? available : [];
  const listaMios = Array.isArray(mine) ? mine : [];

  if (listaAv.length) {
    const fuera = listaAv.filter((o) => !NUEVOS.includes(o.status));
    if (fuera.length) problemas.push(`available trae estados no nuevos: ${fuera.map((o) => o.status)}`);
    const ids = listaAv.map((o) => String(o.id));
    if (new Set(ids).size !== ids.length) problemas.push('available trae pedidos repetidos');
    const sinFlag = listaAv.filter((o) => typeof o.assignedToMe !== 'boolean');
    if (sinFlag.length) problemas.push(`${sinFlag.length} pedidos sin assignedToMe`);

    const ajenos = listaAv.filter((o) => o.assignedToMe === false);
    const propios = listaAv.filter((o) => o.assignedToMe === true);
    console.log(
      `[4] nuevos: ${listaAv.length} (míos ${propios.length}, de otros ${ajenos.length})`,
    );
    console.log(`    códigos: ${listaAv.map((o) => `${o.referenceCode}${o.assignedToMe ? '*' : ''}`).join(', ')}`);

    // El detalle de un pedido nuevo ajeno debe abrir y venir marcado como ajeno.
    if (ajenos.length) {
      const { status, body } = await getJson(`/delivery/orders/${ajenos[0].id}`);
      console.log(`[5] detalle ajeno ${ajenos[0].referenceCode}: HTTP ${status}, assignedToMe=${body?.assignedToMe}`);
      if (status !== 200) problemas.push(`el detalle de un nuevo ajeno dio HTTP ${status}`);
      else if (body?.assignedToMe !== false) problemas.push('el detalle ajeno no trae assignedToMe=false');
    } else {
      console.log('[5] no hay pedidos nuevos de otros repartidores para probar el detalle ajeno');
    }

    if (propios.length) {
      const { status, body } = await getJson(`/delivery/orders/${propios[0].id}`);
      console.log(`[6] detalle propio ${propios[0].referenceCode}: HTTP ${status}, assignedToMe=${body?.assignedToMe}`);
      if (status !== 200) problemas.push(`el detalle propio dio HTTP ${status}`);
      else if (body?.assignedToMe !== true) problemas.push('el detalle propio no trae assignedToMe=true');
    }
  } else {
    problemas.push('available vino vacío: no se pudo verificar');
  }

  // En camino: solo míos.
  const enCamino = listaMios.filter((o) => EN_CAMINO.includes(o.status));
  const enCaminoAjenos = enCamino.filter((o) => o.assignedToMe === false);
  console.log(`[7] en camino: ${enCamino.length} (ajenos ${enCaminoAjenos.length})`);
  if (enCaminoAjenos.length) problemas.push('en camino trae pedidos de otros repartidores');

  console.log(problemas.length ? `❌ ${problemas.join(' · ')}` : '✅ reparto pedidos nuevos/en camino OK');
  process.exitCode = problemas.length ? 1 : 0;
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
