/**
 * Diagnóstico: ¿INCATE (TIDSAL) apunta a TIDCATE o a TIDTAB?
 *
 * Compara el campo INCATE de la copia local de TIDSAL contra el árbol TIDCATE.
 * Sólo reporta conteos y muestras; no escribe nada.
 *
 * Uso:
 *   node scripts-agent/erp/analyze-incate.mjs
 */
import { readAdt } from './adt.mjs';
import { s, args } from './lib.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const a = args();
const DICT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/ads/fortuner-dicts');
const TIDSAL = a.file
  ? path.resolve(String(a.file))
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/ads/openads/data/tidsal.adt');

// 1) árbol TIDCATE (CTABCOD)
const tidcate = readAdt(path.join(DICT, 'TIDCATE.ADT'));
const cateCodes = new Set();
for (const r of tidcate.rows) {
  const c = s(r.CTABCOD);
  if (c) cateCodes.add(c);
}

// 2) TIDSAL.INCATE
const tidsal = readAdt(TIDSAL, ['INARTIC', 'INCATE']);
let total = 0;
let incateEmpty = 0;
let incateInTidcate = 0;
let incateNotInTidcate = 0;
const lenDist = new Map();
const notIn = new Map(); // código -> conteo
for (const r of tidsal.rows) {
  total++;
  const inc = s(r.INCATE);
  if (!inc) {
    incateEmpty++;
    continue;
  }
  lenDist.set(inc.length, (lenDist.get(inc.length) || 0) + 1);
  if (cateCodes.has(inc)) incateInTidcate++;
  else {
    incateNotInTidcate++;
    notIn.set(inc, (notIn.get(inc) || 0) + 1);
  }
}

console.log(`TIDCATE: ${cateCodes.size} códigos`);
console.log(`TIDSAL: ${total} artículos`);
console.log(`  INCATE vacío: ${incateEmpty} (${(100 * incateEmpty / total).toFixed(1)}%)`);
console.log(`  INCATE apunta a TIDCATE: ${incateInTidcate} (${(100 * incateInTidcate / total).toFixed(1)}%)`);
console.log(`  INCATE no está en TIDCATE: ${incateNotInTidcate} (${(100 * incateNotInTidcate / total).toFixed(1)}%)`);
console.log(`  Distribución de longitud de INCATE: ${[...lenDist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}=${v}`).join(', ')}`);
console.log(`  Códigos INCATE fuera de TIDCATE (top 20):`);
const top = [...notIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [code, n] of top) console.log(`    ${JSON.stringify(code)}: ${n}`);
