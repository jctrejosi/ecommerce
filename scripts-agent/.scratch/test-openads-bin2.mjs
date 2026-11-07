#!/usr/bin/env node
/**
 * Prueba de escritura/lectura de bin2 (FAESTADO/IFESTADO) y tipos en OpenADS.
 * Usa una copia desechable (data-test) en un contenedor temporal.
 *
 * Uso: OPENADS_URL=http://localhost:18081 node scripts-agent/.scratch/test-openads-bin2.mjs
 */
import { createErpClient } from '../erp/openads.mjs';

const erp = createErpClient({ ...process.env, baseUrl: process.env.OPENADS_URL || 'http://localhost:18081', user: 'dsi', pass: 'dsi' });
const out = {};

const h = await erp.insert('domdia', {
  FACONTROL: 'TEST-CODE-1',
  FAPEDIDO: '900009999',
  FASUCUR: '01',
  FAESTADO: 9,
  FATIPODOM: '01',
  FANOMBRE: 'PRUEBA BIN2',
});
out.domdiaInsert = h;

const r1 = await erp.sql("SELECT FACONTROL, FAPEDIDO, FASUCUR, FAESTADO FROM domdia WHERE FACONTROL = 'TEST-CODE-1'", 5);
out.domdiaRead = r1.rows;

const i = await erp.insert('domite', {
  IFPEDIDO: '900009999',
  IFESTADO: 32768,
  IFARTIC: 'TEST-ART',
  IFSUCUR: '01',
  IFFECHA: 20261022,
  IFCANT: 1,
});
out.domiteInsert = i;

const r2 = await erp.sql("SELECT IFPEDIDO, IFESTADO, IFARTIC, IFSUCUR FROM domite WHERE IFPEDIDO = '900009999'", 5);
out.domiteRead = r2.rows;

if (h.recno) await erp.remove('domdia', h.recno);
if (i.recno) await erp.remove('domite', i.recno);

console.log(JSON.stringify(out, null, 1));
