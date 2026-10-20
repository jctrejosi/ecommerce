/**
 * Analiza cómo se relaciona el artículo (TIDSAL) con las marcas (TIDMARCAS).
 *
 * Pregunta: ¿la marca "real" del artículo es INMARCAP (nombre de texto) o
 * INMARCA (código MCODIGO)? Devuelve SOLO un resumen de conteos.
 *
 * Uso: node scripts-agent/erp/analyze-brands.mjs [--limit=N] [--page=N]
 */
import { createErpClient, createPg } from './openads.mjs';
import { s, args, log } from './lib.mjs';

const a = args();
const PAGE = Number(a.page || 5000);
const LIMIT = a.limit ? Number(a.limit) : Infinity;

const erp = createErpClient();
const pg = createPg();
await pg.connect();

const cm = await pg.query(
  "SELECT erp_value, label FROM erp_code_map WHERE domain = 'brand'",
);
const nameByCode = new Map();
const codeByName = new Map();
for (const r of cm.rows) {
  const code = String(r.erp_value).trim();
  const name = String(r.label || '').trim();
  nameByCode.set(code, name);
  if (name && !codeByName.has(name.toLowerCase())) codeByName.set(name.toLowerCase(), code);
}
log(`TIDMARCAS en code_map: ${cm.rows.length} (nombres únicos: ${codeByName.size})`);

const SQL =
  'SELECT INARTIC, INMARCAP, INMARCA, INNOMBRE FROM tidsal';

let offset = 0;
let read = 0;
let mcap = 0, mar = 0;
let mcapKnown = 0, marKnown = 0;
let bothKnown = 0, bothKnownSame = 0;
const mcapVals = new Map();
const marVals = new Map();
const samples = [];

for (;;) {
  const res = await erp.sql(SQL, { limit: PAGE, offset });
  const rows = res.rows;
  if (!rows.length) break;
  for (const r of rows) {
    const artic = s(r[0]);
    const c = s(r[1]);     // INMARCAP (texto)
    const mc = s(r[2]);    // INMARCA (código)
    const nom = s(r[3]);
    read++;
    if (c) { mcap++; mcapVals.set(c, (mcapVals.get(c) || 0) + 1); }
    if (mc) { mar++; marVals.set(mc, (marVals.get(mc) || 0) + 1); }
    const cKnown = c && codeByName.has(c.toLowerCase());
    const mcKnown = mc && nameByCode.has(mc);
    if (cKnown) mcapKnown++;
    if (mcKnown) marKnown++;
    if (cKnown && mcKnown) {
      bothKnown++;
      const nameFromCode = nameByCode.get(mc);
      if (nameFromCode && nameFromCode.toLowerCase() === c.toLowerCase()) bothKnownSame++;
      else if (samples.length < 15)
        samples.push(`${artic} | INMARCAP="${c}" vs INMARCA=${mc}->"${nameFromCode}" | ${nom}`);
    }
    if (read >= LIMIT) break;
  }
  if (read >= LIMIT) break;
  offset += rows.length;
}

log(`\nFilas TIDSAL leídas      : ${read}`);
log(`INMARCAP no vacío        : ${mcap}  (distintos: ${mcapVals.size})`);
log(`INMARCAP coincide con MNOMBRE: ${mcapKnown}`);
log(`INMARCA no vacío         : ${mar}  (distintos: ${marVals.size})`);
log(`INMARCA resuelve en MCODIGO : ${marKnown}`);
log(`Ambos conocidos          : ${bothKnown}  (coinciden: ${bothKnownSame})`);
log(`\nTop INMARCAP:`);
for (const [v, n] of [...mcapVals].sort((x, y) => y[1] - x[1]).slice(0, 10))
  log(`   ${String(n).padStart(6)}  ${v}`);
log(`\nTop INMARCA (código -> nombre):`);
for (const [v, n] of [...marVals].sort((x, y) => y[1] - x[1]).slice(0, 10))
  log(`   ${String(n).padStart(6)}  ${v} -> ${nameByCode.get(v) || '??'}`);
if (samples.length) {
  log(`\nMuestras de discrepancia INMARCAP vs INMARCA:`);
  for (const smp of samples) log(`   ${smp}`);
}

await pg.end();
