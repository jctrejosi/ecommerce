#!/usr/bin/env node
/** Valida el ciclo real de push-orders + push-catalog contra OpenADS (data-test). */
import { createErpClient } from '../erp/openads.mjs';

const erp = createErpClient({ baseUrl: 'http://localhost:18081', user: 'dsi', pass: 'dsi' });
const out = {};

const h = await erp.insert('domdia', {
  FACONTROL: 'TEST-CODE-2',
  FAPEDIDO: '900009998',
  FASUCUR: '01',
  FAESTADO: 0,
  FATIPODOM: '01',
  FANOMBRE: 'PRUEBA PEDIDO WEB',
});
const i = await erp.insert('domite', {
  IFPEDIDO: '900009998',
  IFARTIC: 'TEST-ART',
  IFSUCUR: '01',
  IFFECHA: 20261022,
  IFCANT: 1,
});

out.afterInsert = (
  await erp.sql("SELECT FAPEDIDO, FAESTADO FROM domdia WHERE FACONTROL='TEST-CODE-2'", 1)
).rows;
out.itemsAfterInsert = (
  await erp.sql("SELECT IFPEDIDO, IFESTADO FROM domite WHERE IFPEDIDO='900009998'", 1)
).rows;

await erp.sql("UPDATE domdia SET FAESTADO = 5 WHERE FACONTROL = 'TEST-CODE-2'");
await erp.sql("UPDATE domite SET IFESTADO = 5 WHERE IFPEDIDO = '900009998'");

out.afterCancel = (
  await erp.sql("SELECT FAPEDIDO, FAESTADO FROM domdia WHERE FACONTROL='TEST-CODE-2'", 1)
).rows;
out.itemsAfterCancel = (
  await erp.sql("SELECT IFPEDIDO, IFESTADO FROM domite WHERE IFPEDIDO='900009998'", 1)
).rows;

if (h.recno) await erp.remove('domdia', h.recno);
if (i.recno) await erp.remove('domite', i.recno);

console.log(JSON.stringify(out, null, 1));
