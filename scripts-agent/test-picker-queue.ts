/**
 * E2E del despachador de colas de picking (sin crear pedidos reales).
 * Uso (desde backend/): npx tsx ../scripts-agent/test-picker-queue.ts
 *
 * Reusa el pedido `paid` sin picker (id 514, sucursal 9) y verifica que
 * `dispatchNewOrder` lo asigne al picker disponible de la sucursal (juan, 19).
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ecommerce';

import { createRequire } from 'node:module';
import { DrizzleService } from '../backend/src/database/drizzle.service';
import { PickerQueueService } from '../backend/src/modules/picking/picker-queue.service';

const requireFromBackend = createRequire(
  new URL('../backend/package.json', import.meta.url),
);
const { Client } = requireFromBackend('pg') as { Client: any };

const ORDER_ID = 514;

async function main() {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  const ok = (cond: boolean, label: string, extra?: unknown) => {
    console.log(`${cond ? 'OK ' : 'FALLO'} · ${label}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
    if (!cond) process.exitCode = 1;
  };

  // Estado previo para restaurar.
  const prev = (
    await pg.query('SELECT status, picker_id FROM orders WHERE id = $1', [ORDER_ID])
  ).rows[0];

  const drizzle = new DrizzleService({ get: () => undefined } as never);
  const queue = new PickerQueueService(drizzle, { sendToUser: async () => {} } as never);

  try {
    await pg.query("UPDATE orders SET status = 'paid', picker_id = NULL WHERE id = $1", [ORDER_ID]);

    const before = await queue.computePickerFreeAt(19);
    ok(before.queuedOrders === 0, 'juan sin pedidos pendientes antes del despacho', before);

    const eta = await queue.orderEtaSeconds(ORDER_ID);
    ok(eta.remainingPieces >= 0, 'orderEtaSeconds responde', eta);

    const res = await queue.dispatchNewOrder(ORDER_ID);
    ok(res.assigned === true, 'pedido despachado', res);
    ok(res.pickerId === 19, 'asignado al picker juan (19)', { pickerId: res.pickerId });

    const [row] = (
      await pg.query('SELECT picker_id FROM orders WHERE id = $1', [ORDER_ID])
    ).rows;
    ok(Number(row.picker_id) === 19, 'BD: picker_id = 19', { picker_id: row.picker_id });

    // Idempotencia: no reasigna si ya tiene picker.
    const again = await queue.dispatchNewOrder(ORDER_ID);
    ok(again.assigned === true && again.pickerId === 19, 'despacho idempotente', again);
  } finally {
    await pg.query('UPDATE orders SET status = $1, picker_id = $2 WHERE id = $3', [
      prev.status,
      prev.picker_id,
      ORDER_ID,
    ]);
    await pg.end();
    await drizzle.onModuleDestroy();
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
