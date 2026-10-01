/**
 * Verifica que el escaneo de picking valide el código contra el INEAN
 * (`product_variants.barcode`) y el PLU del producto, incluyendo la
 * normalización UPC-A (12) ↔ EAN-13 (13).
 *
 * Crea un pedido de prueba aislado, ejercita POST /picking/orders/:id/scan y lo
 * elimina al final. No toca pedidos reales.
 *
 * Uso: NODE_PATH=backend/node_modules node scripts-agent/check-picking-scan-barcode.cjs
 */
const { createRequire } = require('node:module');
const { resolve } = require('node:path');

const requireFromBackend = createRequire(resolve(__dirname, '../backend/package.json'));
const { Client } = requireFromBackend('pg');

const API = process.env.API_URL || 'http://127.0.0.1:3000';

let checks = 0;
let failures = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALLO'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function scan(orderId, code) {
  const res = await fetch(`${API}/picking/orders/${orderId}/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* noop */ }
  return { status: res.status, body };
}

async function main() {
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  });
  await db.connect();

  // Variante con barcode de 12 dígitos (UPC-A) y variante de 13 (EAN-13), cada
  // una con su producto (para tomar el PLU).
  const { rows: v12 } = await db.query(
    `SELECT pv.id AS variant_id, pv.barcode, p.id AS product_id, p.plu, p.name
       FROM product_variants pv JOIN products p ON p.id = pv.product_id
      WHERE pv.barcode ~ '^[0-9]{12}$' LIMIT 1`,
  );
  const { rows: v13 } = await db.query(
    `SELECT pv.id AS variant_id, pv.barcode, p.id AS product_id, p.plu, p.name
       FROM product_variants pv JOIN products p ON p.id = pv.product_id
      WHERE pv.barcode ~ '^[0-9]{13}$' LIMIT 1`,
  );
  const upc = v12[0];
  const ean = v13[0];
  const { rows: br } = await db.query(`SELECT id FROM branches ORDER BY id LIMIT 1`);
  const branchId = br[0].id;
  const ref = `QASCAN-${Date.now()}`;

  let orderId = null;
  try {
    const { rows: ord } = await db.query(
      `INSERT INTO orders (reference_code, branch_id, status, grand_total, customer_name)
       VALUES ($1, $2, 'paid', 0, 'QA Scan') RETURNING id`,
      [ref, branchId],
    );
    orderId = ord[0].id;

    for (const v of [upc, ean]) {
      await db.query(
        `INSERT INTO order_items
           (order_id, product_variant_id, product_name, quantity, picked_qty,
            unit_price_net, unit_price_gross, subtotal, total)
         VALUES ($1, $2, $3, 3, 0, 0, 0, 0, 0)`,
        [orderId, v.variant_id, v.name],
      );
    }

    console.log(`  pedido de prueba: ${ref} (id ${orderId})`);
    console.log(`  UPC-A: ${upc.barcode}  ·  EAN-13: ${ean.barcode}  ·  PLU: ${ean.plu}`);

    // 1) Código ajeno → conflicto con la lista de esperados (los INEAN del pedido).
    const wrong = await scan(orderId, '9999999999999');
    check('código desconocido se rechaza (409)', wrong.status === 409, `status ${wrong.status}`);
    check(
      'el error lista los INEAN esperados',
      Array.isArray(wrong.body?.expected) && wrong.body.expected.includes(upc.barcode),
      `expected ${wrong.body?.expected?.length ?? 0}`,
    );

    // 2) INEAN exacto de 12 dígitos.
    const hit12 = await scan(orderId, upc.barcode);
    check('escanea el INEAN UPC-A exacto', hit12.status === 201 || hit12.status === 200, `status ${hit12.status}`);
    check('marca el item correcto', !!hit12.body?.itemId, `itemId ${hit12.body?.itemId}`);

    // 3) El mismo producto leído como EAN-13 (0 delante): debe coincidir igual.
    const hit12b = await scan(orderId, `0${upc.barcode}`);
    check('normaliza UPC-A ↔ EAN-13 (12→13)', hit12b.body?.itemId === hit12.body?.itemId, `itemId ${hit12b.body?.itemId}`);

    // 4) INEAN de 13 dígitos exacto.
    const hit13 = await scan(orderId, ean.barcode);
    check('escanea el INEAN EAN-13 exacto', !!hit13.body?.itemId, `itemId ${hit13.body?.itemId}`);

    // 5) PLU del producto (alternativa al INEAN).
    if (ean.plu) {
      const hitPlu = await scan(orderId, String(ean.plu));
      check('escanea por PLU', hitPlu.body?.itemId === hit13.body?.itemId, `itemId ${hitPlu.body?.itemId}`);
    } else {
      check('escanea por PLU', true, 'producto sin PLU, omitido');
    }

    // 6) Espacios del lector se recortan.
    const hitSpace = await scan(orderId, ` ${ean.barcode} `);
    check('recorta espacios del lector', !!hitSpace.body?.itemId, `itemId ${hitSpace.body?.itemId}`);
  } finally {
    if (orderId != null) {
      await db.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
      await db.query('DELETE FROM order_status_history WHERE order_id = $1', [orderId]).catch(() => undefined);
      await db.query('DELETE FROM orders WHERE id = $1', [orderId]);
      const { rows: left } = await db.query('SELECT 1 FROM orders WHERE id = $1', [orderId]);
      check('pedido de prueba eliminado', left.length === 0, `id ${orderId}`);
    }
    await db.end();
  }

  console.log(`\n== Resultado: ${checks - failures}/${checks} verificaciones ok ==`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
