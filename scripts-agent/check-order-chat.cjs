/**
 * Comprueba el chat de un pedido desde el punto de vista del repartidor:
 * inicia sesión como Juan, lista sus pedidos activos y muestra los últimos
 * mensajes del chat del pedido indicado.
 *
 * Uso: node scripts-agent/check-order-chat.cjs [orderId]
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ORDER_ID = process.argv[2] || '2';

async function main() {
  const login = await fetch(`${BASE}/delivery/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'juan', password: 'juan4231' }),
  });
  const { accessToken } = await login.json();
  if (!accessToken) throw new Error(`login falló (HTTP ${login.status})`);

  const auth = { Authorization: `Bearer ${accessToken}` };

  const activeRes = await fetch(`${BASE}/delivery/orders`, { headers: auth });
  const active = await activeRes.json();
  console.log(`[api] /delivery/orders -> HTTP ${activeRes.status}`);
  for (const o of Array.isArray(active) ? active : []) {
    console.log(`      id=${o.id} code=${o.referenceCode} status=${o.status}`);
  }

  const chatRes = await fetch(`${BASE}/delivery/orders/${ORDER_ID}/messages`, {
    headers: auth,
  });
  console.log(`\n[api] /delivery/orders/${ORDER_ID}/messages -> HTTP ${chatRes.status}`);
  const body = await chatRes.json();
  const list = Array.isArray(body) ? body : [];
  console.log(`[api] mensajes: ${list.length}`);
  for (const m of list.slice(-5)) {
    console.log(
      `      #${m.id} ${m.senderType} ${m.createdAt} :: ${String(m.body).slice(0, 50)}`,
    );
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
