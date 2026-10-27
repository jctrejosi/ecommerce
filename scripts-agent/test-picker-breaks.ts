/**
 * E2E del motor de descansos/metas (sin tocar pedidos reales).
 * Uso (desde backend/): npx tsx ../scripts-agent/test-picker-breaks.ts
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ecommerce';

import { createRequire } from 'node:module';
import { DrizzleService } from '../backend/src/database/drizzle.service';
import { PickerBreakService } from '../backend/src/modules/picking/picker-break.service';

// `pg` vive en backend/node_modules (la raíz no tiene node_modules).
const requireFromBackend = createRequire(
  new URL('../backend/package.json', import.meta.url),
);
const { Client } = requireFromBackend('pg') as { Client: any };

const USERNAME = 'qa-breaks-picker';
const KEY = 'picking_break_policy';

async function main() {
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  await pg.query('DELETE FROM users WHERE username = $1', [USERNAME]);
  const [user] = (
    await pg.query(
      `INSERT INTO users (email, username, password_hash, first_name, last_name,
                          is_superuser, is_active, is_picker)
       VALUES ($1,$2,'x','Qa','Breaks',false,true,true)
       RETURNING id`,
      [`${USERNAME}@qa.local`, USERNAME],
    )
  ).rows;
  const userId = Number(user.id);

  // Guarda la config previa para restaurarla al final.
  const prev = (await pg.query('SELECT value FROM settings WHERE key = $1', [KEY])).rows[0];

  const drizzle = new DrizzleService({ get: () => undefined } as never);
  const service = new PickerBreakService(drizzle);

  const ok = (cond: boolean, label: string, extra?: unknown) => {
    console.log(`${cond ? 'OK ' : 'FALLO'} · ${label}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
    if (!cond) process.exitCode = 1;
  };

  try {
    const cfg = await service.updateSettings({
      productsPerBreak: 3,
      breakMinutes: 5,
      dailyProductGoal: 10,
      dailyBonusAmount: 20000,
      bankExpiryDays: 0,
    });
    ok(cfg.productsPerBreak === 3 && cfg.breakMinutes === 5, 'configuración guardada', cfg);

    const r1 = await service.recordPick({ userId, branchId: 9, orderId: null, units: 2 });
    ok(r1.productsToday === 2 && r1.earnedMinutes === 0 && r1.bankMinutes === 0, '2 unidades: sin descanso aún', r1);

    const r2 = await service.recordPick({ userId, branchId: 9, orderId: null, units: 2 });
    ok(r2.productsToday === 4 && r2.earnedMinutes === 5 && r2.bankMinutes === 5, '4 unidades: gana 1 descanso (5 min)', r2);

    const r3 = await service.recordPick({ userId, branchId: 9, orderId: null, units: 6 });
    ok(r3.productsToday === 10, '10 unidades: contador del día', { productsToday: r3.productsToday });
    ok(r3.earnedMinutes === 10, '10 unidades: gana 2 descansos más (10 min)', { earnedMinutes: r3.earnedMinutes });
    ok(r3.bankMinutes === 15, 'banco acumulado = 15 min', { bankMinutes: r3.bankMinutes });
    ok(r3.bonusAwardedNow === true, 'meta diaria (10) cruza y otorga bono', { bonusAwardedNow: r3.bonusAwardedNow });

    const sum = await service.summary(userId);
    ok(sum.bankMinutes === 15, 'summary: banco 15', { bankMinutes: sum.bankMinutes });
    ok(sum.breaksEarnedToday === 3, 'summary: 3 descansos ganados en el día', { breaksEarnedToday: sum.breaksEarnedToday });
    ok(sum.goal.reached === true && sum.goal.awarded === true, 'summary: meta alcanzada y bono registrado', sum.goal);
    const bonus = sum.recent.find((m) => m.type === 'bonus');
    ok(bonus != null && bonus.amount === 20000, 'ledger: movimiento de bono por $20000', bonus);

    // Idempotencia: volver a registrar sin cruzar umbral no duplica.
    const r4 = await service.recordPick({ userId, branchId: 9, orderId: null, units: 1 });
    ok(r4.productsToday === 11 && r4.bankMinutes === 15, '11 unidades: banco sigue 15 (sin doble crédito)', r4);

    const used = await service.useBreak(userId, 7);
    ok(used.bankMinutes === 8, 'reclama 7 min: banco queda 8', { bankMinutes: used.bankMinutes });

    let errorMsg = '';
    try {
      await service.useBreak(userId, 100);
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }
    ok(errorMsg.length > 0, 'reclamo mayor al banco se rechaza', { errorMsg });

    const final = await service.summary(userId);
    ok(final.bankMinutes === 8, 'summary final: banco 8', { bankMinutes: final.bankMinutes });
  } finally {
    await pg.query('DELETE FROM picker_break_ledger WHERE user_id = $1', [userId]);
    await pg.query('DELETE FROM picker_daily_stats WHERE user_id = $1', [userId]);
    await pg.query('DELETE FROM users WHERE id = $1', [userId]);
    if (prev) {
      await pg.query('UPDATE settings SET value = $1 WHERE key = $2', [prev.value, KEY]);
    } else {
      await pg.query('DELETE FROM settings WHERE key = $1', [KEY]);
    }
    await pg.end();
    await drizzle.onModuleDestroy();
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
