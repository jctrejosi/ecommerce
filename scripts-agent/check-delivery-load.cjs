/**
 * Verificación end-to-end del volumen de carga (fases 1-3):
 *   1. login como admin de delivery,
 *   2. GET /delivery/admin/drivers  → capacidad + cupo comprometido por repartidor,
 *   3. GET /delivery/admin/orders   → volumen por pedido,
 *   4. PUT capacidad de un repartidor y comprobar que persiste,
 *   5. validar que la capacidad inválida (< 1 L) se rechaza.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-delivery-load.cjs
 */
const BASE = process.env.API_URL || 'http://localhost:3000';
const USER = process.env.QA_USER || 'qa-delivery-temp';
const PASS = process.env.QA_PASS || 'demo123';

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
    /* respuesta no-JSON */
  }
  return { status: res.status, json, text };
}

/** El backend envuelve las respuestas en `{ success, data }` en algunos casos. */
const unwrap = (j) => (j && typeof j === 'object' && 'data' in j ? j.data : j);

const liters = (cm3) => (cm3 == null ? '—' : `${(cm3 / 1000).toFixed(1)} L`);

async function main() {
  const login = await req('POST', '/auth/login', {
    body: { identifier: USER, password: PASS },
  });
  const auth = unwrap(login.json);
  const token = auth?.accessToken;
  if (!token) {
    throw new Error(`login falló (${login.status}): ${login.text.slice(0, 200)}`);
  }
  console.log('✅ login ok');

  // 2. Repartidores
  const driversRes = await req('GET', '/delivery/admin/drivers', { token });
  const drivers = unwrap(driversRes.json) ?? [];
  console.log(`\n== Repartidores (${drivers.length}) ==`);
  console.log('id | nombre            | capacidad | usado   | pedidos | estimado | sobrecarga');
  for (const d of drivers) {
    const l = d.load ?? {};
    console.log(
      `${String(d.id).padEnd(2)} | ${String(d.fullName).padEnd(17)} | ${String(
        liters(d.cargoVolumeCm3),
      ).padEnd(9)} | ${String(liters(l.usedCm3)).padEnd(7)} | ${String(
        l.orders ?? 0,
      ).padEnd(7)} | ${String(l.estimated ?? false).padEnd(8)} | ${l.overloaded ?? false}`,
    );
  }

  // 3. Pedidos
  const ordersRes = await req('GET', '/delivery/admin/orders', { token });
  const orders = unwrap(ordersRes.json) ?? [];
  console.log(`\n== Pedidos activos (${orders.length}) ==`);
  for (const o of orders) {
    console.log(
      `#${o.orderId} ${o.referenceCode} | ${o.status} | driver=${o.driverId} | volumen=${
        o.volume?.cm3 == null ? 'SIN CALCULAR' : liters(o.volume.cm3)
      }${o.volume?.estimated ? ' (aprox.)' : ''}`,
    );
  }
  const sinVolumen = orders.filter((o) => o.volume?.cm3 == null).length;
  console.log(`pedidos activos sin volumen calculado: ${sinVolumen}`);

  // 4. Capacidad persistente
  const target = drivers.find((d) => d.load) ?? drivers[0];
  if (!target) {
    console.log('\n(sin repartidores: se omite la prueba de capacidad)');
    return;
  }
  const original = target.cargoVolumeCm3;
  const probe = 150_000; // 150 L
  const put = await req('PUT', `/delivery/admin/drivers/${target.id}`, {
    token,
    body: { cargoVolumeCm3: probe },
  });
  const updated = unwrap(put.json);
  console.log(
    `\n== Capacidad (repartidor ${target.id}) ==\n` +
      `PUT ${probe} cm³ → status ${put.status} · devuelve ${
        updated?.cargoVolumeCm3 ?? 'n/a'
      } cm³ (${liters(updated?.cargoVolumeCm3)})`,
  );

  const after = unwrap(
    (await req('GET', `/delivery/admin/drivers/${target.id}`, { token })).json,
  );
  console.log(
    `GET de nuevo → ${after?.cargoVolumeCm3} cm³ · ocupación ${liters(
      after?.load?.usedCm3,
    )} / ${liters(after?.load?.capacityCm3)} · fill=${
      after?.load?.fill == null ? '—' : `${Math.round(after.load.fill * 100)}%`
    } · sobrecarga=${after?.load?.overloaded}`,
  );

  // 5. Validación: por debajo del mínimo (1 L = 1.000 cm³)
  const bad = await req('PUT', `/delivery/admin/drivers/${target.id}`, {
    token,
    body: { cargoVolumeCm3: 500 },
  });
  console.log(`\n== Validación ==\nPUT 500 cm³ (0,5 L) → status ${bad.status} (se espera 400)`);

  // Restaurar el valor original
  const restore = await req('PUT', `/delivery/admin/drivers/${target.id}`, {
    token,
    body: { cargoVolumeCm3: original ?? null },
  });
  console.log(
    `restaurado a ${original ?? 'null'} → status ${restore.status} (${liters(
      unwrap(restore.json)?.cargoVolumeCm3,
    )})`,
  );
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
