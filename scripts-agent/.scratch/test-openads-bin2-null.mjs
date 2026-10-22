#!/usr/bin/env node
/** Verifica el centinela de bin2 en OpenADS: vacío vs 0 vs valores. */
import { createErpClient } from '../erp/openads.mjs';

const erp = createErpClient({ baseUrl: 'http://localhost:18081', user: 'dsi', pass: 'dsi' });
const cases = [
  ['empty', undefined],
  ['zero', 0],
  ['five', 5],
  ['three', 3],
];
const out = [];
for (const [name, value] of cases) {
  const values = { IFPEDIDO: `90000999${cases.findIndex((c) => c[0] === name)}`, IFARTIC: 'T', IFSUCUR: '01' };
  if (value !== undefined) values.IFESTADO = value;
  const ins = await erp.insert('domite', values);
  const r = await erp.sql(`SELECT IFESTADO FROM domite WHERE IFPEDIDO = '${values.IFPEDIDO}'`, 1);
  out.push({ case: name, wrote: value ?? '(omitido)', read: r.rows[0]?.[0], recno: ins.recno });
  if (ins.recno) await erp.remove('domite', ins.recno);
}
console.log(JSON.stringify(out, null, 1));
