import { createErpClient } from './openads.mjs';
const erp = createErpClient({ mode: 'asqlcmd' });

// 1) ¿cuántas marcas tienen '?' literal en el nombre?
const q = await erp.sql(
  `SELECT COUNT(*) FROM tidmarcas WHERE MNOMBRE LIKE '%?%'`,
  { limit: 10 },
);
console.log('TIDMARCAS con "?" en nombre:', q.rows[0][0]);

// 2) nombres duplicados: ¿cuántos pares tienen un "?" en una de las variantes?
const dup = await erp.sql(
  `SELECT MNOMBRE FROM tidmarcas GROUP BY MNOMBRE HAVING COUNT(*) > 1`,
  { limit: 1000 },
);
console.log('nombres duplicados:', dup.rows.length);

// 3) total de marcas y cuántas tienen código "corto" vs "200..."
const tot = await erp.sql(`SELECT COUNT(*) FROM tidmarcas`, { limit: 10 });
console.log('total marcas:', tot.rows[0][0]);

// 4) muestra de nombres con "?"
const sample = await erp.sql(
  `SELECT MCODIGO, MNOMBRE FROM tidmarcas WHERE MNOMBRE LIKE '%?%'`,
  { limit: 30 },
);
console.log('=== muestra de nombres con "?" ===');
for (const r of sample.rows) console.log(`${r[0]}\t${JSON.stringify(r[1])}`);
