// Diagnóstico: ¿los productos activos sin categoría VTEX existen en el scrape?
// Uso: node scripts-agent/erp/check-unmatched-eans.mjs /tmp/ean_sin_vtex.txt
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const file = process.argv[2] ?? '/tmp/ean_sin_vtex.txt';
const eans = readFileSync(file, 'utf8')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const db = new DatabaseSync(
  '/home/jk/Proyectos/seeds/Vassago/web_scraper/db/traffic.db',
  { readOnly: true },
);

const stmt = db.prepare(
  'SELECT ean FROM mercaldas_products WHERE ean = ? LIMIT 1',
);

let found = 0;
const missing = [];
for (const ean of eans) {
  if (stmt.get(ean)) found++;
  else missing.push(ean);
}

console.log(
  JSON.stringify(
    {
      total_eans: eans.length,
      en_scrape: found,
      no_en_scrape: missing.length,
      muestra_no_en_scrape: missing.slice(0, 10),
    },
    null,
    2,
  ),
);

db.close();
