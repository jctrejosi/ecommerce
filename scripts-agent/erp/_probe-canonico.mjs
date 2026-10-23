import { createErpClient } from './openads.mjs';
const erp = createErpClient({ mode: 'asqlcmd' });

// Para cada nombre duplicado, ver qué código referencia TIDSAL.INMARCA
const names = ['SAVOR´S', 'PEQUEÑIN', 'ALPINA', 'COLGATE', 'VITU'];
for (const nm of names) {
  const codes = await erp.sql(
    `SELECT MCODIGO FROM tidmarcas WHERE MNOMBRE = '${nm}'`,
    { limit: 50 },
  );
  const clist = codes.rows.map((r) => r[0]);
  console.log(`\n=== ${JSON.stringify(nm)} → códigos ${JSON.stringify(clist)} ===`);

  // total de productos con ese nombre de marca
  const tot = await erp.sql(
    `SELECT COUNT(*) FROM tidsal WHERE INMARCAP = '${nm}'`,
    { limit: 10 },
  );
  console.log(`  productos con INMARCAP='${nm}': ${tot.rows[0][0]}`);

  for (const c of clist) {
    const r = await erp.sql(
      `SELECT COUNT(*) FROM tidsal WHERE INMARCA = '${c}'`,
      { limit: 10 },
    );
    console.log(`  TIDSAL.INMARCA=${JSON.stringify(c)}: ${r.rows[0][0]} productos`);
  }
}
