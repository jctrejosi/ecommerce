import { createErpClient } from './openads.mjs';
const erp = createErpClient({ mode: 'asqlcmd' });

// 1) columnas de TIDMARCAS
const cols = await erp.schema('tidmarcas');
console.log('=== columnas TIDMARCAS ===');
for (const r of cols.rows) console.log(JSON.stringify(r));

// 2) nombres duplicados (mismo MNOMBRE, distinto MCODIGO)
const dup = await erp.sql(
  `SELECT MNOMBRE, COUNT(*) AS C, COUNT(DISTINCT MCODIGO) AS DC
     FROM tidmarcas GROUP BY MNOMBRE HAVING COUNT(*) > 1 ORDER BY C DESC`,
  { limit: 500 },
);
console.log('=== nombres duplicados en TIDMARCAS: ' + dup.rows.length + ' ===');
for (const r of dup.rows) console.log(JSON.stringify(r));
