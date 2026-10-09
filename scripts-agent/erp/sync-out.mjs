/**
 * Sincronización de SALIDA (ecommerce → ERP) — ligera y repetible.
 *
 * Sólo los pasos rápidos, para correr en bucle/cron mientras no haya ERP real:
 *
 *   push-customers · push-catalog · push-orders · reconcile
 *
 * (La entrada pesada —catálogo y 146k clientes— es `sync-all.mjs`.)
 *
 * Uso:
 *   node scripts-agent/erp/sync-out.mjs                    # dry-run (no escribe)
 *   node scripts-agent/erp/sync-out.mjs --apply            # escribe en el ERP
 *   node scripts-agent/erp/sync-out.mjs --apply --loop=30  # cada 30 s
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, args, log } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;
const LOOP = a.loop ? Number(a.loop) : 0;
const DIR = path.join(ROOT, 'scripts-agent', 'erp');

const steps = [
  { name: 'push-customers', file: 'push-customers.mjs', args: APPLY ? ['--apply'] : [] },
  { name: 'push-catalog', file: 'push-catalog.mjs', args: APPLY ? ['--apply'] : [] },
  { name: 'push-orders', file: 'push-orders.mjs', args: APPLY ? [] : ['--dry-run'] },
  { name: 'reconcile', file: 'reconcile.mjs', args: APPLY ? ['--apply'] : ['--dry-run'] },
];

function cycle() {
  let failures = 0;
  for (const st of steps) {
    const argv = [path.join(DIR, st.file), ...(st.args || [])];
    const r = spawnSync('node', argv, { cwd: ROOT, encoding: 'utf8' });
    const tail = (r.stdout || '').trim().split('\n').slice(-2).join(' | ');
    if (r.status !== 0) {
      failures++;
      log(`❌ ${st.name}: ${tail || (r.stderr || '').trim().split('\n').slice(-1)[0]}`);
    } else {
      log(`✅ ${st.name}: ${tail}`);
    }
  }
  return failures;
}

async function main() {
  log(`sync-out — modo ${APPLY ? 'APPLY (escribe en el ERP)' : 'dry-run'}${LOOP ? ` · loop ${LOOP}s` : ''}`);
  do {
    log(`\n── ${new Date().toISOString()} ──`);
    const f = cycle();
    if (f) log(`⚠️  ${f} paso(s) con error`);
    if (LOOP) await new Promise((r) => setTimeout(r, LOOP * 1000));
  } while (LOOP);
}

main();
