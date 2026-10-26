/**
 * Demonio de sincronización ERP (Advantage) ⇄ Postgres.
 *
 *   - Pull (ERP → PG): `sync-catalog.mjs` cada ERP_PULL_SECONDS (5 min).
 *   - Push (PG → ERP): `push-catalog.mjs` (outbox), `push-orders.mjs` y
 *     `reconcile.mjs` cada ERP_PUSH_SECONDS (30 s).
 *
 * Los clientes NO se empujan en el bucle rápido (`push-customers.mjs` sigue
 * siendo manual) para no crear clientes de prueba en el ERP sin revisarlos.
 *
 * Pensado para correr como tarea de Windows al iniciar (ver docs/RUNBOOK-ERP.md).
 *
 * Uso:
 *   node scripts-agent/erp/erp-daemon.mjs              # bucle infinito
 *   node scripts-agent/erp/erp-daemon.mjs --once       # un ciclo (prueba)
 *   ERP_PULL_SECONDS=600 ERP_PUSH_SECONDS=15 node ...
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, args, log } from './lib.mjs';

const a = args();
const ONCE = !!a.once;
const PULL = Math.max(60, Number(a.pull ?? process.env.ERP_PULL_SECONDS ?? 300));
const PUSH = Math.max(10, Number(a.push ?? process.env.ERP_PUSH_SECONDS ?? 30));

// No permitir el fallback silencioso a OpenADS: el ERP real se escribe por
// asqlcmd. Si falta la configuración, es mejor fallar y no tocar otra base.
if (process.env.ERP_ADS_MODE !== 'asqlcmd' && !process.env.ADS_CMD) {
  console.error(
    '[erp-daemon] Falta ERP_ADS_MODE=asqlcmd (o ADS_CMD). ' +
      'Configúralo en backend/.env.development.local antes de arrancar.',
  );
  process.exit(2);
}

const DIR = path.join(ROOT, 'scripts-agent', 'erp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(name, file, argv = []) {
  const t = Date.now();
  const r = spawnSync('node', [path.join(DIR, file), ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20 * 60 * 1000,
  });
  const out = (r.stdout || '').trim().split('\n').filter(Boolean);
  const err = (r.stderr || '').trim().split('\n').filter(Boolean);
  const tail = (out.slice(-1)[0] || err.slice(-1)[0] || '').slice(0, 220);
  const secs = ((Date.now() - t) / 1000).toFixed(1);
  log(`${r.status === 0 ? '✅' : '❌'} ${name} ${secs}s — ${tail}`);
  return r.status === 0;
}

function pushCycle() {
  let ok = true;
  ok = run('push-catalog', 'push-catalog.mjs', ['--apply']) && ok;
  ok = run('push-orders', 'push-orders.mjs') && ok;
  ok = run('reconcile', 'reconcile.mjs', ['--apply']) && ok;
  return ok;
}

let lastPull = 0;
for (;;) {
  const now = Date.now();
  if (!lastPull || now - lastPull >= PULL * 1000) {
    log(`── ${new Date().toISOString()} pull catálogo ──`);
    run('sync-catalog', 'sync-catalog.mjs');
    run('sync-masters', 'sync-masters.mjs', ['--prune', '--types-active=erp']);
    lastPull = Date.now();
  }
  log(`── ${new Date().toISOString()} push ──`);
  pushCycle();
  if (ONCE) break;
  await sleep(PUSH * 1000);
}
