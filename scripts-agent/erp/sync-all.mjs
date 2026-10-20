/**
 * Runner de sincronización ecommerce ⇄ ERP.
 *
 * Ejecuta en orden los syncs requeridos y (si `--apply`) las escrituras al ERP.
 * Pensado para un cron/servicio: sin `--apply` sólo trae datos del ERP y muestra
 * lo que *haría* hacia el ERP; con `--apply` también escribe en el ERP.
 *
 * Uso:
 *   node scripts-agent/erp/sync-all.mjs            # seguro (ERP → PG + dry de salida)
 *   node scripts-agent/erp/sync-all.mjs --apply    # incluye PG → ERP
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, args, log } from './lib.mjs';

const a = args();
const APPLY = !!a.apply;
const DIR = path.join(ROOT, 'scripts-agent', 'erp');

const steps = [
  { name: 'codes', file: 'sync-codes.mjs' },
  { name: 'catalog', file: 'sync-catalog.mjs' },
  { name: 'customers', file: 'sync-customers.mjs' },
  { name: 'push-customers', file: 'push-customers.mjs', args: APPLY ? ['--apply'] : [] },
  { name: 'push-catalog', file: 'push-catalog.mjs', args: APPLY ? ['--apply'] : [] },
  { name: 'push-orders', file: 'push-orders.mjs', args: APPLY ? [] : ['--dry-run'] },
  { name: 'reconcile', file: 'reconcile.mjs', args: APPLY ? ['--apply'] : ['--dry-run'] },
];

log(`sync-all — modo ${APPLY ? 'APPLY (escribe en el ERP)' : 'seguro (no escribe en el ERP)'}\n`);

let failures = 0;
for (const st of steps) {
  const argv = [path.join(DIR, st.file), ...(st.args || [])];
  const r = spawnSync('node', argv, { cwd: ROOT, encoding: 'utf8' });
  const tail = (r.stdout || '').trim().split('\n').slice(-3).join('\n');
  if (r.status !== 0) {
    failures++;
    const err = (r.stderr || '').trim().split('\n').slice(-3).join('\n');
    log(`❌ ${st.name} (exit ${r.status})\n${tail}\n${err}\n`);
  } else {
    log(`✅ ${st.name}\n${tail}\n`);
  }
}

log(failures ? `⚠️  ${failures} paso(s) con error` : '✅ sync-all completado');
process.exit(failures ? 1 : 0);
